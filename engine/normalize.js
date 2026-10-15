// Body-unit normalization. Every signal is measured in the player's own
// units so portrait phone, landscape tablet and TV mirroring all agree:
//   S = calibrated shoulder width (horizontal values are divided by S)
//   T = calibrated torso length, shoulder midpoint to hip midpoint
//       (vertical values are divided by T)
//   origin = calibrated hip midpoint, +x = player's right, +y = up
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  // MediaPipe gives x and y as 0-1 fractions of width and height. Those are
  // not square, so convert to pixels before measuring any distance.
  RE.toPixels = function (lm, w, h) {
    return { x: lm[0] * w, y: lm[1] * h, v: lm[3] == null ? 1 : lm[3] };
  };

  RE.framePixels = function (raw) {
    if (!raw || !raw.lm) return null;
    return raw.lm.map((lm) => RE.toPixels(lm, raw.w, raw.h));
  };

  RE.frameWorld = function (raw) {
    if (!raw || !raw.wl) return null;
    return raw.wl.map((p) => ({ x: p[0], y: p[1], z: p[2], v: p[3] == null ? 1 : p[3] }));
  };

  RE.mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  RE.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  RE.orientationOf = (w, h) => (w >= h ? 'landscape' : 'portrait');

  // side: +1 when the player's right appears at larger image x. Measured from
  // the shoulders at calibration, so a mirrored or unmirrored feed both work.
  RE.toBody = function (p, cal) {
    return {
      x: (cal.side * (p.x - cal.hipMidX)) / cal.shoulderWidth,
      y: (cal.hipMidY - p.y) / cal.torsoLength, // image y grows down; flip so up is positive
    };
  };

  // Angle at joint b (degrees) from three 3D world points.
  RE.jointAngle = function (a, b, c) {
    const v1 = [a.x - b.x, a.y - b.y, a.z - b.z];
    const v2 = [c.x - b.x, c.y - b.y, c.z - b.z];
    const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    const n = Math.hypot(...v1) * Math.hypot(...v2);
    if (n === 0) return 180;
    return (Math.acos(RE.clamp(dot / n, -1, 1)) * 180) / Math.PI;
  };
})(globalThis);
