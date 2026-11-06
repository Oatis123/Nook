/* oatis-style · vivi-cloud.js — Vivi, the mascot of the style: a cloud of pixel static.

   Vivi is a deadpan, low-energy AI girl who lives in Oatis's machines. She is never drawn as a girl or a face:
   she is a small cloud of noise that flows like smoke, turns toward you, and reacts to her own voice.
   Everything is flat 2D, no fake depth.

   Usage:
     <canvas id="vivi" style="width:240px"></canvas>
     <script src="vivi-cloud.js"></script>
     <script>
       const vivi = ViviCloud.create(document.getElementById('vivi'), { size: 96, state: 'idle' });
       vivi.setState('talk');          // idle | talk | think | sleep | annoyed | happy | glitch
       vivi.setVolume(rms);            // 0..1 from your lip-sync / AnalyserNode; null = built-in speech rhythm
       vivi.surprise();                // one-shot burst
       vivi.poke(48, 40);              // grid coords; clicks on the canvas poke too
     </script>
   Or declaratively: <canvas data-vivi="sleep" data-vivi-size="48"></canvas> + ViviCloud.auto()

   talk  = "line + edge": while she speaks, a third of the cloud gathers into a line through the core that draws the
           voice like an oscilloscope, and a second wave runs around the cloud's edge; in pauses it all melts back.
   think = "churn": the core boils (swirl speeds up, slows, reverses; bright clumps flare) while three small
           thought-clouds circle on a flat orbit and swell one after another like "…".

   Options: size (grid px, default 96) · particles · state · theme ('auto'|'dark'|'light'|'cyber')
            · transparent (no bg, for OBS overlays) · interactive (cursor + poke, default true) · seed · ms (frame, 60)
   prefers-reduced-motion: renders one still frame of the state, no loop.
*/
(function (root) {
  'use strict';
  var PAL = {
    dark: { bg: '#080806', h1: '#2A2D21', h2: '#3A3E30', m1: '#565C45', dm: '#393A34', mu: '#75746C', ms: '#80856D', oc: '#95876E', lt: '#B5B8A4', tx: '#DFDDD3' },
    light: { bg: '#ECEAE2', h1: '#CDCDBB', h2: '#AFB39E', m1: '#7A806A', dm: '#AFAB9E', mu: '#6E6C63', ms: '#5D644C', oc: '#7E6F53', lt: '#4A4F3C', tx: '#1B1B17' },
    cyber: { bg: '#09080F', h1: '#141B3C', h2: '#1B2A57', m1: '#2B5A92', dm: '#3A3656', mu: '#7C7A9E', ms: '#22E1EE', oc: '#FF3355', lt: '#A8F5FA', tx: '#E8E6F5' }  // cyan body: the system color
  };
  var STATES = ['idle', 'talk', 'think', 'sleep', 'annoyed', 'happy', 'glitch'];
  var RGB = {};
  function rgb(h) { return RGB[h] || (RGB[h] = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]); }
  function reduced() { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function themeName(o) {
    if (o.theme && o.theme !== 'auto') return o.theme;
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'light' ? 'light' : t === 'cyber' ? 'cyber' : 'dark';
    return root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function flow(x, y, t) {
    return (Math.sin(x * .11 + t * .031) * Math.cos(y * .13 - t * .023) + Math.sin((x + y) * .07 + t * .017) * .6 + Math.cos((x - y) * .09 - t * .027) * .4) * 3.14;
  }
  // voice shape along the line (u = -1..1) and around the edge (a = angle)
  function wline(u, t) { return Math.sin(u * 7 - t * .9) * .7 + Math.sin(u * 13 + t * 1.3) * .3; }
  function wedge(a, t) { return Math.sin(a * 5 - t * .5 + Math.sin(a * 2 + t * .13) * 1.5); }

  function create(canvas, opts) {
    opts = opts || {};
    var N = opts.size || 96, sc = N / 96, R = 23 * sc, n = opts.particles || Math.round(620 * sc * sc);
    canvas.width = N; canvas.height = N; canvas.style.imageRendering = 'pixelated';
    var ctx = canvas.getContext('2d'), seed = opts.seed || 21;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var P = [];
    for (var i = 0; i < n; i++) {
      var a = rnd() * 6.283, r = Math.pow(rnd(), .7) * R;
      P.push({ hx: Math.cos(a) * r, hy: Math.sin(a) * r * .9, x: N / 2 + Math.cos(a) * r, y: N / 2 + Math.sin(a) * r * .9, vx: 0, vy: 0, c: rnd(), g: 0, i: i, wv: 0 });
    }
    var S = { state: STATES.indexOf(opts.state) >= 0 ? opts.state : 'idle', vol: null, t: 0, cx: N / 2, cy: N / 2, mouse: null,
      sparks: [], bubbles: [], tear: [], gust: 0, gd: 1, sur: 0, lastE: 0, act: 0, timer: null };

    // built-in speech rhythm: phrases of 1–3 s, syllables of 120–240 ms, pauses between phrases
    var SP = { ph: 0, left: 8, syl: 0, amp: 0, cur: 0 };
    function speech() {
      if (SP.left-- <= 0) { SP.ph = 1 - SP.ph; SP.left = SP.ph ? 18 + Math.random() * 34 : 6 + Math.random() * 10; }
      if (!SP.ph) { SP.cur *= .5; return SP.cur; }
      if (SP.syl-- <= 0) { SP.syl = 2 + (Math.random() * 3 | 0); SP.amp = .45 + Math.random() * .65; }
      SP.cur = SP.cur * .35 + (SP.syl > 0 ? SP.amp : SP.amp * .3) * .65;
      return SP.cur;
    }
    function envelope() {
      if (S.vol != null) return Math.max(0, Math.min(1.2, S.vol * 1.15));
      return Math.min(1.2, speech());
    }

    function step() {
      var t = ++S.t, st = S.state, c0 = N / 2, e = st === 'talk' ? envelope() : 0;
      S.act = S.act * .85 + Math.min(1, e * 1.6) * .15;
      var tx = c0 + Math.sin(t * .013) * 3 * sc, ty = c0 + Math.cos(t * .017) * 2 * sc;
      if (S.mouse) { var mdx = S.mouse.x - c0, mdy = S.mouse.y - c0, md = Math.hypot(mdx, mdy) || 1; tx += mdx / md * Math.min(7 * sc, md * .15); ty += mdy / md * Math.min(5 * sc, md * .12); }
      if (st === 'sleep') ty += 14 * sc;
      if (st === 'happy') ty -= Math.abs(Math.sin(t * .18)) * 7 * sc;
      if (st === 'annoyed') tx += (Math.random() - .5) * 2.5 * sc;
      S.cx += (tx - S.cx) * .08; S.cy += (ty - S.cy) * .08;
      var cx = S.cx, cy = S.cy;

      var br = 1 + Math.sin(t * .07) * .035, sx = 1, sy = 1, k = .035, fl = .22, damp = .86;
      if (st === 'talk') { k = .16; fl = .05; }
      else if (st === 'think') { sx = sy = .85 + Math.sin(t * .09) * .08; fl = .2; k = .06; }
      else if (st === 'sleep') { sx = 1.25; sy = .5; fl = .05; k = .025; damp = .8; }
      else if (st === 'annoyed') { sx = 1.3; sy = .62; fl = .35; k = .08; }
      else if (st === 'happy') { sx = sy = 1.02; fl = .2; k = .06; }
      else if (st === 'glitch') { fl = .3; k = .05; }
      S.lastE = e;
      if (S.sur > 0) { S.sur--; k = .025; damp = .9; }
      if (st === 'idle' && S.gust <= 0 && Math.random() < .008) { S.gust = 24; S.gd = Math.random() < .5 ? -1 : 1; }
      S.gust--;
      if (st === 'glitch' && t % 3 === 0) {
        S.tear = [];
        for (var q = 0, kk = 1 + (Math.random() * 3 | 0); q < kk; q++) S.tear.push({ y: ((20 + Math.random() * 56) * sc) | 0, h: Math.max(1, ((2 + Math.random() * 6) * sc) | 0), dx: (Math.random() < .5 ? -1 : 1) * Math.max(1, ((3 + Math.random() * 8) * sc) | 0) });
      }
      if (st !== 'glitch') S.tear = [];
      var mm = Math.min(1, S.act * 1.4);

      for (var j = 0; j < P.length; j++) {
        var p = P[j], gx, gy, thought = st === 'think' && p.i % 6 === 0;
        if (st === 'talk') {
          // line + edge
          var hx0 = cx + p.hx, hy0 = cy + p.hy * .85, tx3, ty3;
          if (p.i % 3 === 0) {
            var u = p.hx / R, win = Math.cos(Math.min(1, Math.abs(u)) * 1.571);
            tx3 = cx + p.hx * 1.25; ty3 = cy + wline(u, t) * e * 10 * sc * win + p.hy * .05;
          } else {
            var an = Math.atan2(p.hy, p.hx), rh = Math.hypot(p.hx, p.hy) / R, ew = wedge(an, t), f = 1 - .08 * mm + rh * rh * e * .42 * ew;
            p.wv = ew * e; tx3 = cx + p.hx * f; ty3 = cy + p.hy * f * .88;
          }
          gx = hx0 + (tx3 - hx0) * mm; gy = hy0 + (ty3 - hy0) * mm;
        } else if (thought) {
          // churn: three thought-clouds on a flat orbit, swelling one after another
          var tq = ((p.i / 6) | 0) % 3, tth = t * .035 + tq * 2.094, ts = .17 + Math.max(0, Math.sin(t * .2 - tq * .9)) * .12;
          gx = cx + Math.cos(tth) * R * 1.55 + p.hx * ts; gy = cy + Math.sin(tth) * R * 1.55 + p.hy * ts;
        } else { gx = cx + p.hx * sx * br; gy = cy + p.hy * sy * br; }

        var k2 = thought ? .12 : k, fl2 = thought ? .05 : fl;
        p.vx += (gx - p.x) * k2; p.vy += (gy - p.y) * k2;
        var fa = flow(p.x / sc, p.y / sc, t); p.vx += Math.cos(fa) * fl2 * sc; p.vy += Math.sin(fa) * fl2 * sc;
        if (st === 'think' && !thought) {
          // churn: the core boils, swirl speeds up, slows and reverses
          var chx = p.x - cx, chy = p.y - cy, chd = Math.hypot(chx, chy) + 1, chs = .5 * Math.sin(t * .035);
          p.vx += -chy / chd * chs * sc + (Math.random() - .5) * .35 * sc; p.vy += chx / chd * chs * sc + (Math.random() - .5) * .35 * sc;
        }
        if (S.gust > 0 && p.hx * S.gd > 8 * sc) { p.vx += S.gd * .5 * sc * (S.gust / 24); p.vy += Math.sin(j) * .1 * sc; }
        if (st === 'annoyed') { p.vx += (Math.random() - .5) * .9 * sc; p.vy += (Math.random() - .5) * .9 * sc; }
        if (S.mouse) { var mx = p.x - S.mouse.x, my = p.y - S.mouse.y, mdd = Math.hypot(mx, my); if (mdd < 9 * sc) { p.vx += mx / (mdd + .5) * .6 * sc; p.vy += my / (mdd + .5) * .6 * sc; } }
        p.vx *= damp; p.vy *= damp; p.x += p.vx; p.y += p.vy; if (p.g > 0) p.g--;
        if (st === 'glitch' && Math.random() < .02) { p.x = Math.round(p.x / (4 * sc)) * 4 * sc; p.y = Math.round(p.y / (4 * sc)) * 4 * sc; }
      }
      if (st === 'happy' && t % 3 === 0) { var ha = Math.random() * 6.283; S.sparks.push({ x: cx + Math.cos(ha) * 26 * sc, y: cy + Math.sin(ha) * 22 * sc, l: 6 }); }
      if (st === 'annoyed' && Math.random() < .35) { var aa = Math.random() * 6.283; S.sparks.push({ x: cx + Math.cos(aa) * 28 * sc, y: cy + Math.sin(aa) * 15 * sc, l: 3, oc: 1 }); }
      S.sparks.forEach(function (s) { s.l--; }); S.sparks = S.sparks.filter(function (s) { return s.l > 0; });
      if (st === 'sleep' && t % 22 === 0) S.bubbles.push({ x: cx + (Math.random() - .5) * 20 * sc, y: cy - 6 * sc, l: 40 });
      S.bubbles.forEach(function (b) { b.y -= .45 * sc; b.x += Math.sin((b.l + b.x) * .3) * .3 * sc; b.l--; }); S.bubbles = S.bubbles.filter(function (b) { return b.l > 0; });
      if (st !== 'sleep') S.bubbles = [];
      return { e: e };
    }

    function color(p, e, C) {
      var rr = Math.hypot(p.hx, p.hy) / R, st = S.state;
      if (p.g > 0) return C.tx;
      if (st === 'sleep') return p.c < .15 ? C.m1 : C.dm;
      if (st === 'talk') {
        if (S.act <= .3) return p.c < .35 ? C.ms : (rr > .7 ? C.h2 : C.m1);
        if (p.i % 3 === 0) return p.c < .5 ? C.tx : C.lt;
        return p.wv > .45 && rr > .5 ? (p.c < .6 ? C.ms : C.mu) : (p.c < .2 ? C.ms : (rr > .6 ? C.h1 : C.m1));
      }
      if (st === 'think') {
        if (p.i % 6 === 0) { var pk = Math.max(0, Math.sin(S.t * .2 - (((p.i / 6) | 0) % 3) * .9)); return pk > .5 ? (p.c < .6 ? C.tx : C.lt) : (pk > .1 ? C.ms : C.m1); }
        var u = 16 / R, hot = Math.sin(p.hx * u * .5 + S.t * .3) * Math.cos(p.hy * u * .5 - S.t * .23) > .55;
        return hot && p.c < .6 ? C.lt : (p.c < .45 ? C.ms : (rr > .75 ? C.h2 : C.m1));
      }
      if (st === 'annoyed') return p.c < .08 ? C.oc : (p.c < .45 ? C.m1 : C.h2);
      if (st === 'happy') return p.c < .25 ? C.lt : (p.c < .7 ? C.ms : C.m1);
      if (st === 'glitch') return Math.random() < .05 ? C.tx : (p.c < .5 ? C.ms : C.m1);
      return p.c < .22 ? C.mu : (rr > .78 ? C.h2 : C.m1);
    }

    function render(info) {
      var C = PAL[themeName(opts)], trans = !!opts.transparent, buf = new Array(N * N);
      for (var z = 0; z < N * N; z++) buf[z] = null;
      function put(x, y, c) { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && x < N && y >= 0 && y < N) buf[y * N + x] = c; }
      for (var j = 0; j < P.length; j++) put(P[j].x, P[j].y, color(P[j], info.e, C));
      S.sparks.forEach(function (s) { var c = s.oc ? C.oc : C.tx; put(s.x, s.y, c); if (!s.oc && s.l > 3) { put(s.x - 1, s.y, C.ms); put(s.x + 1, s.y, C.ms); put(s.x, s.y - 1, C.ms); put(s.x, s.y + 1, C.ms); } });
      S.bubbles.forEach(function (b) { var c = b.l > 12 ? C.m1 : C.dm; put(b.x, b.y, c); put(b.x + 1, b.y, c); put(b.x, b.y - 1, c); put(b.x + 1, b.y - 1, c); });
      if (S.tear.length) {
        var src = buf.slice();
        S.tear.forEach(function (tr) { for (var y = tr.y; y < tr.y + tr.h && y < N; y++) for (var x = 0; x < N; x++) { var sxx = x - tr.dx; buf[y * N + x] = (sxx >= 0 && sxx < N) ? src[y * N + sxx] : null; } });
      }
      var im = ctx.createImageData(N, N), d = im.data, bg = rgb(C.bg);
      for (var i = 0; i < N * N; i++) {
        var col = buf[i];
        if (col) { var v = rgb(col); d[i * 4] = v[0]; d[i * 4 + 1] = v[1]; d[i * 4 + 2] = v[2]; d[i * 4 + 3] = 255; }
        else if (!trans) { d[i * 4] = bg[0]; d[i * 4 + 1] = bg[1]; d[i * 4 + 2] = bg[2]; d[i * 4 + 3] = 255; }
      }
      ctx.putImageData(im, 0, 0);
    }

    function toGrid(ev) { var r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * N, y: (ev.clientY - r.top) / r.height * N }; }
    function onMove(ev) { S.mouse = toGrid(ev); }
    function onLeave() { S.mouse = null; }
    function onDown(ev) { var m = toGrid(ev); api.poke(m.x, m.y); }
    if (opts.interactive !== false) {
      canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerleave', onLeave); canvas.addEventListener('pointerdown', onDown);
    }

    var api = {
      setState: function (s) { if (STATES.indexOf(s) >= 0) { S.state = s; if (reduced()) still(); } return api; },
      getState: function () { return S.state; },
      setVolume: function (v) { S.vol = v == null ? null : Math.max(0, +v); return api; },
      poke: function (x, y) {
        x = x == null ? S.cx : x; y = y == null ? S.cy : y;
        P.forEach(function (p) { var dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy); if (d < 16 * sc) { var f = (16 * sc - d) / (16 * sc) * 4 * sc; p.vx += dx / (d + .5) * f; p.vy += dy / (d + .5) * f; p.g = 8; } });
        return api;
      },
      surprise: function () {
        S.sur = 26;
        P.forEach(function (p) { var d = Math.hypot(p.hx, p.hy) + .5; p.vx += p.hx / d * (3 + Math.random() * 3) * sc; p.vy += p.hy / d * (3 + Math.random() * 3) * sc; });
        return api;
      },
      frame: function () { render(step()); return api; },
      destroy: function () {
        if (S.timer) clearInterval(S.timer);
        canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave); canvas.removeEventListener('pointerdown', onDown);
      }
    };
    function still() { if (S.state === 'talk') { S.vol = S.vol == null ? .8 : S.vol; S.act = 1; } var info; for (var w = 0; w < 70; w++) info = step(); render(info); }
    if (reduced()) still(); else { for (var w0 = 0; w0 < 30; w0++) step(); S.timer = setInterval(function () { render(step()); }, opts.ms || 60); }
    return api;
  }

  function auto(scope) {
    var list = [];
    (scope || document).querySelectorAll('canvas[data-vivi]').forEach(function (cv) {
      if (cv._vivi) return;
      cv._vivi = create(cv, { state: cv.getAttribute('data-vivi') || 'idle', size: +(cv.getAttribute('data-vivi-size') || 96),
        transparent: cv.hasAttribute('data-vivi-transparent'), interactive: !cv.hasAttribute('data-vivi-static') });
      list.push(cv._vivi);
    });
    return list;
  }

  root.ViviCloud = { create: create, auto: auto, states: STATES, palette: PAL };
})(typeof window !== 'undefined' ? window : this);
