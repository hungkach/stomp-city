// rep-engine core: namespace, landmark indices, small shared helpers.
// Every engine file is a plain script that adds to globalThis.RepEngine,
// so the build step can concatenate them into one inline <script>.
(function (g) {
  'use strict';
  const RE = (g.RepEngine = g.RepEngine || {});

  RE.version = '0.1.0';

  // MediaPipe Pose landmark indices (33-point model). "Left" and "right"
  // are the player's own anatomical sides.
  RE.LM = Object.freeze({
    NOSE: 0,
    L_SHOULDER: 11, R_SHOULDER: 12,
    L_ELBOW: 13, R_ELBOW: 14,
    L_WRIST: 15, R_WRIST: 16,
    L_HIP: 23, R_HIP: 24,
    L_KNEE: 25, R_KNEE: 26,
    L_ANKLE: 27, R_ANKLE: 28,
  });

  // Knees-up framing: these must be visible for calibration and signals.
  RE.REQUIRED = Object.freeze([11, 12, 23, 24, 25, 26]);

  RE.LM_NAMES = Object.freeze({
    0: 'nose', 11: 'left shoulder', 12: 'right shoulder', 13: 'left elbow',
    14: 'right elbow', 15: 'left wrist', 16: 'right wrist', 23: 'left hip',
    24: 'right hip', 25: 'left knee', 26: 'right knee', 27: 'left ankle', 28: 'right ankle',
  });

  // Skeleton lines for the debug overlay (upper body, torso, legs).
  RE.CONNECTIONS = Object.freeze([
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28],
  ]);

  RE.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  RE.now = () => (g.performance && g.performance.now ? g.performance.now() : Date.now());

  // Tiny event emitter. on('*', fn) receives (name, payload) for every event.
  RE.createEmitter = function () {
    const handlers = new Map();
    return {
      on(name, fn) {
        if (!handlers.has(name)) handlers.set(name, new Set());
        handlers.get(name).add(fn);
        return () => handlers.get(name).delete(fn);
      },
      emit(name, payload) {
        const set = handlers.get(name);
        if (set) for (const fn of [...set]) safeCall(fn, payload);
        const all = handlers.get('*');
        if (all) for (const fn of [...all]) safeCall(fn, name, payload);
      },
      clear() { handlers.clear(); },
    };
  };

  function safeCall(fn, a, b) {
    try { fn(a, b); } catch (err) { (g.console || { error() {} }).error('[rep-engine] handler error', err); }
  }

  // Storage that never throws: private windows, blocked storage and Node
  // all fall back to an in-memory map for the session.
  RE.storage = (function () {
    const memory = new Map();
    function ls() {
      try { return g.localStorage || null; } catch (_) { return null; }
    }
    return {
      get(key) {
        try { const s = ls(); if (s) { const v = s.getItem(key); if (v !== null) return v; } } catch (_) {}
        return memory.has(key) ? memory.get(key) : null;
      },
      set(key, value) {
        memory.set(key, value);
        try { const s = ls(); if (s) s.setItem(key, value); } catch (_) {}
      },
      remove(key) {
        memory.delete(key);
        try { const s = ls(); if (s) s.removeItem(key); } catch (_) {}
      },
    };
  })();

  // Throttled spoken cues for calibration ("step back", "good").
  RE.speak = (function () {
    let lastText = '';
    let lastAt = 0;
    return function (text, minGapMs = 2500) {
      const synth = g.speechSynthesis;
      if (!synth || typeof g.SpeechSynthesisUtterance !== 'function') return false;
      const t = RE.now();
      if (text === lastText && t - lastAt < minGapMs) return false;
      lastText = text;
      lastAt = t;
      try {
        synth.cancel();
        synth.speak(new g.SpeechSynthesisUtterance(text));
        return true;
      } catch (_) { return false; }
    };
  })();
})(globalThis);
