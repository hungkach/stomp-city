// Debug overlay: skeleton, live signal bars, calibration prompt and the last
// events. Toggle with a three-finger tap or the "d" key.
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  const BARS = [
    // [label, getter, min, max]
    ['turn', (s) => s.turn, -1, 1],
    ['lean', (s) => s.lean, -1, 1],
    ['squat', (s) => s.squat_depth, 0, 1],
    ['cadence', (s) => s.cadence_spm, 0, 220],
    ['effort', (s) => s.effort, 0, 1],
    ['speed', (s) => s.speed, 0, 3.5],
    ['conf', (s) => s.confidence, 0, 1],
  ];

  class DebugOverlay {
    constructor(canvas, engine, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.engine = engine;
      this.visible = opts.visible !== false;
      this.log = [];
      this.size = engine.cfg.overlay.eventLogSize;
      this.raf = 0;
      this.offAll = engine.on('*', (name, payload) => {
        if (name === 'frame' || name === 'calibration') return;
        let detail = '';
        if (name === 'calibrated' && payload && payload.cal) detail = ` ${payload.cal.orientation}${payload.fromProfile ? ' (saved)' : ''}`;
        else if (payload && Object.keys(payload).length) detail = ' ' + JSON.stringify(payload).replace(/"/g, '');
        this.log.unshift(`${new Date().toLocaleTimeString([], { hour12: false })} ${name}${detail}`);
        if (this.log.length > this.size) this.log.length = this.size;
      });
      this._onTouch = (e) => { if (e.touches && e.touches.length === 3) this.toggle(); };
      this._onKey = (e) => { if (e.key === 'd' && !/input|textarea|select/i.test(e.target.tagName)) this.toggle(); };
      g.addEventListener('touchstart', this._onTouch, { passive: true });
      g.addEventListener('keydown', this._onKey);
      const loop = () => { this.raf = g.requestAnimationFrame(loop); this.draw(); };
      loop();
    }
    toggle() { this.visible = !this.visible; if (!this.visible) this._clear(); }
    _clear() { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

    // Map video pixels to canvas pixels for an object-fit: contain video.
    _mapper(vw, vh, cw, ch, mirror) {
      const s = Math.min(cw / vw, ch / vh);
      const ox = (cw - vw * s) / 2;
      const oy = (ch - vh * s) / 2;
      return (p) => {
        const x = ox + p.x * s;
        return { x: mirror ? cw - x : x, y: oy + p.y * s };
      };
    }

    draw() {
      const c = this.canvas;
      const dpr = g.devicePixelRatio || 1;
      const cw = Math.round(c.clientWidth * dpr);
      const ch = Math.round(c.clientHeight * dpr);
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      this._clear();
      if (!this.visible) return;
      const ctx = this.ctx;
      const d = this.engine.debug();
      ctx.save();
      ctx.scale(dpr, dpr);
      const W = c.clientWidth, H = c.clientHeight;

      // skeleton
      if (d.frame && d.frame.points) {
        const map = this._mapper(d.frame.w, d.frame.h, W, H, d.mirror);
        const pts = d.frame.points;
        ctx.lineWidth = 3;
        for (const [a, b] of RE.CONNECTIONS) {
          const pa = pts[a], pb = pts[b];
          if (!pa || !pb) continue;
          const ok = pa.v >= 0.5 && pb.v >= 0.5;
          ctx.strokeStyle = ok ? 'rgba(80,220,140,.9)' : 'rgba(255,170,60,.7)';
          const A = map(pa), B = map(pb);
          ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        }
        for (const i of RE.REQUIRED) {
          const p = pts[i];
          if (!p) continue;
          const P = map(p);
          ctx.fillStyle = p.held ? 'rgba(255,170,60,.95)' : 'rgba(255,255,255,.95)';
          ctx.beginPath(); ctx.arc(P.x, P.y, 4, 0, Math.PI * 2); ctx.fill();
        }
      }

      // panel
      const s = d.signals;
      const pad = 10, bw = 150, rowH = 18;
      const lines = 3 + BARS.length + 1 + this.log.length;
      const panelH = pad * 2 + lines * rowH;
      const panelW = Math.min(W - 16, 300);
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(8, 8, panelW, panelH);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      let y = 8 + pad + rowH / 2;
      const fit = (str) => {
        const max = panelW - pad * 2;
        if (ctx.measureText(str).width <= max) return str;
        let s = str;
        while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
        return s + '…';
      };
      const text = (str, color = '#fff') => { ctx.fillStyle = color; ctx.fillText(fit(str), 8 + pad, y); y += rowH; };
      text(`${d.source} · ${d.fps ? d.fps.toFixed(0) + ' fps' : '-- fps'} · ${d.mode}`);
      text(d.cal ? `cal ${d.cal.orientation} · S ${d.cal.shoulderWidth.toFixed(0)}px T ${d.cal.torsoLength.toFixed(0)}px` : 'not calibrated', d.cal ? '#cfe' : '#fc8');
      const m = d.locomotion;
      text(m ? `${m.state} · facing ${m.facing.toFixed(0)}° · lateral ${m.lateral.toFixed(2)}` : '', '#cfe');
      for (const [label, get, lo, hi] of BARS) {
        const v = s ? get(s) : null;
        ctx.fillStyle = '#fff';
        ctx.fillText(label, 8 + pad, y);
        const x0 = 8 + pad + 60, w = bw - 20;
        ctx.fillStyle = 'rgba(255,255,255,.18)';
        ctx.fillRect(x0, y - 5, w, 10);
        if (v != null && isFinite(v)) {
          const f = RE.clamp((v - lo) / (hi - lo), 0, 1);
          ctx.fillStyle = 'rgba(80,220,140,.95)';
          if (lo < 0) {
            const zero = x0 + w / 2;
            const xv = x0 + f * w;
            ctx.fillRect(Math.min(zero, xv), y - 5, Math.abs(xv - zero), 10);
          } else {
            ctx.fillRect(x0, y - 5, f * w, 10);
          }
          ctx.fillStyle = '#fff';
          ctx.fillText(Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2), x0 + w + 8, y);
        }
        y += rowH;
      }
      text(d.calibration ? `calibration: ${d.calibration.state} · ${d.calibration.prompt}` : 'events:', '#ddd');
      for (const line of this.log) text(line, 'rgba(255,255,255,.85)');
      ctx.restore();

      // big centered calibration prompt
      if (d.calibration && d.calibration.state !== 'done') {
        ctx.save();
        ctx.scale(dpr, dpr);
        const msg = d.calibration.prompt;
        ctx.font = '700 28px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(msg).width;
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect(W / 2 - tw / 2 - 16, H - 92, tw + 32, 48);
        ctx.fillStyle = '#fff';
        ctx.fillText(msg, W / 2, H - 68);
        // progress bar
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.fillRect(W / 2 - 100, H - 36, 200, 6);
        ctx.fillStyle = 'rgba(80,220,140,.95)';
        ctx.fillRect(W / 2 - 100, H - 36, 200 * d.calibration.progress, 6);
        ctx.restore();
      }
    }

    destroy() {
      g.cancelAnimationFrame(this.raf);
      this.offAll();
      g.removeEventListener('touchstart', this._onTouch);
      g.removeEventListener('keydown', this._onKey);
      this._clear();
    }
  }
  RE.DebugOverlay = DebugOverlay;
})(globalThis);
