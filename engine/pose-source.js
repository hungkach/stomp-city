// Frame sources. Every source produces the same raw frame shape, which is
// also the recorded clip format:
//   { t: ms, w: video width px, h: video height px,
//     lm: [[x, y, z, visibility] x33] | null,   // MediaPipe 0-1 image coords
//     wl: [[x, y, z, visibility] x33] | null }  // MediaPipe world coords, meters
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  const pack = (list) => list.map((p) => [p.x, p.y, p.z, p.visibility == null ? 1 : p.visibility]);

  // Live camera + MediaPipe Pose Landmarker (VIDEO mode, one pose).
  class CameraPoseSource {
    constructor(cfg) {
      this.cfg = cfg;
      this.video = null;
      this.stream = null;
      this.landmarker = null;
      this.raf = 0;
      this.running = false;
      this.lastVideoTime = -1;
      this.fps = 0;
      this._fpsFrames = 0;
      this._fpsSince = 0;
      this.delegate = null;
    }

    async start(video, preset, onFrame, onStatus = () => {}) {
      if (!g.isSecureContext) throw new Error('Camera needs https (or localhost).');
      if (!g.navigator || !g.navigator.mediaDevices || !g.navigator.mediaDevices.getUserMedia) {
        throw new Error('This browser has no camera access.');
      }
      this.video = video;
      onStatus('Loading pose model');
      const vision = await import(/* webpackIgnore: true */ this.cfg.pose.moduleUrl);
      const fileset = await vision.FilesetResolver.forVisionTasks(this.cfg.pose.wasmBase);
      this.landmarker = await this._createLandmarker(vision, fileset);

      onStatus('Starting camera');
      this.stream = await g.navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: preset.facingMode || 'user',
          width: { ideal: this.cfg.camera.idealWidth },
          height: { ideal: this.cfg.camera.idealHeight },
        },
      });
      video.srcObject = this.stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      await video.play();

      this.running = true;
      this._fpsSince = RE.now();
      const loop = () => {
        if (!this.running) return;
        this.raf = g.requestAnimationFrame(loop);
        if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
        this.lastVideoTime = video.currentTime;
        const t = RE.now();
        let result;
        try {
          result = this.landmarker.detectForVideo(video, t);
        } catch (err) {
          onStatus('Pose error: ' + err.message);
          return;
        }
        const lm = result.landmarks && result.landmarks[0] ? pack(result.landmarks[0]) : null;
        const wl = result.worldLandmarks && result.worldLandmarks[0] ? pack(result.worldLandmarks[0]) : null;
        this._tickFps(t);
        onFrame({ t, w: video.videoWidth, h: video.videoHeight, lm, wl });
      };
      onStatus('Tracking');
      loop();
    }

    async _createLandmarker(vision, fileset) {
      const p = this.cfg.pose;
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: p.modelUrl, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: p.minPoseDetectionConfidence,
        minPosePresenceConfidence: p.minPosePresenceConfidence,
        minTrackingConfidence: p.minTrackingConfidence,
      });
      try {
        this.delegate = p.delegate;
        return await vision.PoseLandmarker.createFromOptions(fileset, options(p.delegate));
      } catch (err) {
        if (p.delegate === 'CPU') throw err;
        this.delegate = 'CPU';
        return await vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
      }
    }

    _tickFps(t) {
      this._fpsFrames++;
      if (t - this._fpsSince >= 1000) {
        this.fps = (this._fpsFrames * 1000) / (t - this._fpsSince);
        this._fpsFrames = 0;
        this._fpsSince = t;
      }
    }

    stop() {
      this.running = false;
      if (this.raf) g.cancelAnimationFrame(this.raf);
      if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
      if (this.video) this.video.srcObject = null;
      if (this.landmarker && this.landmarker.close) {
        try { this.landmarker.close(); } catch (_) {}
      }
      this.stream = null;
      this.landmarker = null;
    }
  }
  RE.CameraPoseSource = CameraPoseSource;

  RE.validateClip = function (clip) {
    if (!clip || clip.format !== 'rep-engine-clip' || !Array.isArray(clip.frames)) {
      throw new Error('Not a rep-engine clip');
    }
    if (clip.version !== 1) throw new Error('Unsupported clip version ' + clip.version);
    return clip;
  };

  // Feed a whole clip synchronously (tests, analysis).
  RE.replaySync = function (clip, onFrame) {
    RE.validateClip(clip);
    for (const f of clip.frames) onFrame(f);
  };

  // Replay a clip in real time so the overlay and games see it like live input.
  class ReplayPoseSource {
    constructor(clip) { this.clip = RE.validateClip(clip); this.timer = 0; this.running = false; this.fps = 0; }
    start(onFrame, onEnd = () => {}) {
      const frames = this.clip.frames;
      if (!frames.length) { onEnd(); return; }
      this.running = true;
      const t0 = frames[0].t;
      const wall0 = RE.now();
      let i = 0;
      const span = frames.length > 1 ? frames[frames.length - 1].t - t0 : 0;
      this.fps = span > 0 ? ((frames.length - 1) * 1000) / span : 0;
      const step = () => {
        if (!this.running) return;
        const elapsed = RE.now() - wall0;
        // shift timestamps onto the wall clock so time-based logic still works
        while (i < frames.length && frames[i].t - t0 <= elapsed) {
          onFrame(Object.assign({}, frames[i], { t: wall0 + (frames[i].t - t0) }));
          i++;
        }
        if (i >= frames.length) { this.running = false; onEnd(); return; }
        this.timer = g.setTimeout(step, 8);
      };
      step();
    }
    stop() { this.running = false; g.clearTimeout(this.timer); }
  }
  RE.ReplayPoseSource = ReplayPoseSource;
})(globalThis);
