// Every tunable number lives here. A player profile stores only overrides.
// Values are starting points from the spec, not tested results.
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1';

  RE.defaultConfig = function () {
    return {
      pose: {
        moduleUrl: MP + '/vision_bundle.mjs',
        wasmBase: MP + '/wasm',
        modelUrl: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU', // falls back to CPU automatically if GPU init fails
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      },
      camera: { idealWidth: 1280, idealHeight: 720 },
      smoothing: { minCutoff: 1.0, beta: 0.02, dCutoff: 1.0 },
      visibility: {
        hold: 0.5,    // below this a landmark holds its last value
        framing: 0.6, // required landmarks must beat this to pass framing
      },
      calibration: {
        framingHoldMs: 1000,
        baselineMs: 3000,
        frameMargin: 0.02,   // landmarks this close to the edge count as out of frame
        driftRatio: 0.15,    // shoulder width change that suggests re-baseline
        driftHoldMs: 3000,
      },
      signals: {
        squatFullDrop: 0.5, // hip drop (in T) that reads as squat_depth 1
      },
      demo: {
        doubleTapMs: 350,
        runHoldMs: 250,
        runCadence: 170,
        cadenceWindowMs: 3000,
      },
      recorder: { maxMs: 30000, decimals: 4 },
      overlay: { eventLogSize: 10 },
    };
  };

  // Camera presets. mirrorDisplay only flips what the player sees; the math
  // uses anatomical sides, so it never depends on mirroring.
  RE.presets = Object.freeze({
    living_room: { id: 'living_room', label: 'Living room', facingMode: 'user', mirrorDisplay: true, distanceFt: 4 },
    garage: { id: 'garage', label: 'Garage', facingMode: 'user', mirrorDisplay: true, distanceFt: 6 },
    custom: { id: 'custom', label: 'Custom', facingMode: 'user', mirrorDisplay: true, distanceFt: null },
  });

  // Deep merge for config overrides (plain objects only).
  RE.mergeConfig = function merge(base, overrides) {
    if (!overrides) return base;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const key of Object.keys(overrides)) {
      const b = base ? base[key] : undefined;
      const o = overrides[key];
      out[key] = b && o && typeof b === 'object' && typeof o === 'object' && !Array.isArray(o)
        ? merge(b, o)
        : o;
    }
    return out;
  };
})(globalThis);
