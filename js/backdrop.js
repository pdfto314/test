/* Fundo animado: um "vídeo" discreto atrás do app que reage ao que está tocando.
   Cada tema tem um efeito (chuva, vagalumes, ondas, pingos, brasas, névoa, faíscas, raios, poeira);
   os efeitos dos temas ativos se misturam e pulsam com o áudio (analisador do js/engine.js).
   Pensado para iPad: no máximo ~200 partículas, só anima enquanto há som, respeita "reduzir movimento". */
import { LS, readJson } from "./util.js";

const MAX_DPR = 1.5;

/* ---------- utilidades ---------- */
const rnd = (a, b) => a + Math.random() * (b - a);
const hsla = (h, s, l, a) => `hsla(${h} ${s}% ${l}% / ${a})`;

/* ---------- efeitos ---------- */
/* cada efeito: { init(w,h), draw(ctx, w, h, dt, t, energy, alpha, hue) } */
const EFFECTS = {
  rain: {
    count: 150,
    init(w, h){
      this.p = Array.from({ length: this.count }, () => ({ x: rnd(0, w), y: rnd(-h, h), len: rnd(14, 34), v: rnd(900, 1500), drift: rnd(-60, -20) }));
      this.flash = 0;
    },
    draw(c, w, h, dt, t, energy, alpha, hue){
      c.lineCap = "round";
      c.lineWidth = 1.2;
      c.strokeStyle = hsla(hue, 60, 82, 0.42 * alpha);
      c.beginPath();
      for (const d of this.p){
        d.y += d.v * dt; d.x += d.drift * dt;
        if (d.y > h + 40){ d.y = rnd(-120, -20); d.x = rnd(-40, w + 40); }
        if (d.x < -50) d.x = w + 40;
        c.moveTo(d.x, d.y);
        c.lineTo(d.x + d.drift * 0.02, d.y - d.len);
      }
      c.stroke();
      // relâmpago: mais provável quando o som está forte
      if (this.flash <= 0 && Math.random() < (0.015 + energy * 0.25) * dt) this.flash = rnd(0.12, 0.3);
      if (this.flash > 0){
        this.flash -= dt;
        const a = Math.max(0, this.flash * 0.6) * alpha;
        const g = c.createRadialGradient(w * rnd(0.2, 0.8), 0, 0, w / 2, 0, w);
        g.addColorStop(0, hsla(hue, 40, 95, a)); g.addColorStop(1, "transparent");
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      }
    },
  },
  fireflies: {
    count: 44,
    init(w, h){
      this.p = Array.from({ length: this.count }, () => ({ x: rnd(0, w), y: rnd(0, h), vx: rnd(-14, 14), vy: rnd(-10, 10), ph: rnd(0, 6.3), r: rnd(1.6, 3.2), sp: rnd(0.8, 1.8) }));
    },
    draw(c, w, h, dt, t, energy, alpha, hue){
      for (const f of this.p){
        f.x += (f.vx + Math.sin(t * 0.7 + f.ph) * 10) * dt; f.y += (f.vy + Math.cos(t * 0.5 + f.ph) * 8) * dt;
        if (f.x < -10) f.x = w + 10; if (f.x > w + 10) f.x = -10;
        if (f.y < -10) f.y = h + 10; if (f.y > h + 10) f.y = -10;
        const glow = Math.max(0, Math.sin(t * f.sp + f.ph)) ** 3 * (0.55 + energy * 0.6);
        if (glow < 0.02) continue;
        const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 7);
        g.addColorStop(0, hsla(hue + 20, 90, 75, glow * alpha));
        g.addColorStop(0.3, hsla(hue + 10, 90, 60, glow * 0.35 * alpha));
        g.addColorStop(1, "transparent");
        c.fillStyle = g; c.beginPath(); c.arc(f.x, f.y, f.r * 7, 0, 6.3); c.fill();
      }
    },
  },
  waves: {
    init(){ this.layers = [0.9, 0.82, 0.74].map((y, i) => ({ y, amp: 14 + i * 8, k: 0.006 - i * 0.0012, sp: 0.6 + i * 0.25, ph: i * 2 })); },
    draw(c, w, h, dt, t, energy, alpha, hue){
      this.layers.forEach((L, i) => {
        c.beginPath();
        c.moveTo(0, h);
        for (let x = 0; x <= w; x += 12){
          const y = h * L.y + Math.sin(x * L.k + t * L.sp + L.ph) * L.amp * (1 + energy * 0.8) + Math.sin(x * L.k * 2.7 - t * L.sp * 1.3) * L.amp * 0.3;
          c.lineTo(x, y);
        }
        c.lineTo(w, h); c.closePath();
        c.fillStyle = hsla(hue, 70, 45 + i * 6, (0.14 - i * 0.03) * alpha);
        c.fill();
      });
    },
  },
  drips: {
    count: 70,
    init(w, h){
      this.p = Array.from({ length: this.count }, (_, i) => i < 16
        ? { drop: true, x: rnd(0, w), y: rnd(-h, 0), v: rnd(380, 620), r: rnd(1.5, 2.5) }
        : { x: rnd(0, w), y: rnd(0, h), vx: rnd(-6, 6), vy: rnd(4, 14), r: rnd(0.8, 1.8), ph: rnd(0, 6.3) });
    },
    draw(c, w, h, dt, t, energy, alpha, hue){
      for (const p of this.p){
        if (p.drop){
          p.y += p.v * dt;
          if (p.y > h){ p.y = rnd(-200, -20); p.x = rnd(0, w); }
          c.fillStyle = hsla(hue, 40, 80, 0.45 * alpha);
          c.beginPath(); c.ellipse(p.x, p.y, p.r, p.r * 2.6, 0, 0, 6.3); c.fill();
        }else{
          p.x += (p.vx + Math.sin(t + p.ph) * 4) * dt; p.y += p.vy * dt;
          if (p.y > h + 5) p.y = -5; if (p.x < -5) p.x = w + 5; if (p.x > w + 5) p.x = -5;
          c.fillStyle = hsla(hue, 30, 75, (0.18 + energy * 0.2) * alpha);
          c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.3); c.fill();
        }
      }
    },
  },
  embers: {
    count: 90,
    init(w, h){
      this.p = Array.from({ length: this.count }, () => ({ x: rnd(0, w), y: rnd(0, h), v: rnd(28, 70), sway: rnd(0, 6.3), r: rnd(1, 2.6), life: rnd(0, 1) }));
    },
    draw(c, w, h, dt, t, energy, alpha, hue){
      for (const e of this.p){
        e.y -= e.v * (1 + energy) * dt; e.x += Math.sin(t * 1.3 + e.sway) * 18 * dt; e.life += dt * 0.25;
        if (e.y < -10 || e.life > 1){ e.y = h + 10; e.x = rnd(0, w); e.life = 0; }
        const a = Math.sin(e.life * Math.PI) * (0.5 + energy * 0.5) * alpha;
        const g = c.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 5);
        g.addColorStop(0, hsla(hue, 95, 70, a)); g.addColorStop(0.4, hsla(hue - 15, 95, 55, a * 0.4)); g.addColorStop(1, "transparent");
        c.fillStyle = g; c.beginPath(); c.arc(e.x, e.y, e.r * 5, 0, 6.3); c.fill();
      }
    },
  },
  fog: {
    init(w, h){ this.p = Array.from({ length: 7 }, () => ({ x: rnd(0, w), y: rnd(h * 0.2, h * 0.9), rx: rnd(w * 0.25, w * 0.5), ry: rnd(h * 0.12, h * 0.25), v: rnd(-18, 18), ph: rnd(0, 6.3) })); },
    draw(c, w, h, dt, t, energy, alpha, hue){
      for (const f of this.p){
        f.x += (f.v + Math.sin(t * 0.3 + f.ph) * 8) * dt;
        if (f.x < -f.rx) f.x = w + f.rx; if (f.x > w + f.rx) f.x = -f.rx;
        const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.rx);
        g.addColorStop(0, hsla(hue, 35, 70, (0.09 + energy * 0.05) * alpha)); g.addColorStop(1, "transparent");
        c.fillStyle = g;
        c.save(); c.translate(f.x, f.y); c.scale(1, f.ry / f.rx); c.beginPath(); c.arc(0, 0, f.rx, 0, 6.3); c.fill(); c.restore();
      }
    },
  },
  sparks: {
    count: 60,
    init(w, h){ this.p = Array.from({ length: this.count }, () => this.spawn(w, h, true)); },
    spawn(w, h, random){
      const a = rnd(-Math.PI, 0) - rnd(0, 0.6);
      const sp = rnd(180, 420);
      return { x: rnd(w * 0.1, w * 0.9), y: rnd(h * 0.3, h * 0.95), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: random ? rnd(0, 1) : 0, max: rnd(0.5, 1.1) };
    },
    draw(c, w, h, dt, t, energy, alpha, hue){
      c.lineWidth = 1.6; c.lineCap = "round";
      for (let i = 0; i < this.p.length; i++){
        const s = this.p[i];
        s.life += dt; s.vy += 420 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
        if (s.life > s.max){ if (Math.random() < 0.25 + energy) this.p[i] = this.spawn(w, h, false); else s.life = s.max; continue; }
        const a = (1 - s.life / s.max) * (0.5 + energy * 0.5) * alpha;
        c.strokeStyle = hsla(hue + 30, 100, 70, a);
        c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x - s.vx * 0.03, s.y - s.vy * 0.03); c.stroke();
      }
    },
  },
  rays: {
    init(w){ this.p = Array.from({ length: 5 }, (_, i) => ({ x: rnd(0, w), wdt: rnd(60, 160), v: rnd(-10, 10), ph: i * 1.3 })); },
    draw(c, w, h, dt, t, energy, alpha, hue){
      for (const r of this.p){
        r.x += r.v * dt; if (r.x < -200) r.x = w + 200; if (r.x > w + 200) r.x = -200;
        const a = (0.05 + Math.max(0, Math.sin(t * 0.4 + r.ph)) * 0.06 + energy * 0.05) * alpha;
        const g = c.createLinearGradient(r.x, 0, r.x + r.wdt * 0.6, h);
        g.addColorStop(0, hsla(hue, 70, 80, a)); g.addColorStop(1, "transparent");
        c.fillStyle = g;
        c.beginPath(); c.moveTo(r.x, 0); c.lineTo(r.x + r.wdt, 0); c.lineTo(r.x + r.wdt * 2.2, h); c.lineTo(r.x + r.wdt * 1.2, h); c.closePath(); c.fill();
      }
    },
  },
  motes: {
    count: 50,
    init(w, h){ this.p = Array.from({ length: this.count }, () => ({ x: rnd(0, w), y: rnd(0, h), vx: rnd(-10, 10), vy: rnd(-10, 10), r: rnd(0.8, 2.2), ph: rnd(0, 6.3) })); },
    draw(c, w, h, dt, t, energy, alpha, hue){
      for (const m of this.p){
        m.x += (m.vx + Math.sin(t * 0.6 + m.ph) * 6) * dt; m.y += (m.vy + Math.cos(t * 0.4 + m.ph) * 6) * dt;
        if (m.x < -5) m.x = w + 5; if (m.x > w + 5) m.x = -5; if (m.y < -5) m.y = h + 5; if (m.y > h + 5) m.y = -5;
        const a = (0.15 + Math.max(0, Math.sin(t + m.ph)) * 0.2 + energy * 0.2) * alpha;
        c.fillStyle = hsla(hue, 60, 78, a);
        c.beginPath(); c.arc(m.x, m.y, m.r, 0, 6.3); c.fill();
      }
    },
  },
};

/* ---------- controlador ---------- */
export function initBackdrop({ canvas, readLevels }){
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const systems = new Map();   // motif -> { fx, hue, alpha, target }
  let w = 0, h = 0, raf = 0, last = 0, t = 0, enabled = !reduced;
  let energy = 0;

  function resize(){
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const s of systems.values()) s.fx.init(w, h);
  }

  function frame(now){
    raf = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now; t += dt;

    // energia do áudio (0..1), suavizada
    const levels = readLevels();
    let e = 0;
    if (levels){ let sum = 0; const n = Math.min(24, levels.length); for (let i = 0; i < n; i++) sum += levels[i]; e = sum / n / 255; }
    energy += (e - energy) * 0.15;

    ctx.clearRect(0, 0, w, h);
    let live = false;
    for (const [motif, s] of systems){
      s.alpha += (s.target - s.alpha) * Math.min(1, dt * 1.2);
      if (s.target === 0 && s.alpha < 0.01){ systems.delete(motif); continue; }
      live = true;
      s.fx.draw(ctx, w, h, dt, t, energy, s.alpha, s.hue);
    }
    canvas.classList.toggle("on", live);
    if (live) raf = requestAnimationFrame(frame);
    else last = 0;
  }
  const kick = () => { if (!raf && systems.size) raf = requestAnimationFrame(frame); };

  /* define o que está tocando: [{ motif, hue }] (loops e aleatórios ativos) */
  function setActive(list){
    if (!enabled) list = [];
    const want = new Map();
    for (const { motif, hue } of list){
      if (!EFFECTS[motif]) continue;
      if (!want.has(motif)) want.set(motif, hue);
    }
    for (const [motif, hue] of want){
      let s = systems.get(motif);
      if (!s){
        s = { fx: Object.create(EFFECTS[motif]), hue, alpha: 0, target: 1 };
        s.fx.init(w, h);
        systems.set(motif, s);
      }
      s.target = 1; s.hue = hue;
    }
    for (const [motif, s] of systems) if (!want.has(motif)) s.target = 0;
    kick();
  }

  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") kick(); });
  resize();

  return {
    setActive,
    setEnabled(v){ enabled = v; if (!v){ for (const s of systems.values()) s.target = 0; kick(); } },
    isEnabled: () => enabled,
    defaultEnabled: !reduced,
  };
}
