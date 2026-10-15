// Per-frame continuous signals from smoothed pixel landmarks + calibration:
// the position signals (lean, squat depth, knee lift, confidence, drift)
// that detectors in detectors.js turn into events, cadence and steering.
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

  // Steps per minute from step timestamps (ms) inside the window. The rate
  // comes from the spacing of recent steps, and once the current gap runs
  // longer than that spacing it decays as 60000 / gap, so cadence falls off
  // smoothly when the player stops instead of holding for the whole window.
  RE.cadenceFromSteps = function (times, now, windowMs) {
    const recent = times.filter((t) => t <= now && now - t <= windowMs);
    if (recent.length < 2) return 0;
    const first = recent[0], last = recent[recent.length - 1];
    const base = ((recent.length - 1) * 60000) / Math.max(last - first, 1);
    const gap = now - last;
    return Math.round(gap > 60000 / base ? Math.min(base, 60000 / gap) : base);
  };

  // Knee height above the hip in torso lengths, from 3D world landmarks
  // (meters, origin at the hip midpoint, y down). Perspective free, so a knee
  // swinging toward the camera still reads its true lift.
  RE.worldKneeHeights = function (world) {
    const ls = world[L.L_SHOULDER], rs = world[L.R_SHOULDER], lh = world[L.L_HIP], rh = world[L.R_HIP];
    const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2, z: (ls.z + rs.z) / 2 };
    const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, z: (lh.z + rh.z) / 2 };
    const torso = Math.hypot(sm.x - hm.x, sm.y - hm.y, sm.z - hm.z);
    if (!(torso > 0)) return null;
    return {
      torso,
      kneeL: (hm.y - world[L.L_KNEE].y) / torso,
      kneeR: (hm.y - world[L.R_KNEE].y) / torso,
    };
  };

  RE.computeSignals = function (points, cal, cfg, world) {
    const { confidence, missing } = RE.confidenceOf(points, cfg.visibility.hold);
    const out = { confidence, missing, calibrated: !!cal };
    if (!cal) return out;

    const b = (i) => RE.toBody(points[i], cal);
    const ls = b(L.L_SHOULDER), rs = b(L.R_SHOULDER);
    const lh = b(L.L_HIP), rh = b(L.R_HIP);
    const lk = b(L.L_KNEE), rk = b(L.R_KNEE);
    const sMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
    const nose = b(L.NOSE);
    const le = b(L.L_ELBOW), re = b(L.R_ELBOW), lw = b(L.L_WRIST), rw = b(L.R_WRIST);
    const hMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };

    // lean: shoulder midpoint minus hip midpoint, in S. + = leaning to player's right
    out.lean = sMid.x - hMid.x;
    // hip drop below the calibrated standing hip height, in T
    out.hipDrop = -hMid.y;
    out.squatDepth = RE.clamp(out.hipDrop / cfg.signals.squatFullDrop, 0, 1);
    // knee lift above standing knee height, in T
    out.kneeLiftL = lk.y - cal.kneeBaseL;
    out.kneeLiftR = rk.y - cal.kneeBaseR;
    // the same lift from world landmarks when this profile has a world baseline
    out.kneeLiftWL = null;
    out.kneeLiftWR = null;
    if (world && cal.kneeBaseWL != null) {
      const k = RE.worldKneeHeights(world);
      if (k) { out.kneeLiftWL = k.kneeL - cal.kneeBaseWL; out.kneeLiftWR = k.kneeR - cal.kneeBaseWR; }
    }
    // what the step detector reads: world lift when available, else image lift
    const useWorld = cfg.march.liftSource !== 'image' && out.kneeLiftWL != null;
    out.stepLiftL = useWorld ? out.kneeLiftWL : out.kneeLiftL;
    out.stepLiftR = useWorld ? out.kneeLiftWR : out.kneeLiftR;
    // shoulder width and torso length now vs calibration. Both scale with
    // distance; only shoulder width shrinks when the torso turns, so torso
    // length tracks distance and their quotient tracks the turn.
    out.shoulderRatio = RE.dist(points[L.L_SHOULDER], points[L.R_SHOULDER]) / cal.shoulderWidth;
    out.torsoRatio = RE.dist(RE.mid(points[L.L_SHOULDER], points[L.R_SHOULDER]), RE.mid(points[L.L_HIP], points[L.R_HIP])) / cal.torsoLength;
    out.body = { ls, rs, lh, rh, lk, rk, sMid, hMid, nose, le, re, lw, rw };
    return out;
  };
})(globalThis);
