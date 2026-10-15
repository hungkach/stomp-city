// One Euro filter (Casiez et al. 2012) plus a per-landmark smoother with
// visibility gating. Low visibility holds the last good value and flags it.
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  function alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  class OneEuroFilter {
    constructor({ minCutoff = 1.0, beta = 0.02, dCutoff = 1.0 } = {}) {
      this.minCutoff = minCutoff;
      this.beta = beta;
      this.dCutoff = dCutoff;
      this.reset();
    }
    reset() { this.x = null; this.dx = 0; this.t = null; }
    // value: number, tSec: timestamp in seconds
    filter(value, tSec) {
      if (this.x === null) { this.x = value; this.t = tSec; return value; }
      const dt = Math.max(tSec - this.t, 1e-3);
      this.t = tSec;
      const rawDx = (value - this.x) / dt;
      this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
      const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
      this.x += alpha(cutoff, dt) * (value - this.x);
      return this.x;
    }
  }
  RE.OneEuroFilter = OneEuroFilter;

  // Smooths pixel landmarks (x, y) and world landmarks (x, y, z).
  // Input points: {x, y, v} pixels; world: {x, y, z, v} meters (or null).
  // scale: pixels per body unit (shoulder width); worldScale: meters per
  // body unit. Filtering happens in body-scaled units so the One Euro speed
  // term behaves the same whether the player fills a portrait phone or a
  // landscape tablet, and the same for image and world landmarks.
  class LandmarkSmoother {
    constructor(smoothing, holdVisibility) {
      this.cfg = smoothing;
      this.hold = holdVisibility;
      this.reset();
    }
    reset() {
      this.px = new Map();   // index -> [fx, fy]
      this.wl = new Map();   // index -> [fx, fy, fz]
      this.last = new Map(); // index -> last good smoothed point
      this.lastW = new Map();
    }
    _filters(map, idx, n) {
      if (!map.has(idx)) map.set(idx, Array.from({ length: n }, () => new OneEuroFilter(this.cfg)));
      return map.get(idx);
    }
    // Returns {points, world, held:Set<index>}
    update(points, world, tSec, scale = 1, worldScale = 1) {
      const k = scale > 0 ? scale : 1;
      const kw = worldScale > 0 ? worldScale : 1;
      const outP = new Array(points.length);
      const outW = world ? new Array(world.length) : null;
      const held = new Set();
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.v < this.hold && this.last.has(i)) {
          // hold the last good value; detectors that need it pause
          outP[i] = Object.assign({}, this.last.get(i), { v: p.v, held: true });
          held.add(i);
        } else {
          const [fx, fy] = this._filters(this.px, i, 2);
          const s = { x: fx.filter(p.x / k, tSec) * k, y: fy.filter(p.y / k, tSec) * k, v: p.v, held: false };
          if (p.v >= this.hold) this.last.set(i, s);
          outP[i] = s;
        }
        if (outW && world[i]) {
          const w = world[i];
          if (w.v < this.hold && this.lastW.has(i)) {
            outW[i] = Object.assign({}, this.lastW.get(i), { v: w.v, held: true });
          } else {
            const [a, b, c] = this._filters(this.wl, i, 3);
            const s = { x: a.filter(w.x / kw, tSec) * kw, y: b.filter(w.y / kw, tSec) * kw, z: c.filter(w.z / kw, tSec) * kw, v: w.v, held: false };
            if (w.v >= this.hold) this.lastW.set(i, s);
            outW[i] = s;
          }
        }
      }
      return { points: outP, world: outW, held };
    }
  }
  RE.LandmarkSmoother = LandmarkSmoother;
})(globalThis);
