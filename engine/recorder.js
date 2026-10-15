// Clip recorder: captures the raw landmark stream (up to 30 s) as JSON so
// detectors can be replayed and regression-tested without a camera.
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  class Recorder {
    constructor(cfg) {
      this.cfg = cfg.recorder;
      this.active = false;
      this.frames = [];
      this.meta = null;
      this.startedAt = 0;
    }
    start(meta = {}) {
      this.active = true;
      this.frames = [];
      this.startedAt = null;
      this.meta = Object.assign({ engineVersion: RE.version, recordedAt: new Date().toISOString() }, meta);
    }
    // Returns true when the recorder auto-stops at the max length.
    push(frame) {
      if (!this.active) return false;
      if (this.startedAt === null) this.startedAt = frame.t;
      const rel = frame.t - this.startedAt;
      if (rel > this.cfg.maxMs) { this.active = false; return true; }
      const d = this.cfg.decimals;
      const r = (list) => (list ? list.map((p) => p.map((v) => round(v, d))) : null);
      this.frames.push({ t: round(rel, 1), w: frame.w, h: frame.h, lm: r(frame.lm), wl: r(frame.wl) });
      return false;
    }
    stop() {
      this.active = false;
      const first = this.frames.find((f) => f.w && f.h);
      return {
        format: 'rep-engine-clip',
        version: 1,
        meta: Object.assign({}, this.meta, {
          orientation: first ? RE.orientationOf(first.w, first.h) : null,
          durationMs: this.frames.length ? this.frames[this.frames.length - 1].t : 0,
          frameCount: this.frames.length,
        }),
        frames: this.frames,
      };
    }
    get elapsedMs() {
      return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
    }
  }
  RE.Recorder = Recorder;

  function round(v, d) {
    if (v == null || !isFinite(v)) return v;
    const k = Math.pow(10, d);
    return Math.round(v * k) / k;
  }

  // Browser helper: offer the clip as a .json download.
  RE.downloadClip = function (clip, filename) {
    const doc = g.document;
    if (!doc) return false;
    const name = filename || `clip-${clip.meta.orientation || 'unknown'}-${Date.now()}.json`;
    const blob = new g.Blob([JSON.stringify(clip)], { type: 'application/json' });
    const url = g.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    g.setTimeout(() => g.URL.revokeObjectURL(url), 5000);
    return true;
  };
})(globalThis);
