// Locomotion state machine (spec: "Locomotion state machine"). Marching
// drives you forward, a torso turn inside a short arc steers, and big turns
// are discrete gestures, so the player never turns away from the camera. It
// reads events (step, run_start, run_end, turn_around, point) and the
// cadence and turn signals, so camera and touch demo drive it the same way.
//
// The game describes its movement model with engine.set_movement():
//   rails: true snaps movement to paths (manhattan-miles): turn slides you
//          sideways, a point at an intersection takes that street
//   rails: false is free movement (stomp-city): turn sets the turn rate
//   at_intersection(), branch_bearing(side), target_bearing() are optional hooks
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  class Locomotion {
    constructor(cfg) {
      this.c = cfg.locomotion;
      this.model = { rails: false };
      this.reset();
    }

    reset() {
      this.state = 'idle'; // idle | walk | run
      this.speed = 0;
      this.targetSpeed = 0;
      this.rampFrom = 0;   // speed when the target last changed
      this.lastTarget = 0;
      this.facing = 0;     // degrees, + = turning right
      this.lateral = 0;    // -1..1 across the path (rails only)
      this.running = false;
      this.lastStepAt = -Infinity;
      this.interval = Infinity;
      this.pending = { turnAround: false, point: null };
      this.t = null;
      this.stats = { activeMs: 0, runMs: 0, cadenceMs: 0, peakCadence: 0 };
    }

    setModel(model) { this.model = Object.assign({ rails: false }, model); }

    onEvent(name, payload, t) {
      if (name === 'step') {
        if (isFinite(this.lastStepAt)) this.interval = t - this.lastStepAt;
        this.lastStepAt = t;
      } else if (name === 'run_start') this.running = true;
      else if (name === 'run_end') this.running = false;
      else if (name === 'turn_around') this.pending.turnAround = true;
      else if (name === 'point' && payload) this.pending.point = payload.side;
    }

    // t in ms; sig: {cadence_spm, turn}; mode: explore | combat | transit
    update(t, sig, mode) {
      const dt = this.t === null ? 0 : RE.clamp((t - this.t) / 1000, 0, 0.1);
      this.t = t;
      const c = this.c;
      const m = this.model;
      const point = this.pending.point;
      const turnAround = this.pending.turnAround;
      this.pending.point = null;
      this.pending.turnAround = false;

      if (mode === 'transit') {
        // subway, bus or taxi ride: no input, logged as rest
        this.targetSpeed = 0;
        this.speed = 0;
      } else if (mode === 'combat') {
        // the combat module owns the body; face the target
        this.targetSpeed = 0;
        this.speed = 0;
        if (m.target_bearing) this.facing = m.target_bearing();
      } else if (turnAround) {
        // both hands overhead: the only way to reverse
        this.facing = wrap(this.facing + 180);
      } else if (m.rails && point && m.at_intersection && m.at_intersection() && m.branch_bearing) {
        // point an arm to take that street, like hailing a cab
        this.facing = wrap(m.branch_bearing(point));
      } else {
        // no step for stopAfterMs (or 1.5 step intervals at slow cadences,
        // counting intervals up to the slowest walking cadence): stop
        const interval = isFinite(this.interval) ? Math.min(this.interval, 60000 / c.walkCadence) : 0;
        const quiet = t - this.lastStepAt > Math.max(c.stopAfterMs, c.stopIntervals * interval);
        const cadence = sig.cadence_spm || 0;
        if (this.running && !quiet) {
          this.targetSpeed = c.runSpeed;
        } else if (cadence >= c.walkCadence && !quiet) {
          this.targetSpeed = c.walkSpeed * RE.clamp(cadence / c.refCadence, c.walkScale[0], c.walkScale[1]);
        } else {
          this.targetSpeed = 0;
        }
        if (m.rails) {
          // turning slides you across the sidewalk; rails handle the street path
          this.lateral = sig.turn || 0;
        } else {
          // free movement: turn sets the turn rate
          this.facing = wrap(this.facing + (sig.turn || 0) * c.maxTurnRate * dt);
        }
      }

      // ramp linearly toward the target so cadence noise never jerks the
      // camera: a change takes rampMs, coasting to a stop takes stopMs
      if (mode === 'explore') {
        if (this.targetSpeed !== this.lastTarget) { this.rampFrom = this.speed; this.lastTarget = this.targetSpeed; }
        const ms = this.targetSpeed === 0 ? c.stopMs : c.rampMs;
        const step = (Math.abs(this.targetSpeed - this.rampFrom) * dt * 1000) / ms;
        const diff = this.targetSpeed - this.speed;
        this.speed = Math.abs(diff) <= step ? this.targetSpeed : this.speed + Math.sign(diff) * step;
      }
      this.state = this.speed === 0 && this.targetSpeed === 0 ? 'idle' : this.running && this.targetSpeed === c.runSpeed ? 'run' : 'walk';

      if (dt > 0 && this.state !== 'idle') {
        const cad = sig.cadence_spm || 0;
        this.stats.activeMs += dt * 1000;
        if (this.state === 'run') this.stats.runMs += dt * 1000;
        this.stats.cadenceMs += cad * dt * 1000;
        this.stats.peakCadence = Math.max(this.stats.peakCadence, cad);
      }
    }

    snapshot() {
      return { state: this.state, speed: this.speed, target_speed: this.targetSpeed, facing: this.facing, lateral: this.lateral };
    }

    summary() {
      const s = this.stats;
      return {
        activeMs: Math.round(s.activeMs),
        runMs: Math.round(s.runMs),
        avgCadence: s.activeMs > 0 ? Math.round(s.cadenceMs / s.activeMs) : 0,
        peakCadence: Math.round(s.peakCadence),
      };
    }
  }

  function wrap(deg) {
    const d = deg % 360;
    return d < 0 ? d + 360 : d;
  }

  RE.Locomotion = Locomotion;
})(globalThis);
