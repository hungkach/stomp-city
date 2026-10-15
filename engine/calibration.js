// Calibration: framing check -> baseline capture -> move test -> saved profile.
// One profile per camera preset and orientation, because the pixel baseline
// only means something for the framing it was captured in.
(function (g) {
  'use strict';
  const RE = g.RepEngine;
  const L = RE.LM;

  // Move test prompts from the spec. A prompt only runs once a detector for
  // its event is registered (milestone 2); until then the step is skipped.
  RE.MOVE_TEST = Object.freeze([
    { id: 'march', prompt: 'March four steps', event: 'step', count: 4 },
    { id: 'high_knees', prompt: 'Two high knees', event: 'run_start', count: 1 },
    { id: 'lean_left', prompt: 'Lean left', event: 'lean_left', count: 1 },
    { id: 'lean_right', prompt: 'Lean right', event: 'lean_right', count: 1 },
    { id: 'point_left', prompt: 'Point left', event: 'point', match: { side: 'left' }, count: 1 },
    { id: 'point_right', prompt: 'Point right', event: 'point', match: { side: 'right' }, count: 1 },
    { id: 'squat', prompt: 'One squat', event: 'squat', count: 1 },
    { id: 'jab_cross', prompt: 'Jab, cross', event: 'strike', count: 2 },
  ]);

  // Event names whose detectors exist. Milestone 2 adds to this set.
  RE.detectors = RE.detectors || new Set();

  function median(values) {
    const s = values.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // Why framing fails right now, or null if it passes.
  RE.framingProblem = function (points, w, h, cfg) {
    if (!points) return { code: 'no_person', prompt: 'Step into view' };
    const margin = cfg.calibration.frameMargin;
    const low = [];
    let outOfFrame = false;
    for (const i of RE.REQUIRED) {
      const p = points[i];
      if (!p || p.v < cfg.visibility.framing) { low.push(RE.LM_NAMES[i]); continue; }
      if (p.x < w * margin || p.x > w * (1 - margin) || p.y < h * margin || p.y > h * (1 - margin)) outOfFrame = true;
    }
    if (low.some((n) => n.includes('knee')) || outOfFrame) return { code: 'step_back', prompt: 'Step back', missing: low };
    if (low.length) return { code: 'low_visibility', prompt: 'Face the camera', missing: low };
    return null;
  };

  class Calibrator {
    constructor(cfg, presetId) {
      this.cfg = cfg;
      this.presetId = presetId;
      this.state = 'framing';
      this.framingSince = null;
      this.baselineSince = null;
      this.samples = [];
      this.result = null;
      this.testIndex = 0;
      this.testHits = 0;
      this.tests = RE.MOVE_TEST.filter((t) => RE.detectors.has(t.event));
      this.skippedTests = RE.MOVE_TEST.length - this.tests.length;
    }

    // frame: {points (smoothed px), w, h, t (ms)}. Returns a status object.
    update(frame) {
      const { points, w, h, t } = frame;
      if (this.state === 'done') return this.status();
      if (this.state === 'move_test') return this.status();

      const problem = RE.framingProblem(points, w, h, this.cfg);
      if (problem) {
        this.framingSince = null;
        if (this.state === 'baseline') { this.state = 'framing'; this.samples = []; this.baselineSince = null; }
        this.problem = problem;
        return this.status();
      }
      this.problem = null;

      if (this.state === 'framing') {
        if (this.framingSince === null) this.framingSince = t;
        if (t - this.framingSince >= this.cfg.calibration.framingHoldMs) {
          this.state = 'baseline';
          this.baselineSince = t;
          this.samples = [];
        }
        return this.status(t);
      }

      if (this.state === 'baseline') {
        this.samples.push(sample(points, w, h));
        if (t - this.baselineSince >= this.cfg.calibration.baselineMs) {
          this.result = this._finish(w, h);
          this.state = this.tests.length ? 'move_test' : 'done';
        }
        return this.status(t);
      }
      return this.status(t);
    }

    // Engine forwards gesture events here during the move test.
    onEvent(name, payload) {
      if (this.state !== 'move_test') return;
      const test = this.tests[this.testIndex];
      if (!test || test.event !== name) return;
      if (test.match && !Object.keys(test.match).every((k) => payload && payload[k] === test.match[k])) return;
      this.testHits++;
      if (this.testHits >= test.count) {
        this.testIndex++;
        this.testHits = 0;
        if (this.testIndex >= this.tests.length) this.state = 'done';
      }
    }

    skipTest() {
      if (this.state !== 'move_test') return;
      this.testIndex++;
      this.testHits = 0;
      if (this.testIndex >= this.tests.length) this.state = 'done';
    }

    status(t) {
      const c = this.cfg.calibration;
      let progress = 0;
      let prompt = '';
      if (this.state === 'framing') {
        prompt = this.problem ? this.problem.prompt : 'Hold still';
        progress = this.framingSince !== null && t != null ? RE.clamp((t - this.framingSince) / c.framingHoldMs, 0, 1) : 0;
      } else if (this.state === 'baseline') {
        prompt = 'Stand tall, arms at your sides';
        progress = t != null ? RE.clamp((t - this.baselineSince) / c.baselineMs, 0, 1) : 0;
      } else if (this.state === 'move_test') {
        const test = this.tests[this.testIndex];
        prompt = test ? test.prompt : '';
        progress = this.testIndex / this.tests.length;
      } else if (this.state === 'done') {
        prompt = 'Calibrated';
        progress = 1;
      }
      return {
        state: this.state,
        prompt,
        progress,
        problem: this.problem ? this.problem.code : null,
        missing: this.problem && this.problem.missing ? this.problem.missing : [],
        skippedTests: this.skippedTests,
        result: this.state === 'done' ? this.result : null,
      };
    }

    _finish(w, h) {
      const m = (k) => median(this.samples.map((s) => s[k]));
      const cal = {
        version: 1,
        preset: this.presetId,
        orientation: RE.orientationOf(w, h),
        videoW: w,
        videoH: h,
        shoulderWidth: m('shoulderWidth'),
        torsoLength: m('torsoLength'),
        hipMidX: m('hipMidX'),
        hipMidY: m('hipMidY'),
        side: m('sideSign') >= 0 ? 1 : -1,
        createdAt: new Date().toISOString(),
      };
      // Knee baselines in body units, relative to the calibrated hip.
      cal.kneeBaseL = median(this.samples.map((s) => (cal.hipMidY - s.kneeLY) / cal.torsoLength));
      cal.kneeBaseR = median(this.samples.map((s) => (cal.hipMidY - s.kneeRY) / cal.torsoLength));
      return cal;
    }
  }
  RE.Calibrator = Calibrator;

  function sample(p) {
    const sMid = RE.mid(p[L.L_SHOULDER], p[L.R_SHOULDER]);
    const hMid = RE.mid(p[L.L_HIP], p[L.R_HIP]);
    return {
      shoulderWidth: RE.dist(p[L.L_SHOULDER], p[L.R_SHOULDER]),
      torsoLength: RE.dist(sMid, hMid),
      hipMidX: hMid.x,
      hipMidY: hMid.y,
      sideSign: Math.sign(p[L.R_SHOULDER].x - p[L.L_SHOULDER].x),
      kneeLY: p[L.L_KNEE].y,
      kneeRY: p[L.R_KNEE].y,
    };
  }

  // Saved player profiles, keyed by preset and orientation.
  RE.profiles = {
    key: (preset, orientation) => `rep-engine:profile:${preset}:${orientation}`,
    load(preset, orientation) {
      const raw = RE.storage.get(this.key(preset, orientation));
      if (!raw) return null;
      try {
        const cal = JSON.parse(raw);
        return cal && cal.version === 1 && cal.shoulderWidth > 0 && cal.torsoLength > 0 ? cal : null;
      } catch (_) { return null; }
    },
    save(cal) { RE.storage.set(this.key(cal.preset, cal.orientation), JSON.stringify(cal)); },
    clear(preset, orientation) { RE.storage.remove(this.key(preset, orientation)); },
  };

  // Fires once when shoulder width stays more than driftRatio off baseline
  // for driftHoldMs, then re-arms when the player is back in range.
  class DriftMonitor {
    constructor(cfg) { this.cfg = cfg.calibration; this.since = null; this.fired = false; }
    update(ratio, t) {
      if (ratio == null || !isFinite(ratio)) return false;
      const off = Math.abs(ratio - 1) > this.cfg.driftRatio;
      if (!off) { this.since = null; this.fired = false; return false; }
      if (this.since === null) this.since = t;
      if (!this.fired && t - this.since >= this.cfg.driftHoldMs) { this.fired = true; return true; }
      return false;
    }
    reset() { this.since = null; this.fired = false; }
  }
  RE.DriftMonitor = DriftMonitor;
})(globalThis);
