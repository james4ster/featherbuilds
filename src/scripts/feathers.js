(function () {
  'use strict';

  var root = document.documentElement;

  /* ---------- Theme toggle ---------- */
  var toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function () {
      var isDark = root.classList.toggle('dark');
      try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (e) {}
    });
  }

  function boot() {
    const bgCanvas = document.getElementById('forest-canvas');
    const fgCanvas = document.getElementById('feather-canvas');
    if (!bgCanvas || !fgCanvas) return;
    const bg = bgCanvas.getContext('2d');
    const fg = fgCanvas.getContext('2d');
    if (!bg || !fg) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---------- helpers ---------- */
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    const easeOut = (t) => 1 - (1 - t) * (1 - t);
    const easeIn = (t) => t * t;
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const isDark = () => root.classList.contains('dark');
    const mix = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
    const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    function seeded(a) {
      return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    function makeCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = Math.ceil(w); c.height = Math.ceil(h);
      return c;
    }
    function pickPerchEl() {
      const cands = birdEls.filter((el) => {
        const r = perchRect(el);
        return r.width > 40 && r.top > headerBottom + 70 && r.top < H - 120 && r.right < W;
      });
      if (!cands.length) return null;
      const el = cands[Math.floor(Math.random() * cands.length)];
      const fx = el.dataset.bird === 'text' ? (Math.random() < 0.5 ? rand(0.1, 0.3) : rand(0.7, 0.9)) : rand(0.2, 0.8);
      return { el: el, fx: fx };
    }
    function perchRect(el) {
      if (el.dataset.bird !== 'text') return el.getBoundingClientRect();
      const rg = document.createRange(); rg.selectNodeContents(el);
      const rs = Array.from(rg.getClientRects()).filter((r) => r.width > 8);
      if (!rs.length) return el.getBoundingClientRect();
      const top = Math.min(...rs.map((r) => r.top));
      const line = rs.filter((r) => r.top < top + 6);
      const left = Math.min(...line.map((r) => r.left)), right = Math.max(...line.map((r) => r.right));
      return { left: left, right: right, top: top + (parseFloat(getComputedStyle(el).fontSize) || 16) * 0.3, width: right - left };
    }

    /* ---------- state ---------- */
    let W = 0, H = 0, DPR = 1;
    let clock = 0, builtDark = null;
    let backCache = null, frontCache = null;
    let peaks = [], twinkles = [], fireflies = [], clouds = [];
    let featherSprites = [], fireflySprite = null, cloudSprite = null;
    let bird = null, nextBirdAt = 1.4;
    let shoot = null, nextShootAt = 14;
    const feathers = [];
    const MAX_FEATHERS = 14;
    const mouse = { x: -999, y: -999, t: 0 };
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    let lastScroll = 0, scrollFade = 1;
    let navOpen = false, navAskAt = 0;
    const FOOT = 19; // distance from bird centre to its feet; nudge if it floats/sinks
    const header = document.getElementById('site-header');
    const perchEls = Array.from(document.querySelectorAll('[data-perch]'));
    const occEls = Array.from(document.querySelectorAll('[data-occlude]'));
    const birdEls = Array.from(document.querySelectorAll('[data-bird]'));
    const weights = new Map();
    perchEls.forEach((el) => weights.set(el, parseFloat(el.dataset.perch) || 1));
    const clusters = new WeakMap();
    const rects = new Map();
    let headerBottom = 0;

    /* ---------- palettes ---------- */
    const PAL = {
      dark: {
        fog: '14,58,48', fogA: 0.5,
        mount: ['rgba(40,104,92,0.20)', 'rgba(24,72,64,0.34)'],
        layers: [['#0f332c', '#08201b'], ['#0a2520', '#051611'], ['#061712', '#030c09']]
      },
      light: {
        fog: '236,253,245', fogA: 0.6,
        mount: ['rgba(134,200,180,0.40)', 'rgba(110,185,160,0.50)'],
        layers: [['#a9dcc6', '#93d0b6'], ['#74bd9e', '#5aa98a'], ['#2f8767', '#206c52']]
      }
    };
    const LAYERS = [
      { base: 0.80, gap: 40, h: [78, 128], w: 0.46, front: false, perch: true },
      { base: 0.895, gap: 54, h: [118, 182], w: 0.46, front: true, perch: true },
      { base: 0.99, gap: 76, h: [175, 262], w: 0.44, front: true, perch: false }
    ];
    const PERCH_S = [0.36, 0.5];

    /* ---------- sizing ---------- */
    function size() {
      DPR = Math.min(window.devicePixelRatio || 1, innerWidth < 768 ? 1 : 1.5);
      W = bgCanvas.clientWidth || window.innerWidth;
      H = bgCanvas.clientHeight || window.innerHeight;
      [bgCanvas, fgCanvas].forEach((c) => {
        c.width = Math.round(W * DPR);
        c.height = Math.round(H * DPR);
      });
    }

    /* =====================================================
       STATIC WORLD (pre-rendered once per size/theme)
       ===================================================== */
    function paintSky(c, dark, rng, s) {
      twinkles = [];
      let g;
      if (dark) {
        const mx = W * 0.8, my = H * 0.17;
        g = c.createRadialGradient(mx, my, 0, mx, my, 260 * s);
        g.addColorStop(0, 'rgba(186,230,253,0.20)');
        g.addColorStop(0.4, 'rgba(110,231,183,0.06)');
        g.addColorStop(1, 'rgba(110,231,183,0)');
        c.fillStyle = g;
        c.fillRect(mx - 270 * s, my - 270 * s, 540 * s, 540 * s);

        for (let i = 0; i < 90; i++) {
          const x = rng() * W, y = rng() * H * 0.62, r = 0.4 + rng() * 1.1, a = 0.25 + rng() * 0.55;
          const ph = rng() * TAU, sp = 0.8 + rng() * 1.8;
          if (Math.hypot(x - mx, y - my) < 70 * s) continue;
          if (i < 18) { twinkles.push({ x: x, y: y, r: r + 0.3, ph: ph, sp: sp }); continue; }
          c.fillStyle = 'rgba(226,232,240,' + a.toFixed(2) + ')';
          c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        }

        g = c.createRadialGradient(mx - 6 * s, my - 6 * s, 2, mx, my, 28 * s);
        g.addColorStop(0, '#f8fafc'); g.addColorStop(1, '#cbd5e1');
        c.fillStyle = g; c.beginPath(); c.arc(mx, my, 27 * s, 0, TAU); c.fill();
        c.fillStyle = 'rgba(100,116,139,0.18)';
        [[-8, -5, 6], [7, 8, 4.5], [5, -12, 3.2]].forEach((m) => {
          c.beginPath(); c.arc(mx + m[0] * s, my + m[1] * s, m[2] * s, 0, TAU); c.fill();
        });

        g = c.createLinearGradient(0, H * 0.45, 0, H * 0.82);
        g.addColorStop(0, 'rgba(16,185,129,0)'); g.addColorStop(1, 'rgba(16,185,129,0.07)');
        c.fillStyle = g; c.fillRect(0, H * 0.45, W, H * 0.37);
      } else {
        const sx = W * 0.78, sy = H * 0.18;
        g = c.createRadialGradient(sx, sy, 0, sx, sy, 340 * s);
        g.addColorStop(0, 'rgba(253,230,138,0.55)');
        g.addColorStop(0.35, 'rgba(254,240,190,0.25)');
        g.addColorStop(1, 'rgba(254,240,190,0)');
        c.fillStyle = g;
        c.fillRect(sx - 340 * s, sy - 340 * s, 680 * s, 680 * s);

        g = c.createRadialGradient(sx, sy, 0, sx, sy, 34 * s);
        g.addColorStop(0, 'rgba(255,251,235,1)'); g.addColorStop(1, 'rgba(253,230,138,0.95)');
        c.fillStyle = g; c.beginPath(); c.arc(sx, sy, 32 * s, 0, TAU); c.fill();

        g = c.createLinearGradient(0, H * 0.45, 0, H * 0.82);
        g.addColorStop(0, 'rgba(253,224,171,0)'); g.addColorStop(1, 'rgba(253,224,171,0.28)');
        c.fillStyle = g; c.fillRect(0, H * 0.45, W, H * 0.37);
      }
    }

    function paintMountains(c, pal, rng, s) {
      const ranges = [
        { base: H * 0.72, amp: 120 * s, fill: pal.mount[0], k: [0.0031, 0.0087, 0.021] },
        { base: H * 0.78, amp: 95 * s, fill: pal.mount[1], k: [0.0042, 0.0113, 0.027] }
      ];
      ranges.forEach((r) => {
        const p = [rng() * TAU, rng() * TAU, rng() * TAU];
        c.fillStyle = r.fill;
        c.beginPath(); c.moveTo(0, H);
        for (let x = 0; x <= W + 4; x += 4) {
          const n = 0.55 * Math.abs(Math.sin(x * r.k[0] + p[0])) +
                    0.30 * Math.abs(Math.sin(x * r.k[1] + p[1])) +
                    0.15 * Math.abs(Math.sin(x * r.k[2] + p[2]));
          c.lineTo(x, r.base - r.amp * (1 - n));
        }
        c.lineTo(W, H); c.closePath(); c.fill();
      });
    }

    // Layered conifer silhouette: drooping tiers, jagged bough edges, tapered trunk
    function pine(c, x, base, h, w, lean, rng) {
      const tiers = Math.max(6, Math.round(h / (15 + rng() * 9)));
      const apexY = base - h;
      const canopyH = h * 0.93;
      const tierH = canopyH / tiers;
      const pts = [];
      let prevD = 0, prevY = apexY;
      for (let i = 0; i < tiers; i++) {
        const f = (i + 1) / tiers;
        const hw = w * 0.5 * Math.pow(f, 0.82);
        const tipY = apexY + canopyH * f + 2 + rng() * 3;
        const tipD = hw * (0.9 + rng() * 0.22);
        for (let m = 1; m <= 2; m++) {
          const t = m / 3;
          pts.push({ d: lerp(prevD, tipD, t) + (rng() - 0.5) * 2.4, y: lerp(prevY, tipY, t) + (rng() - 0.3) * 2.2 });
        }
        pts.push({ d: tipD, y: tipY });
        prevD = hw * (0.3 + rng() * 0.12);
        prevY = tipY - tierH * (0.34 + rng() * 0.1);
        pts.push({ d: prevD, y: prevY });
      }
      const cOf = (y) => lean * (1 - (y - apexY) / h);
      const tw = Math.max(1.1, w * 0.032);
      const trunkTop = base - h * 0.07;

      c.beginPath();
      c.moveTo(x + lean, apexY);
      for (let k = 0; k < pts.length; k++) c.lineTo(x + cOf(pts[k].y) - pts[k].d, pts[k].y);
      c.lineTo(x - tw, trunkTop); c.lineTo(x - tw * 1.4, base + 12);
      c.lineTo(x + tw * 1.4, base + 12); c.lineTo(x + tw, trunkTop);
      for (let k = pts.length - 1; k >= 0; k--) {
        c.lineTo(x + cOf(pts[k].y) + pts[k].d * (1 + (rng() - 0.5) * 0.18), pts[k].y + (rng() - 0.5) * 1.6);
      }
      c.closePath(); c.fill();
    }

    function buildWorld(keepBird) {
      const dark = isDark();
      builtDark = dark;
      const s = clamp(H / 900, 0.7, 1.25);
      const rng = seeded(20240611);
      const pal = dark ? PAL.dark : PAL.light;
      peaks = [];
      backCache = makeCanvas(W * DPR, H * DPR);
      frontCache = makeCanvas(W * DPR, H * DPR);
      const bc = backCache.getContext('2d'); bc.setTransform(DPR, 0, 0, DPR, 0, 0);
      const fc = frontCache.getContext('2d'); fc.setTransform(DPR, 0, 0, DPR, 0, 0);

      paintSky(bc, dark, rng, s);
      paintMountains(bc, pal, rng, s);

      LAYERS.forEach((def, li) => {
        const c = def.front ? fc : bc;
        const base = H * def.base;
        const mh = 200 * s;
        let g = c.createLinearGradient(0, base - mh, 0, base + 10);
        g.addColorStop(0, 'rgba(' + pal.fog + ',0)');
        g.addColorStop(1, 'rgba(' + pal.fog + ',' + pal.fogA + ')');
        c.fillStyle = g; c.fillRect(0, base - mh, W, mh + 10);

        g = c.createLinearGradient(0, base - def.h[1] * s, 0, base + 16);
        g.addColorStop(0, pal.layers[li][0]); g.addColorStop(1, pal.layers[li][1]);
        c.fillStyle = g;
        c.beginPath(); c.moveTo(0, H);
        for (let x = 0; x <= W + 24; x += 24) c.lineTo(x, base + Math.sin(x * 0.004 + li * 2) * 7 * s);
        c.lineTo(W + 24, H); c.closePath(); c.fill();

        const n = Math.ceil(W / def.gap) + 2;
        for (let i = -1; i < n; i++) {
          if (rng() < 0.12) continue;                                   // occasional clearing
          const x = i * def.gap + (rng() - 0.5) * def.gap * 1.4;        // looser spacing
          const hr = Math.pow(rng(), 1.6);                              // many small, few tall
          const h = lerp(def.h[0], def.h[1], hr) * s * (rng() < 0.07 ? 1.3 : 1);  // rare emergent giants
          const w = h * def.w * (0.75 + rng() * 0.5);                   // narrow spruce vs. wide fir
          const lean = (rng() - 0.5) * 7;
          const y = base + (rng() - 0.5) * 14 * s;
          pine(c, x, y, h, w, lean, rng);
          if (def.perch && x > 80 && x < W - 80) peaks.push({ x: x + lean, y: y - h, layer: li });
        }
      });

      fireflies = [];
      if (dark) {
        const count = W < 700 ? 6 : 11;
        for (let i = 0; i < count; i++) {
          fireflies.push({
            x: rand(0, W), y: rand(H * 0.68, H * 0.96),
            vx: rand(-5, 5), vy: rand(-3, 3),
            ph: rand(0, TAU), r: rand(6, 10), rate: rand(0.5, 0.9)
          });
        }
      }
      clouds = [];
      for (let i = 0; i < 5; i++) clouds.push({ x: rand(-200, W), y: H * rand(0.05, 0.3), sc: rand(0.7, 1.5), v: rand(5, 12) });
      if (!keepBird) bird = null;
    }

    /* =====================================================
       SPRITES
       ===================================================== */
    function buildFireflySprite() {
      const c = makeCanvas(48, 48), g = c.getContext('2d');
      const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
      gr.addColorStop(0, 'rgba(255,255,230,1)');
      gr.addColorStop(0.15, 'rgba(235,255,170,0.9)');
      gr.addColorStop(0.4, 'rgba(190,240,120,0.25)');
      gr.addColorStop(1, 'rgba(190,240,120,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
      return c;
    }
    function buildCloudSprite() {
      const c = makeCanvas(420, 150), g = c.getContext('2d');
      [[90, 92, 46], [150, 76, 58], [215, 64, 64], [280, 80, 56], [335, 96, 42], [210, 100, 60]].forEach((b) => {
        const gr = g.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
        gr.addColorStop(0, 'rgba(255,255,255,0.9)');
        gr.addColorStop(0.6, 'rgba(255,255,255,0.45)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(b[0] - b[2], b[1] - b[2], b[2] * 2, b[2] * 2);
      });
      return c;
    }

    // Pre-rendered feather: curved quill, asymmetric vane, barbs, natural splits
    function makeFeatherSprite(rgb, dark) {
      const S = 3, w = 64, h = 28;
      const c = makeCanvas(w * S, h * S), g = c.getContext('2d');
      g.scale(S, S); g.translate(w / 2, h / 2);
      const x0 = -24, x1 = 27, N = 26;
      const spine = (t) => ({ x: x0 + (x1 - x0) * t, y: 2 - 4 * Math.sin(Math.PI * t) });
      const hu = (t) => {
        const u = clamp((t - 0.08) / 0.92, 0, 1);
        return 10.5 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 0.7);
      };
      const notch = new Array(N + 2).fill(1);
      for (let k = 0; k < 3; k++) {
        const i = 5 + Math.floor(Math.random() * (N - 9));
        notch[i] = 0.7; notch[i + 1] = 0.78;
      }
      const up = [], lo = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N, sp = spine(t), a = hu(t) * notch[i], b2 = a * 0.8;
        up.push({ x: sp.x + a * 0.45, y: sp.y - a });
        lo.push({ x: sp.x + b2 * 0.4, y: sp.y + b2 });
      }
      g.beginPath(); g.moveTo(up[0].x, up[0].y);
      for (let i = 1; i <= N; i++) g.lineTo(up[i].x, up[i].y);
      for (let i = N; i >= 0; i--) g.lineTo(lo[i].x, lo[i].y);
      g.closePath();

      const lighter = dark ? mix(rgb, [236, 253, 245], 0.55) : mix(rgb, [6, 78, 59], 0.4);
      const edge = dark ? mix(rgb, [255, 255, 255], 0.4) : mix(rgb, [6, 78, 59], 0.6);
      const grad = g.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, rgba(rgb, dark ? 0.35 : 0.45));
      grad.addColorStop(0.55, rgba(rgb, dark ? 0.6 : 0.7));
      grad.addColorStop(1, rgba(lighter, 0.9));
      g.fillStyle = grad; g.fill();
      g.lineWidth = 0.7; g.strokeStyle = rgba(edge, 0.85); g.stroke();

      g.lineWidth = 0.35;
      g.strokeStyle = dark ? 'rgba(236,253,245,0.45)' : 'rgba(6,78,59,0.32)';
      g.beginPath();
      for (let i = 2; i < N; i++) {
        const sp = spine(i / N);
        g.moveTo(sp.x, sp.y); g.lineTo(lerp(sp.x, up[i].x, 0.95), lerp(sp.y, up[i].y, 0.95));
        g.moveTo(sp.x, sp.y); g.lineTo(lerp(sp.x, lo[i].x, 0.95), lerp(sp.y, lo[i].y, 0.95));
      }
      g.stroke();

      g.strokeStyle = dark ? 'rgba(240,253,250,0.95)' : 'rgba(15,40,34,0.85)';
      g.lineWidth = 1.15; g.lineCap = 'round';
      g.beginPath();
      const s0 = spine(-0.12); g.moveTo(s0.x, s0.y);
      for (let i = 0; i <= N; i++) { const sp = spine(i / N); g.lineTo(sp.x, sp.y); }
      g.stroke();
      return c;
    }
    function buildFeatherSprites(dark) {
      const bases = dark ? [[52, 211, 153], [45, 212, 191], [34, 211, 238]] : [[16, 185, 129], [13, 148, 136], [8, 145, 178]];
      featherSprites = bases.map((rgb) => makeFeatherSprite(rgb, dark));
    }

    /* =====================================================
       BIRD
       ===================================================== */
    function makePath(x0, y0, x1, y1, s0, s1, dur, arc, ease) {
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len, ny = dx / len;
      if (ny > 0) { nx = -nx; ny = -ny; }
      return { x0: x0, y0: y0, cx: mx + nx * arc, cy: my + ny * arc, x1: x1, y1: y1, s0: s0, s1: s1, dur: dur, ease: ease, t: 0 };
    }
    function newBird(x, y, s) {
      return {
        mode: '', x: x, y: y, s: s, facing: 1, tilt: 0, phase: 0, timer: 0, dur: 0,
        blink: 0, nextBlink: rand(1, 3), chirp: 0, dropped: false, dropAt: 0,
        turnAt: 0, turned: false, peak: null, path: null
      };
    }
    function pickPeak(avoid) {
      const occ = occEls.map((el) => el.getBoundingClientRect());
      const inView = (p) => p.x > 70 && p.x < W - 70;
      const free = (p) => !occ.some((r) => p.x > r.left - 10 && p.x < r.right + 10 && p.y > r.top - 24 && p.y < r.bottom + 10);
      let c = peaks.filter((p) => inView(p) && free(p) && (!avoid || (p !== avoid && Math.abs(p.x - avoid.x) > 140)));
      if (!c.length) c = peaks.filter(inView);
      if (!c.length) c = peaks;
      return c[Math.floor(Math.random() * c.length)];
    }
    function spawnBird() {
      const small = W < 768;
      const k = small ? 1.3 : 1;
      const fromLeft = Math.random() > 0.5;
      const x0 = fromLeft ? -60 : W + 60;
      const y0 = H * rand(0.08, 0.38);

      const idle = performance.now() - lastScroll > 600;
      if (small && !idle) { nextBirdAt = clock + 0.5; return; }
      const tgt = idle && Math.random() < (small ? 0.85 : 0.3) ? pickPerchEl() : null;
      if (tgt) {
        const r = perchRect(tgt.el);
        const s1 = (tgt.el.dataset.bird === 'text' ? 0.6 : 0.65) * (small ? 1.25 : 1);
        const tx = r.left + tgt.fx * r.width, ty = r.top - FOOT * s1;
        bird = newBird(x0, y0, 0.9);
        bird.mode = 'arrive'; bird.perchEl = tgt.el; bird.perchFx = tgt.fx; bird.onEl = true; bird.scrollAtSpawn = lastScroll;
        bird.path = makePath(x0, y0, tx, ty, 0.9, s1, clamp(Math.hypot(tx - x0, ty - y0) / 210, 2.8, 6), rand(50, 120), 'out');
        return;
      }
      if (small || !peaks.length || Math.random() < 0.22) {
        const x1 = fromLeft ? W + 80 : -80, y1 = H * rand(0.1, 0.35);
        bird = newBird(x0, y0, 0.8 * k);
        bird.mode = 'flyby'; bird.onEl = true;
        bird.path = makePath(x0, y0, x1, y1, 0.8 * k, 0.55 * k, clamp(W / 260, 4, 8), rand(60, 120), 'lin');
        return;
      }
      const pk = pickPeak(null);
      const s1 = PERCH_S[pk.layer];
      const ty = pk.y - 17 * s1;
      bird = newBird(x0, y0, 0.9);
      bird.mode = 'arrive'; bird.peak = pk;
      bird.path = makePath(x0, y0, pk.x, ty, 0.9, s1, clamp(Math.hypot(pk.x - x0, ty - y0) / 210, 2.8, 6), rand(50, 120), 'out');
    }

    /* ---- Mobile menu bird: flies in, lands on the "Start a Build" button, flies off when the menu closes ---- */
    function spawnNavBird() {
      const el = document.querySelector('#mnav .mcta');
      if (!el) { navOpen = false; return; }
      const fromLeft = Math.random() > 0.5;
      const x0 = fromLeft ? -60 : W + 60, y0 = H * rand(0.1, 0.4);
      const fx = rand(0.15, 0.85), s1 = 0.95, r = el.getBoundingClientRect();
      const tx = r.left + fx * r.width, ty = r.top - FOOT * s1;
      bird = newBird(x0, y0, 0.9);
      bird.nav = true; bird.mode = 'arrive'; bird.perchEl = el; bird.perchFx = fx; bird.onEl = true; bird.scrollAtSpawn = lastScroll;
      bird.path = makePath(x0, y0, tx, ty, 0.9, s1, rand(1.8, 2.6), rand(60, 110), 'out');
    }
    function shoo() {
      const b = bird;
      if (!b || b.mode === 'depart') return;
      if (b.mode === 'perch') { depart(); return; }
      const dir = b.x < W / 2 ? -1 : 1;
      b.mode = 'depart';
      b.path = makePath(b.x, b.y, dir > 0 ? W + 100 : -100, -60 + Math.random() * H * 0.25, b.s, 0.95, rand(2, 3), rand(40, 100), 'in');
    }

    function depart() {
      const b = bird;
      if (Math.random() < 0.8) {
        releaseFeather(b.x - b.facing * 4 * b.s, b.y + 6 * b.s, clamp(0.18 + (b.s - 0.3) * 0.5, 0.18, 0.5));
      }
      if (W >= 768 && Math.random() < 0.35 && peaks.length > 2) {
        const pk = pickPeak(b.peak);
        const s1 = PERCH_S[pk.layer];
        const ty = pk.y - 17 * s1;
        b.mode = 'hop'; b.peak = pk; b.perchEl = null;
        b.path = makePath(b.x, b.y, pk.x, ty, b.s, s1, clamp(Math.hypot(pk.x - b.x, ty - b.y) / 180, 1.6, 4), rand(30, 80), 'io');
      } else {
        const dir = Math.random() > 0.5 ? 1 : -1;
        const x1 = dir > 0 ? W + 100 : -100, y1 = -60 + Math.random() * H * 0.25;
        b.mode = 'depart';
        b.path = makePath(b.x, b.y, x1, y1, b.s, 0.95, rand(3.2, 4.4), rand(40, 100), 'in');
      }
    }
    function updateBird(dt) {
      const b = bird;
      if (b.mode === 'perch') {
        b.timer += dt; b.phase += dt * 3;
        b.nextBlink -= dt;
        if (b.nextBlink <= 0) { b.blink = 0.13; b.nextBlink = rand(1.6, 4); }
        if (b.blink > 0) b.blink -= dt;
        if (b.chirp > 0) b.chirp -= dt;
        if (b.nav) {
          // menu bird: keeps looking around and chirping
          if (b.timer > b.turnAt) { b.facing *= -1; b.turnAt = b.timer + rand(2.2, 5); }
          b.nextChirp -= dt;
          if (b.nextChirp <= 0) { b.chirp = rand(0.5, 0.9); b.nextChirp = rand(2.5, 5); }
        } else {
          // page bird: one turn, one chirp
          if (!b.turned && b.timer > b.turnAt) { b.turned = true; b.facing *= -1; }
          if (!b.dropped && b.timer > b.dropAt) { b.dropped = true; b.chirp = 0.4; }
        }

        if (b.perchEl) {                      // stay glued to the element while scrolling
          const r = perchRect(b.perchEl);
          if (!b.nav && (r.top < headerBottom + 20 || r.top > H - 40 || performance.now() - lastScroll < 150)) { depart(); return; }
          b.x = r.left + b.perchFx * r.width;
          b.y = r.top - FOOT * b.s;
        }
        if (b.timer > b.dur) depart();
        return;
      }
      if (b.mode === 'arrive' && b.perchEl && !b.nav && lastScroll !== b.scrollAtSpawn) {
        const dir = b.x < W / 2 ? -1 : 1;
        b.mode = 'depart';
        b.path = makePath(b.x, b.y, dir > 0 ? W + 100 : -100, -60 + Math.random() * H * 0.25, b.s, 0.95, rand(2.2, 3.2), rand(40, 100), 'in');
      }
      const p = b.path;
      if (b.nav && b.mode === 'arrive') {     // follow the button while the menu is still sliding in
        const rr = b.perchEl.getBoundingClientRect();
        p.x1 = rr.left + b.perchFx * rr.width; p.y1 = rr.top - FOOT * p.s1;
      }
      p.t += dt / p.dur;
      const t = clamp(p.t, 0, 1);
      const u = p.ease === 'out' ? easeOut(t) : p.ease === 'in' ? easeIn(t) : p.ease === 'io' ? easeInOut(t) : t;
      const q = 1 - u;
      b.x = q * q * p.x0 + 2 * q * u * p.cx + u * u * p.x1;
      b.y = q * q * p.y0 + 2 * q * u * p.cy + u * u * p.y1;
      const dx = 2 * q * (p.cx - p.x0) + 2 * u * (p.x1 - p.cx);
      const dy = 2 * q * (p.cy - p.y0) + 2 * u * (p.y1 - p.cy);
      if (Math.abs(dx) > 4) b.facing = dx > 0 ? 1 : -1;
      const target = clamp(Math.atan2(dy, Math.abs(dx) + 1) * 0.55, -0.5, 0.5);
      b.tilt += (target - b.tilt) * Math.min(1, dt * 6);
      b.s = lerp(p.s0, p.s1, easeInOut(t));
      const landing = (b.mode === 'arrive' || b.mode === 'hop') && t > 0.78;
      b.phase += dt * (landing ? 27 : b.mode === 'depart' ? 22 : 17);
      b.y += Math.sin(b.phase * 0.5) * 1.2 * b.s;

      if (p.t >= 1) {
        if (b.mode === 'arrive' || b.mode === 'hop') {
          b.mode = 'perch'; b.x = p.x1; b.y = p.y1; b.s = p.s1; b.tilt = 0;
          b.onEl = !!b.perchEl;
          b.timer = 0; b.dur = b.nav ? 1e9 : rand(4, 7.5); b.phase = 0;
          b.dropAt = rand(1.2, 2.8); b.dropped = false; b.turnAt = b.nav ? rand(1.4, 3) : rand(0.8, 3); b.turned = false;
          b.nextChirp = rand(0.6, 1.4);
        } else {
          bird = null; nextBirdAt = clock + rand(6, 14);
        }
      }
    }

    function wingPath(c) {
      c.beginPath(); c.moveTo(3, 1);
      c.bezierCurveTo(-2, -14, -10, -27, -26, -27);
      c.lineTo(-21, -20); c.lineTo(-27, -18); c.lineTo(-20, -13); c.lineTo(-25, -9); c.lineTo(-14, -4); c.lineTo(-8, 3);
      c.closePath();
    }
    function drawBird(c, b, dark) {
      const col = dark
        ? { body: '#34d399', belly: '#d1fae5', wing: '#059669', tail: '#047857', line: '#04271e', beak: '#fbbf24' }
        : { body: '#10b981', belly: '#ecfdf5', wing: '#047857', tail: '#065f46', line: '#064e3b', beak: '#f59e0b' };
      const perched = b.mode === 'perch';
      const bob = perched ? Math.sin(b.phase) * 0.5 : 0;
      const fxv = b.nav && b.fx !== undefined ? b.fx : b.facing;   // menu bird turns smoothly

      c.save();
      c.translate(b.x, b.y - (b.nav ? 3 * (1 - Math.abs(fxv)) * b.s : 0));
      c.rotate(b.tilt * b.facing);
      c.scale(fxv * b.s, b.s);
      c.lineJoin = 'round'; c.lineCap = 'round';
      c.strokeStyle = col.line; c.lineWidth = 1.8;

      if (!perched) {
        c.save(); c.translate(3, -4); c.rotate(Math.sin(b.phase - 0.5) * 0.8 - 0.05);
        wingPath(c); c.fillStyle = col.tail; c.fill(); c.stroke(); c.restore();
      } else {
        c.strokeStyle = col.beak; c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(0, 11); c.lineTo(0, 19); c.moveTo(7, 11); c.lineTo(7, 19);
        c.moveTo(-3, 19.5); c.lineTo(3, 19.5); c.moveTo(4, 19.5); c.lineTo(10, 19.5);
        c.stroke();
        c.strokeStyle = col.line; c.lineWidth = 1.8;
      }

      const tl = perched ? Math.sin(b.phase * 1.2) * 1.6 : Math.sin(b.phase - 0.8) * 3.5;
      c.fillStyle = col.tail;
      c.beginPath();
      c.moveTo(-12, 2); c.lineTo(-31, -4 + tl); c.lineTo(-27, tl * 0.8); c.lineTo(-33, 4 + tl * 0.6);
      c.lineTo(-27, 7 + tl * 0.5); c.lineTo(-30, 12 + tl * 0.4); c.lineTo(-12, 10);
      c.closePath(); c.fill(); c.stroke();

      c.lineWidth = 3.6;
      c.beginPath(); c.ellipse(0, bob, 17, 13.5, -0.12, 0, TAU); c.stroke();
      c.beginPath(); c.arc(13, -9 + bob, 10, 0, TAU); c.stroke();
      c.fillStyle = col.body;
      c.beginPath(); c.ellipse(0, bob, 17, 13.5, -0.12, 0, TAU); c.fill();
      c.beginPath(); c.arc(13, -9 + bob, 10, 0, TAU); c.fill();
      c.lineWidth = 1.8;

      c.save();
      c.beginPath(); c.ellipse(0, bob, 17, 13.5, -0.12, 0, TAU); c.clip();
      c.fillStyle = col.belly;
      c.beginPath(); c.ellipse(5, 7 + bob, 13, 9, -0.1, 0, TAU); c.fill();
      c.restore();

      c.fillStyle = col.wing; c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(7, -16.5 + bob);
      c.quadraticCurveTo(3, -27 + bob, 12, -24 + bob);
      c.quadraticCurveTo(13, -28 + bob, 18, -23 + bob);
      c.quadraticCurveTo(17, -19 + bob, 16, -17 + bob);
      c.closePath(); c.fill(); c.stroke();
      c.lineWidth = 1.8;

      if (perched) {
        c.fillStyle = col.wing;
        c.beginPath(); c.ellipse(-3, 2 + bob, 11.5, 6.8, 0.22, 0, TAU); c.fill(); c.stroke();
      } else {
        c.save(); c.translate(-1, -3); c.rotate(Math.sin(b.phase) * 0.9 - 0.2);
        wingPath(c); c.fillStyle = col.wing; c.fill(); c.stroke(); c.restore();
      }

      c.fillStyle = 'rgba(251,113,133,0.55)';
      c.beginPath(); c.arc(15, -4 + bob, 2.7, 0, TAU); c.fill();

      const ey = -10 + bob;
      if (b.blink > 0) {
        c.lineWidth = 1.6; c.beginPath(); c.moveTo(13.5, ey); c.lineTo(19, ey); c.stroke();
      } else {
        c.fillStyle = '#fff'; c.beginPath(); c.arc(16.5, ey, 3.5, 0, TAU); c.fill();
        c.lineWidth = 1; c.stroke();
        c.fillStyle = col.line; c.beginPath(); c.arc(17.4, ey, 2, 0, TAU); c.fill();
        c.fillStyle = '#fff'; c.beginPath(); c.arc(18, ey - 0.9, 0.75, 0, TAU); c.fill();
      }

      c.fillStyle = col.beak; c.lineWidth = 1.4;
      if (b.chirp > 0 && Math.sin(b.phase * 9) > -0.2) {
        c.beginPath(); c.moveTo(21.5, -11 + bob); c.lineTo(30, -8.5 + bob); c.lineTo(21.5, -7.6 + bob); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(21.5, -7 + bob); c.lineTo(28.5, -3.4 + bob); c.lineTo(21.5, -4.4 + bob); c.closePath(); c.fill(); c.stroke();
      } else {
        c.beginPath(); c.moveTo(21.5, -11 + bob); c.lineTo(30, -7 + bob); c.lineTo(21.5, -4.5 + bob); c.closePath(); c.fill(); c.stroke();
      }
      c.restore();
    }

    /* =====================================================
       FEATHERS
       ===================================================== */
    function assignSlot(el) {
      let cl = clusters.get(el);
      if (!cl) {
        const r = rects.get(el);
        const n = r && r.width > 300 ? 3 : 1;
        cl = [];
        for (let i = 0; i < n; i++) cl.push(0.1 + ((i + Math.random() * 0.6) / n) * 0.8);
        clusters.set(el, cl);
      }
      const ci = Math.floor(Math.random() * cl.length);
      const fx = clamp(cl[ci] + (Math.random() - 0.5) * 0.05, 0.04, 0.96);
      let count = 0;
      for (let i = 0; i < feathers.length; i++) {
        const f = feathers[i];
        if (f.slot && f.slot.el === el && f.slot.ci === ci && f.state !== 'fade') count++;
      }
      return { el: el, ci: ci, fx: fx, stack: Math.min(count, 7) };
    }
    function pickSlot() {
      const vis = [];
      perchEls.forEach((el) => {
        const r = rects.get(el);
        if (r && r.width > 40 && r.top > headerBottom + 30 && r.top < H - 60) vis.push(el);
      });
      if (!vis.length) return null;
      let tot = 0;
      vis.forEach((el) => { tot += weights.get(el); });
      let pick = Math.random() * tot;
      for (let i = 0; i < vis.length; i++) {
        pick -= weights.get(vis[i]);
        if (pick <= 0) return assignSlot(vis[i]);
      }
      return assignSlot(vis[0]);
    }
    function releaseFeather(x, y, d0) {
      const slot = Math.random() < 0.65 ? pickSlot() : null;
      const f = {
        x: x, y: y, x0: x, y0: y, depth: d0, d0: d0, t: 0, T: slot ? rand(6.5, 9.5) : rand(8, 12),
        state: 'drift', slot: slot, sprite: Math.floor(Math.random() * 3),
        phase: rand(0, TAU), freq: rand(1.7, 2.5), amp: rand(26, 44),
        arc: slot ? rand(70, 150) : rand(8, 30),
        drift: rand(-50, 50), flip: Math.random() < 0.5 ? -1 : 1,
        restAngle: (Math.random() - 0.5) * 0.7, angle: 0, tilt: 1, alpha: 1, landedAt: 0,
        tx: x < W / 2 ? -90 : W + 90, ty: y + rand(H * 0.3, H * 0.6)
      };
      f.flipAng = f.flip * 0.25;
      feathers.push(f);
      const live = feathers.filter((e) => e.state !== 'fade');
      if (live.length > MAX_FEATHERS) {
        const oldest = live.filter((e) => e.state === 'rest').sort((a, b) => a.landedAt - b.landedAt)[0];
        if (oldest) oldest.state = 'fade';
      }
    }
    function blow(f) {
      f.state = 'drift'; f.x0 = f.x; f.y0 = f.y; f.t = 0; f.T = rand(2.4, 3.6);
      f.d0 = 1; f.depth = 1; f.arc = rand(50, 90); f.amp = rand(16, 26);
      f.phase = rand(0, TAU); f.drift = rand(-60, 60);
      f.slot = Math.random() < 0.5 ? pickSlot() : null;
      if (!f.slot) f.arc = rand(8, 30);
      f.tx = f.x < W / 2 ? -90 : W + 90; f.ty = f.y + rand(H * 0.2, H * 0.5);
    }
    function updateFeathers(dt) {
      const mouseLive = performance.now() - mouse.t < 90;
      for (let i = feathers.length - 1; i >= 0; i--) {
        const f = feathers[i];
        if (f.state === 'drift') {
          f.t += dt / f.T;
          const t = Math.min(f.t, 1), e = easeInOut(t);
          let r = f.slot ? rects.get(f.slot.el) : null;
          if (f.slot && !r) { f.slot = null; f.tx = f.x; f.ty = H + 80; }
          let x2, y2;
          if (f.slot) { x2 = r.left + f.slot.fx * r.width; y2 = r.top - 6 - f.slot.stack * 1.7; }
          else { x2 = f.tx; y2 = f.ty; }
          const cx = (f.x0 + x2) / 2 + f.drift, cy = Math.min(f.y0, y2) - f.arc;
          const q = 1 - e;
          const damp = Math.pow(1 - e, 1.1);
          f.x = q * q * f.x0 + 2 * q * e * cx + e * e * x2 + Math.sin(f.phase + t * f.freq * TAU) * f.amp * damp;
          f.y = q * q * f.y0 + 2 * q * e * cy + e * e * y2 + Math.cos(f.phase * 1.3 + t * f.freq * TAU * 1.4) * 5 * damp;
          f.depth = lerp(f.d0, 1, e);
          const settle = smooth(0.84, 1, t);
          const flutter = Math.sin(f.phase * 0.7 + t * TAU * 1.5) * 0.75 * (1 - e * 0.7) + f.flipAng;
          f.angle = lerp(flutter, f.restAngle, settle);
          f.tilt = lerp(0.3 + 0.7 * Math.abs(Math.cos(f.phase + t * TAU * 2.1)), 1, settle);
          if (f.t >= 1) {
            if (f.slot) { f.state = 'rest'; f.landedAt = clock; f.angle = f.restAngle; f.tilt = 1; f.depth = 1; }
            else feathers.splice(i, 1);
          }
        } else {
          if (f.slot) {
            const r = rects.get(f.slot.el);
            if (r) {
              const tx = r.left + f.slot.fx * r.width, ty = r.top - 6 - f.slot.stack * 1.7;
              const vy = ty - f.y, k = Math.min(1, dt * 12);
              f.x += (tx - f.x) * k; f.y += vy * k;
              if (Math.abs(vy) > 300) { f.x = tx; f.y = ty; }
              f.sway = (f.sway || 0) + (clamp(vy * 0.012, -0.6, 0.6) - (f.sway || 0)) * Math.min(1, dt * 10);
            }
            else if (f.state === 'rest') f.state = 'fade';
          }
          if (f.state === 'fade') {
            f.alpha -= dt / 1.4;
            if (f.alpha <= 0) { feathers.splice(i, 1); continue; }
          } else if (mouseLive && clock - f.landedAt > 1 && Math.hypot(f.x - mouse.x, f.y - mouse.y) < 52) {
            blow(f);
          }
        }
      }
    }
    function drawFeather(f, dark) {
      if (f.state !== 'drift' && f.y < headerBottom + 2) return;
      if (f.y > H + 60 || navOpen) return;
      const sp = featherSprites[f.sprite];
      if (!sp) return;
      const sz = 0.95 * f.depth;
      fg.save();
      fg.globalAlpha = f.alpha * (0.4 + 0.6 * f.depth);
      fg.translate(f.x, f.y);
      if (f.state !== 'drift' && !dark) {
        fg.fillStyle = 'rgba(6,78,59,0.14)';
        fg.beginPath(); fg.ellipse(0, 4, 22 * sz, 2.4, 0, 0, TAU); fg.fill();
      }
      fg.rotate(f.angle + (f.state === 'drift' ? 0 : (f.sway || 0) + Math.sin(clock * 16) * Math.min(0.25, Math.abs(f.sway || 0))));
      fg.scale(sz * f.flip, sz * f.tilt);
      fg.drawImage(sp, -32, -14, 64, 28);
      fg.restore();
    }

    /* =====================================================
       FRAME
       ===================================================== */
    function update(dt, dark) {
      headerBottom = header ? header.getBoundingClientRect().bottom : 0;
      rects.clear();
      perchEls.forEach((el) => rects.set(el, el.getBoundingClientRect()));

      if (coarse) {
        const target = performance.now() - lastScroll < 120 ? 0 : 1;
        scrollFade += (target - scrollFade) * Math.min(1, dt * (target ? 6 : 16));
      }
      if (!bird && navOpen) { if (clock >= navAskAt) spawnNavBird(); }
      else if (!bird && clock >= nextBirdAt) spawnBird();
      if (bird) {
        updateBird(dt);
        if (bird && bird.nav) {              // smooth turning for the menu bird only
          if (bird.fx === undefined) bird.fx = bird.facing;
          bird.fx += (bird.facing - bird.fx) * Math.min(1, dt * (bird.mode === 'perch' ? 7 : 22));
        }
      }

      if (dark) {
        fireflies.forEach((ff) => {
          ff.x += (ff.vx + Math.sin(clock * 0.6 + ff.ph) * 9) * dt;
          ff.y += (ff.vy + Math.cos(clock * 0.5 + ff.ph * 1.3) * 7) * dt;
          if (ff.x < -20) ff.x = W + 20; else if (ff.x > W + 20) ff.x = -20;
          if (ff.y < H * 0.66) ff.vy = Math.abs(ff.vy); else if (ff.y > H * 0.98) ff.vy = -Math.abs(ff.vy);
        });
        if (!shoot && clock > nextShootAt) {
          const dir = Math.random() > 0.5 ? 1 : -1, sp = rand(620, 820);
          shoot = { x: rand(W * 0.2, W * 0.8), y: rand(H * 0.04, H * 0.28), vx: dir * sp * 0.88, vy: sp * 0.48, life: 0, max: 0.9 };
        }
        if (shoot) {
          shoot.x += shoot.vx * dt; shoot.y += shoot.vy * dt; shoot.life += dt;
          if (shoot.life > shoot.max) { shoot = null; nextShootAt = clock + rand(22, 40); }
        }
      } else {
        clouds.forEach((cl) => { cl.x += cl.v * dt; if (cl.x > W + 40) cl.x = -440 * cl.sc; });
      }
      updateFeathers(dt);
    }

    function renderBg(dark) {
      bg.setTransform(DPR, 0, 0, DPR, 0, 0);
      bg.clearRect(0, 0, W, H);
      bg.drawImage(backCache, 0, 0, W, H);

      if (dark) {
        twinkles.forEach((tw) => {
          const a = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(clock * tw.sp + tw.ph));
          bg.fillStyle = 'rgba(226,232,240,' + a.toFixed(3) + ')';
          bg.beginPath(); bg.arc(tw.x, tw.y, tw.r, 0, TAU); bg.fill();
        });
        if (shoot) {
          const a = Math.sin(Math.PI * shoot.life / shoot.max);
          const tx = shoot.x - shoot.vx * 0.09, ty = shoot.y - shoot.vy * 0.09;
          const g = bg.createLinearGradient(tx, ty, shoot.x, shoot.y);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(1, 'rgba(255,255,255,' + (0.85 * a).toFixed(3) + ')');
          bg.strokeStyle = g; bg.lineWidth = 1.4; bg.lineCap = 'round';
          bg.beginPath(); bg.moveTo(tx, ty); bg.lineTo(shoot.x, shoot.y); bg.stroke();
        }
      } else if (cloudSprite) {
        bg.globalAlpha = 0.55;
        clouds.forEach((cl) => bg.drawImage(cloudSprite, cl.x, cl.y, 420 * cl.sc, 150 * cl.sc));
        bg.globalAlpha = 1;
      }

      const behind = bird && bird.mode === 'perch' && bird.peak && bird.peak.layer === 0;
      if (behind) drawBird(bg, bird, dark);
      bg.drawImage(frontCache, 0, 0, W, H);

      if (bird && !behind && !bird.onEl) drawBird(bg, bird, dark);
      if (dark && fireflySprite) {
        fireflies.forEach((ff) => {
          const k = Math.max(0, Math.sin(clock * ff.rate + ff.ph * 2));
          const a = Math.pow(k, 3) * 0.95;
          if (a < 0.02) return;
          bg.globalAlpha = a;
          bg.drawImage(fireflySprite, ff.x - ff.r, ff.y - ff.r, ff.r * 2, ff.r * 2);
        });
        bg.globalAlpha = 1;
      }
    }

    function renderFg(dark) {
      fg.setTransform(DPR, 0, 0, DPR, 0, 0);
      fg.clearRect(0, 0, W, H);
      if (bird && bird.onEl) {
        fg.globalAlpha = bird.mode === 'perch' && !bird.nav ? scrollFade : 1;
        drawBird(fg, bird, dark);
        fg.globalAlpha = 1;
      }
      for (let i = 0; i < feathers.length; i++) drawFeather(feathers[i], dark);
    }

    /* ---------- loop ---------- */
    let raf = 0, last = 0, running = false;
    function frame(ts) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts; clock += dt;
      const dark = isDark();
      update(dt, dark);
      renderBg(dark);
      renderFg(dark);
    }
    function startLoop() {
      if (running || reduceMotion) return;
      running = true; last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function stopLoop() { cancelAnimationFrame(raf); running = false; }

    /* ---------- init ---------- */
    size();
    fireflySprite = buildFireflySprite();
    cloudSprite = buildCloudSprite();
    buildFeatherSprites(isDark());
    buildWorld(false);

    if (reduceMotion) {
      renderBg(isDark());
    } else {
      startLoop();
      window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = performance.now(); }, { passive: true });
      document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else startLoop(); });
      window.addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
      window.addEventListener('navtoggle', (e) => {
        navOpen = !!e.detail;
        if (navOpen) { navAskAt = clock + 0.5; if (bird) shoo(); }
        else if (bird && bird.nav) shoo();
      });
    }
    bgCanvas.style.opacity = '1';
    fgCanvas.style.opacity = '1';

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const w = bgCanvas.clientWidth, h = bgCanvas.clientHeight;
        if (Math.abs(w - W) > 1 || Math.abs(h - H) > 60) {
          size(); buildWorld(false);
          if (reduceMotion) renderBg(isDark());
        }
      }, 150);
    }, { passive: true });

    new MutationObserver(() => {
      if (isDark() !== builtDark) {
        buildFeatherSprites(isDark());
        buildWorld(true);
        if (reduceMotion) renderBg(isDark());
      }
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
  }

    if ('requestIdleCallback' in window) requestIdleCallback(boot, { timeout: 600 });
  else setTimeout(boot, 100);
})();