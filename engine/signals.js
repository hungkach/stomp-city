// Per-frame continuous signals from smoothed pixel landmarks + calibration.
// Milestone 1 computes the position signals (lean, squat depth, knee lift,
// confidence, drift). Cadence, effort, speed and guard arrive with the
// gesture detectors in milestone 2.
(function (g) {
  'use strict';
  const RE = g.RepEngine;
  const L = RE.LM;

  // Lowest visibility among required landmarks, plus which are missing.
  RE.confidenceOf = function (points, threshold) {
    let min = 1;
    const missing = [];
    for (const i of RE.REQUIRED) {
      const v = points[i] ? points[i].v : 0;
      if (v < min) min = v;
      if (v < threshold) missing.push(RE.LM_NAMES[i]);
    }
    return { confidence: Math.max(0, min), missing };
  };

  RE.computeSignals = function (points, cal, cfg) {
    const { confidence, missing } = RE.confidenceOf(points, cfg.visibility.hold);
    const out = { confidence, missing, calibrated: !!cal };
    if (!cal) return out;

    const b = (i) => RE.toBody(points[i], cal);
    const ls = b(L.L_SHOULDER), rs = b(L.R_SHOULDER);
    const lh = b(L.L_HIP), rh = b(L.R_HIP);
    const lk = b(L.L_KNEE), rk = b(L.R_KNEE);
    const sMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const hMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };

    // lean: shoulder midpoint minus hip midpoint, in S. + = leaning to player's right
    out.lean = sMid.x - hMid.x;
    // hip drop below the calibrated standing hip height, in T
    out.hipDrop = -hMid.y;
    out.squatDepth = RE.clamp(out.hipDrop / cfg.signals.squatFullDrop, 0, 1);
    // knee lift above standing knee height, in T
    out.kneeLiftL = lk.y - cal.kneeBaseL;
    out.kneeLiftR = rk.y - cal.kneeBaseR;
    // shoulder width now vs calibration: drifts when the player moves closer/farther
    out.shoulderRatio = RE.dist(points[L.L_SHOULDER], points[L.R_SHOULDER]) / cal.shoulderWidth;
    out.body = { ls, rs, lh, rh, lk, rk, sMid, hMid };
    return out;
  };
})(globalThis);
