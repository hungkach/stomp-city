// Touch demo mode: emits the same events and signals as the camera, so
// games are playable and testable from a phone with no tracking running.
//   Left thumb zone: tap in rhythm = march (tap speed sets cadence).
//                    Double-tap and hold = run.
//   Right thumb zone: drag sideways = turn.
//   Buttons: point L/R, turn around, jab, cross, hook, guard (hold),
//            squat, drive up, stomp.
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  // Pure state for demo input; the DOM layer below only calls these methods.
  class DemoInput {
    constructor(cfg, emit) {
      this.cfg = cfg.demo;
      this.emit = emit;
      this.steps = [];
      this.leg = 'left';
      this.turn = 0;
      this.guard = false;
      this.squatUntil = 0;
      this.running = false;
      this.runTimer = 0;
      this.lastTapAt = -Infinity;
      this.holdTimer = 0;
    }
    step(now) {
      this.steps.push(now);
      if (this.steps.length > 40) this.steps.shift();
      this.emit('step', { leg: this.leg });
      this.leg = this.leg === 'left' ? 'right' : 'left';
    }
    leftDown(now) {
      const isDouble = now - this.lastTapAt <= this.cfg.doubleTapMs;
      this.lastTapAt = now;
      if (isDouble) {
        // double-tap: a hold past runHoldMs starts running
        this.holdTimer = g.setTimeout(() => this.startRun(), this.cfg.runHoldMs);
      }
      this.step(now);
    }
    leftUp() {
      g.clearTimeout(this.holdTimer);
      if (this.running) this.stopRun();
    }
    startRun() {
      if (this.running) return;
      this.running = true;
      this.emit('run_start', {});
      const interval = 60000 / this.cfg.runCadence;
      const tick = () => { if (!this.running) return; this.step(RE.now()); this.runTimer = g.setTimeout(tick, interval); };
      tick();
    }
    stopRun() {
      this.running = false;
      g.clearTimeout(this.runTimer);
      this.emit('run_end', {});
    }
    setTurn(v) { this.turn = RE.clamp(v, -1, 1); }
    press(action, now) {
      const strike = (hand, type) => this.emit('strike', { hand, type, power: 1 });
      switch (action) {
        case 'point_left': this.emit('point', { side: 'left' }); break;
        case 'point_right': this.emit('point', { side: 'right' }); break;
        case 'turn_around': this.emit('turn_around', {}); break;
        case 'jab': strike('left', 'jab'); break;
        case 'cross': strike('right', 'cross'); break;
        case 'hook': strike('left', 'hook'); break;
        case 'squat': this.squatUntil = now + 600; this.emit('squat', { depth: 1, speed: 1 }); break;
        case 'drive_up': this.squatUntil = 0; this.emit('drive_up', { depth: 1, speed: 1 }); break;
        case 'stomp': this.emit('stomp', { leg: this.leg, power: 1 }); this.leg = this.leg === 'left' ? 'right' : 'left'; break;
        default: break;
      }
    }
    signals(now) {
      const cadence = RE.cadenceFromSteps(this.steps, now, this.cfg.cadenceWindowMs);
      return {
        cadence_spm: cadence,
        effort: RE.clamp(cadence / this.cfg.runCadence, 0, 1),
        speed: 0, // the engine fills this in from the locomotion state machine
        turn: this.turn,
        lean: 0,
        squat_depth: now < this.squatUntil ? 1 : 0,
        guard_up: this.guard,
        confidence: 1,
      };
    }
    destroy() { g.clearTimeout(this.holdTimer); this.running = false; g.clearTimeout(this.runTimer); }
  }
  RE.DemoInput = DemoInput;

  const BUTTONS = [
    ['point_left', 'Point L'], ['point_right', 'Point R'], ['turn_around', 'Turn 180'],
    ['jab', 'Jab'], ['cross', 'Cross'], ['hook', 'Hook'],
    ['guard', 'Guard'], ['squat', 'Squat'], ['drive_up', 'Drive up'], ['stomp', 'Stomp'],
  ];
  RE.DEMO_BUTTONS = Object.freeze(BUTTONS.map(([action]) => action));

  // Which buttons a game shows: opts.buttons lists action ids (see
  // RE.DEMO_BUTTONS), in the standard order; omitted shows all. Unknown ids throw
  // so a typo never silently hides a control.
  RE.demoButtons = function (opts = {}) {
    if (!opts.buttons) return BUTTONS.slice();
    for (const id of opts.buttons) if (!RE.DEMO_BUTTONS.includes(id)) throw new Error('unknown demo button ' + id);
    return BUTTONS.filter(([action]) => opts.buttons.includes(action));
  };

  const CSS = `
.re-demo{position:absolute;inset:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr auto;gap:8px;padding:8px;pointer-events:none;font:600 13px/1.2 system-ui,sans-serif;touch-action:none;user-select:none;-webkit-user-select:none}
.re-demo-zone{pointer-events:auto;border-radius:12px;border:1.5px dashed rgba(255,255,255,.45);background:rgba(0,0,0,.18);color:#fff;display:flex;align-items:flex-end;justify-content:center;text-align:center;padding:12px 8px;touch-action:none}
.re-demo-zone.is-active{background:rgba(255,255,255,.2)}
.re-demo-buttons{grid-column:1/3;display:grid;grid-template-columns:repeat(5,1fr);gap:6px;pointer-events:auto}
.re-demo-buttons button{min-height:44px;border-radius:10px;border:0;background:rgba(0,0,0,.55);color:#fff;font:inherit;touch-action:manipulation}
.re-demo-buttons button:active,.re-demo-buttons button.is-held{background:rgba(255,255,255,.35)}
`;

  // DOM layer: builds the touch controls inside `container` (position: relative).
  // opts.buttons: action ids to show (default all).
  RE.DemoController = class DemoController {
    constructor(container, input, opts = {}) {
      this.input = input;
      const doc = container.ownerDocument;
      if (!doc.getElementById('re-demo-style')) {
        const style = doc.createElement('style');
        style.id = 're-demo-style';
        style.textContent = CSS;
        doc.head.appendChild(style);
      }
      const root = (this.root = doc.createElement('div'));
      root.className = 're-demo';
      const left = doc.createElement('div');
      left.className = 're-demo-zone';
      left.textContent = 'Tap to march · double-tap and hold to run';
      const right = doc.createElement('div');
      right.className = 're-demo-zone';
      right.textContent = 'Drag sideways to turn';
      const bar = doc.createElement('div');
      bar.className = 're-demo-buttons';
      const buttons = RE.demoButtons(opts);
      bar.style.gridTemplateColumns = `repeat(${Math.max(1, Math.min(5, buttons.length))},1fr)`;
      if (!buttons.length) bar.hidden = true;
      for (const [action, label] of buttons) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (action === 'guard') {
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.guard = true; b.classList.add('is-held'); });
          const off = () => { input.guard = false; b.classList.remove('is-held'); };
          b.addEventListener('pointerup', off);
          b.addEventListener('pointercancel', off);
          b.addEventListener('pointerleave', off);
        } else {
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.press(action, RE.now()); });
        }
        bar.appendChild(b);
      }

      left.addEventListener('pointerdown', (e) => { e.preventDefault(); left.classList.add('is-active'); input.leftDown(RE.now()); });
      const leftUp = () => { left.classList.remove('is-active'); input.leftUp(); };
      left.addEventListener('pointerup', leftUp);
      left.addEventListener('pointercancel', leftUp);

      let startX = null;
      right.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        right.classList.add('is-active');
        try { right.setPointerCapture(e.pointerId); } catch (_) {}
      });
      right.addEventListener('pointermove', (e) => {
        if (startX === null) return;
        const width = right.getBoundingClientRect().width || 1;
        input.setTurn((e.clientX - startX) / (width * 0.4));
      });
      const rightUp = () => { startX = null; right.classList.remove('is-active'); input.setTurn(0); };
      right.addEventListener('pointerup', rightUp);
      right.addEventListener('pointercancel', rightUp);

      root.append(left, right, bar);
      container.appendChild(root);
    }
    destroy() { this.root.remove(); }
  };
})(globalThis);
