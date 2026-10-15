// rep-engine public API. Games call these and never touch landmarks.
//
//   const engine = RepEngine.create({ video, preset: 'living_room' });
//   await engine.start();             // camera + pose
//   await engine.calibrate();         // resolves with the saved profile
//   engine.on('step', ({ leg }) => ...);
//   engine.set_movement({ rails: false }); // free movement, lean sets turn rate
//   const s = engine.signals();       // per-frame snapshot
//   const m = engine.locomotion();    // speed, facing, lateral, state
(function (g) {
  'use strict';
  const RE = g.RepEngine;
  const MODES = ['explore', 'combat', 'transit'];

  RE.create = function (opts = {}) {
    const cfg = RE.mergeConfig(RE.defaultConfig(), opts.config);
    const emitter = RE.createEmitter();
    const headless = !!opts.headless;

    const st = {
      presetId: opts.preset && RE.presets[opts.preset] ? opts.preset : 'living_room',
      source: 'idle',          // idle | camera | replay | demo
      sourceObj: null,
      mode: 'explore',
      combatTarget: null,
      cal: null,
      profileChecked: new Set(),
      calibrator: null,
      calStatus: null,
      calPromise: null,
      lastPrompt: '',
      scaleRef: null,
      smoother: new RE.LandmarkSmoother(cfg.smoothing, cfg.visibility.hold),
      drift: new RE.DriftMonitor(cfg),
      recorder: new RE.Recorder(cfg),
      detectors: new RE.LocomotionDetectors(cfg),
      det: null,
      loco: new RE.Locomotion(cfg),
      demoInput: null,
      demoUi: null,
      frame: null,
      raw: null,
      sig: null,
      lowConfidence: false,
      snapshot: emptySnapshot(),
      session: { startedAt: null, frames: 0, counts: {} },
    };

    // Count every event for the session summary, feed the move test and the
    // locomotion state machine (camera and demo events alike).
    emitter.on('*', (name, payload) => {
      if (name === 'frame' || name === 'calibration') return;
      st.session.counts[name] = (st.session.counts[name] || 0) + 1;
      if (st.calibrator) st.calibrator.onEvent(name, payload);
      st.loco.onEvent(name, payload, clock());
    });

    // Event time: frame time for camera and replay, wall clock for demo.
    function clock() {
      return st.source === 'demo' || !st.raw ? RE.now() : st.raw.t;
    }

    function preset() { return RE.presets[st.presetId]; }

    function setCal(cal) {
      st.cal = cal;
      st.drift.reset();
      // Smooth in calibrated body scale from now on (see LandmarkSmoother).
      st.scaleRef = cal ? cal.shoulderWidth : null;
      st.smoother.reset();
      st.detectors = new RE.LocomotionDetectors(cfg);
      st.det = null;
    }

    function ingest(raw) {
      st.raw = raw;
      st.session.frames++;
      if (st.session.startedAt === null) st.session.startedAt = raw.t;

      if (st.recorder.active && st.recorder.push(raw)) {
        emitter.emit('recording_done', { clip: st.recorder.stop() });
      }

      const orient = raw.w && raw.h ? RE.orientationOf(raw.w, raw.h) : null;
      if (orient) checkProfile(orient);

      const px = RE.framePixels(raw);
      let points = null;
      let world = null;
      if (px) {
        if (!st.scaleRef) {
          const ls = px[RE.LM.L_SHOULDER], rs = px[RE.LM.R_SHOULDER];
          if (ls.v >= cfg.visibility.hold && rs.v >= cfg.visibility.hold) st.scaleRef = RE.dist(ls, rs) || null;
        }
        const sm = st.smoother.update(px, RE.frameWorld(raw), raw.t / 1000, st.scaleRef || 1, cfg.smoothing.worldUnit);
        points = sm.points;
        world = sm.world;
      }
      st.frame = { t: raw.t, w: raw.w, h: raw.h, points, world };

      if (st.calibrator) runCalibrator();

      const sig = points ? RE.computeSignals(points, st.cal, cfg, world) : { confidence: 0, missing: RE.REQUIRED.map((i) => RE.LM_NAMES[i]), calibrated: !!st.cal };
      st.sig = sig;

      // confidence transitions
      const low = sig.confidence < cfg.visibility.hold;
      if (low && !st.lowConfidence) emitter.emit('low_confidence', { missing: sig.missing });
      if (!low && st.lowConfidence) emitter.emit('confidence_ok', {});
      st.lowConfidence = low;

      // drift: player moved closer or farther than the baseline. Torso length,
      // not shoulder width, so a torso turn is never mistaken for distance.
      if (st.cal && !low && st.drift.update(sig.torsoRatio, raw.t)) {
        emitter.emit('recalibrate_suggested', { reason: 'distance', torsoRatio: sig.torsoRatio });
      }

      if (st.source !== 'demo') {
        // gesture detectors, then the state machine reads their events
        st.det = st.cal && points
          ? st.detectors.update({ t: raw.t, w: raw.w, h: raw.h, points, raw: px, world, cal: st.cal, sig, low, holdVis: cfg.visibility.hold })
          : null;
        if (st.det) for (const [name, payload] of st.det.events) emitter.emit(name, payload);
        const det = st.det;
        st.loco.update(raw.t, { cadence_spm: det ? det.cadence : 0, turn: det ? det.turn : 0 }, st.mode);
        st.snapshot = Object.assign(emptySnapshot(), {
          cadence_spm: det ? det.cadence : 0,
          effort: det ? det.effort : 0,
          speed: st.loco.speed,
          turn: det ? det.turn : 0,
          lean: det ? det.lean : 0,
          squat_depth: sig.squatDepth != null && !low ? sig.squatDepth : 0,
          confidence: sig.confidence,
        });
      }
      emitter.emit('frame', st.snapshot);
    }

    function checkProfile(orient) {
      if (st.cal && st.cal.orientation !== orient) {
        // device rotated: switch to that orientation's profile if there is one
        const p = RE.profiles.load(st.presetId, orient);
        setCal(p);
        st.profileChecked.add(orient);
        emitter.emit('orientation_change', { orientation: orient, calibrated: !!p });
        if (!p) emitter.emit('recalibrate_needed', { reason: 'orientation', orientation: orient });
        return;
      }
      if (!st.cal && !st.profileChecked.has(orient) && !st.calibrator) {
        st.profileChecked.add(orient);
        const p = RE.profiles.load(st.presetId, orient);
        if (p) { setCal(p); emitter.emit('calibrated', { cal: p, fromProfile: true }); }
      }
    }

    function runCalibrator() {
      const status = st.calibrator.update(st.frame);
      // the move test needs live detectors: use the fresh baseline for it
      if (status.state === 'move_test' && st.cal !== st.calibrator.result) setCal(st.calibrator.result);
      st.calStatus = status;
      emitter.emit('calibration', status);
      if (!headless && status.prompt && status.prompt !== st.lastPrompt) {
        st.lastPrompt = status.prompt;
        RE.speak(status.state === 'baseline' ? 'Good. Hold still.' : status.prompt);
      }
      if (status.state === 'done') {
        const cal = status.result;
        RE.profiles.save(cal);
        st.calibrator = null;
        if (st.cal !== cal) setCal(cal);
        st.profileChecked.add(cal.orientation);
        emitter.emit('calibrated', { cal, fromProfile: false, skippedTests: status.skippedTests });
        if (st.calPromise) { st.calPromise.resolve(cal); st.calPromise = null; }
      }
    }

    function stopSource() {
      if (st.sourceObj && st.sourceObj.stop) st.sourceObj.stop();
      st.sourceObj = null;
      if (st.source !== 'demo') st.source = 'idle';
    }

    const api = {
      cfg,
      presets: RE.presets,

      // Start live camera tracking. Needs opts.video (a <video> element).
      async start(presetId) {
        if (presetId && RE.presets[presetId]) st.presetId = presetId;
        if (!opts.video) throw new Error('RepEngine.create needs { video } for camera mode');
        api.disable_demo();
        stopSource();
        const cam = new RE.CameraPoseSource(cfg);
        st.sourceObj = cam;
        st.source = 'camera';
        await cam.start(opts.video, preset(), ingest, (msg) => emitter.emit('status', { message: msg }));
      },

      // Replay a recorded clip through the full pipeline.
      start_replay(clip, { realtime = true } = {}) {
        api.disable_demo();
        stopSource();
        st.source = 'replay';
        return new Promise((resolve) => {
          const done = () => { st.source = 'idle'; emitter.emit('replay_end', {}); resolve(); };
          if (!realtime) { RE.replaySync(clip, ingest); done(); return; }
          const r = new RE.ReplayPoseSource(clip);
          st.sourceObj = r;
          r.start(ingest, done);
        });
      },

      stop() { stopSource(); api.disable_demo(); },

      // Runs framing check, baseline capture and move test. Resolves with
      // the saved profile. opts.moveTest: false skips the move test.
      calibrate(presetId, opts) {
        if (presetId && RE.presets[presetId]) st.presetId = presetId;
        if (st.calPromise) st.calPromise.reject(new Error('calibration restarted'));
        st.calibrator = new RE.Calibrator(cfg, st.presetId, opts);
        st.lastPrompt = '';
        return new Promise((resolve, reject) => { st.calPromise = { resolve, reject }; });
      },
      skip_move_test() { if (st.calibrator) st.calibrator.skipTest(); },
      cancel_calibration() {
        st.calibrator = null;
        st.calStatus = null;
        if (st.calPromise) { st.calPromise.reject(new Error('calibration cancelled')); st.calPromise = null; }
      },
      clear_profile() {
        const o = st.cal ? st.cal.orientation : st.frame ? RE.orientationOf(st.frame.w, st.frame.h) : null;
        if (o) RE.profiles.clear(st.presetId, o);
        setCal(null);
        st.profileChecked.clear();
      },
      is_calibrated: () => !!st.cal,

      // opts.buttons: which demo buttons to show, e.g. ['jab', 'cross', 'stomp'].
      enable_demo(container, opts) {
        if (st.demoInput) return;
        stopSource();
        st.source = 'demo';
        st.demoInput = new RE.DemoInput(cfg, (name, payload) => emitter.emit(name, payload));
        if (container) st.demoUi = new RE.DemoController(container, st.demoInput, opts);
        if (st.session.startedAt === null) st.session.startedAt = RE.now();
      },
      disable_demo() {
        if (!st.demoInput) return;
        st.demoInput.destroy();
        if (st.demoUi) st.demoUi.destroy();
        st.demoInput = null;
        st.demoUi = null;
        if (st.source === 'demo') st.source = 'idle';
        st.snapshot = emptySnapshot();
        st.loco.reset();
      },

      on: (name, fn) => emitter.on(name, fn),

      signals() {
        if (st.source === 'demo' && st.demoInput) {
          const now = RE.now();
          const s = st.demoInput.signals(now);
          st.loco.update(now, s, st.mode);
          s.speed = st.loco.speed;
          st.snapshot = s;
        }
        return Object.assign({}, st.snapshot);
      },

      // Locomotion state: {state: idle | walk | run, speed, target_speed,
      // facing (degrees), lateral (-1..1, rails only)}.
      locomotion() {
        if (st.source === 'demo') api.signals();
        return st.loco.snapshot();
      },
      // Movement model, see locomotion.js: {rails, at_intersection(),
      // branch_bearing(side), target_bearing()}.
      set_movement(model) { st.loco.setModel(model || {}); },

      set_mode(mode) {
        if (!MODES.includes(mode)) throw new Error('unknown mode ' + mode);
        if (mode === st.mode) return;
        st.mode = mode;
        if (mode !== 'combat') st.combatTarget = null;
        emitter.emit('mode', { mode });
      },
      enter_combat(target) { st.combatTarget = target || null; api.set_mode('combat'); },
      exit_combat() { api.set_mode('explore'); },
      mode: () => st.mode,

      start_recording(meta) { st.recorder.start(Object.assign({ preset: st.presetId }, meta)); },
      stop_recording() { return st.recorder.stop(); },
      is_recording: () => st.recorder.active,
      recording_ms: () => st.recorder.elapsedMs,

      // Session telemetry. activeMs is time spent moving (walk or run);
      // strike totals and the work/rest split arrive with the combat module.
      session_summary() {
        const end = st.raw && st.source !== 'demo' ? st.raw.t : RE.now();
        return Object.assign({
          startedAt: st.session.startedAt,
          durationMs: st.session.startedAt === null ? 0 : Math.max(0, end - st.session.startedAt),
          frames: st.session.frames,
          events: Object.assign({}, st.session.counts),
        }, st.loco.summary());
      },

      // Debug view for the overlay and tests. Games should not depend on it.
      debug() {
        return {
          source: st.source,
          mode: st.mode,
          preset: st.presetId,
          mirror: preset().mirrorDisplay,
          fps: st.sourceObj && st.sourceObj.fps ? st.sourceObj.fps : 0,
          delegate: st.sourceObj && st.sourceObj.delegate ? st.sourceObj.delegate : null,
          frame: st.frame,
          raw: st.raw,
          cal: st.cal,
          calibration: st.calibrator ? st.calStatus : null,
          signals: api.signals(),
          rawSignals: st.sig,
          detectors: st.det,
          demo: st.demoInput,
          locomotion: st.loco.snapshot(),
        };
      },

      // Feed one raw frame directly (tests and custom sources).
      _ingest: ingest,
    };
    return api;
  };

  function emptySnapshot() {
    return { cadence_spm: 0, effort: 0, speed: 0, turn: 0, lean: 0, squat_depth: 0, guard_up: false, confidence: 0 };
  }
})(globalThis);
