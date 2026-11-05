/* Живой рисунок на фоне лонгрида.
   Всё нарисовано штрихами. Каждый штрих — цепочка коротких отрезков, которые считает видеокарта,
   поэтому линии могут дрожать, дорисовываться и стираться вслед за прокруткой. */
(function () {
  'use strict';

  var canvas = document.getElementById('sketch');
  if (!canvas) return;

  var reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var compact = Math.min(screen.width, screen.height, innerWidth) < 700 || matchMedia('(pointer: coarse)').matches;
  var Q = compact ? 0.45 : 1;
  var TAU = Math.PI * 2;

  /* ---------- Случайные числа и шум: рисунок одинаков при каждом открытии ---------- */
  var seedState = 19411955;
  function R() {
    seedState = (seedState + 0x6d2b79f5) | 0;
    var t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(t) { t = clamp01(t); return t * t * (3 - 2 * t); }
  function hash2(x, y) {
    var s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function noise2(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var fx = smooth(x - xi), fy = smooth(y - yi);
    return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), fx), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), fx), fy);
  }

  /* ---------- Кривые ---------- */
  function spline(ctrl, closed, per) {
    var out = [], n = ctrl.length, last = closed ? n : n - 1;
    function at(i) {
      if (closed) return ctrl[(i + n) % n];
      return ctrl[Math.max(0, Math.min(n - 1, i))];
    }
    for (var i = 0; i < last; i++) {
      var p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (var s = 0; s < per; s++) {
        var t = s / per, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (p2[0] - p0[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (3 * p1[0] - p0[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (p2[1] - p0[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (3 * p1[1] - p0[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    if (!closed) out.push(ctrl[n - 1].slice());
    return out;
  }
  function mirror(pts) { return pts.map(function (p) { return [-p[0], p[1]]; }); }
  function inside(x, y, poly) {
    var hit = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }

  /* ---------- Слои рисунка ---------- */
  var LAYER = {
    SIL: 0, FAR: 1, NEAR: 2, LUNGS: 3, STAIN: 4, HEART: 5, THROAT: 6, STOMACH: 7, BRAIN: 8, VESSELS: 9,
    FLOWERS: 10, VINES: 11, RED_LUNGS: 12, RED_HEART: 13, RED_VESSELS: 14
  };
  var NL = 15;
  var DEPTH = [0.25, -1.3, 1.5, 0.5, 0.5, 0.6, 0.5, 0.5, 0.5, 0.4, 1.0, 0.9, 0.55, 0.7, 0.4];

  var WHITE = [0.95, 0.94, 0.91];
  var ASH = [0.62, 0.61, 0.6];
  var RED = [1.0, 0.13, 0.2];
  var CRIMSON = [1.0, 0.32, 0.36];
  var GREEN = [0.46, 0.84, 0.56];
  var PETALS = [
    [1.0, 0.56, 0.7], [1.0, 0.48, 0.36], [1.0, 0.83, 0.36], [0.72, 0.61, 1.0],
    [0.5, 0.83, 1.0], [1.0, 0.96, 0.9], [1.0, 0.7, 0.8]
  ];

  var data = [];
  var STRIDE = 15;
  // У каждого штриха есть важность: на слабом компьютере рисуются только самые важные.
  var units = [], openUnit = null;

  function stroke(pts, o) {
    var n = pts.length - 1;
    if (n < 1) return;
    var seed = R() * 100, t0 = o.t0 || 0, t1 = o.t1 === undefined ? 1 : o.t1;
    var hasGrow = o.birth !== undefined, first = data.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[i + 1];
      var press = Math.pow(Math.sin((Math.PI * (i + 0.5)) / n), 0.6);
      data.push(
        a[0], a[1], b[0], b[1],
        t0 + (t1 - t0) * (i / n), o.layer, o.w * (0.45 + 0.55 * press), o.a * (0.5 + 0.5 * press),
        o.c[0], o.c[1], o.c[2], seed,
        hasGrow ? o.cx : 0, hasGrow ? o.cy : 0, hasGrow ? o.birth : -1
      );
    }
    if (!openUnit) units.push({ from: first, to: data.length, rank: o.rank === undefined ? R() : o.rank });
  }

  /* Обводка «от руки»: путь режется на короткие штрихи, каждый проход ложится чуть мимо предыдущего. */
  function sketch(path, o) {
    var n = path.length, closed = !!o.closed;
    var passes = Math.max(1, Math.round((o.passes || 1) * (o.fixed ? 1 : Q)));
    var T0 = o.t0 || 0, T1 = o.t1 === undefined ? 1 : o.t1;
    for (var p = 0; p < passes; p++) {
      var ps = R() * 1000;
      var wob = (o.wob || 0.01) * (1 + p * (o.spread === undefined ? 0.7 : o.spread));
      var alpha = o.a * (1 - (p / (passes + 1)) * 0.55);
      var i = Math.floor(R() * 8);
      while (closed ? i < n : i < n - 2) {
        var len = Math.floor(lerp(o.min || 16, o.max || 60, R()));
        var pts = [];
        for (var k = 0; k <= len; k++) {
          var idx = i + k;
          if (closed) idx = idx % n; else if (idx >= n) break;
          var q = path[idx];
          pts.push([
            q[0] + (noise2(idx * 0.035 + ps, ps) - 0.5) * wob * 2,
            q[1] + (noise2(ps, idx * 0.035 + ps) - 0.5) * wob * 2
          ]);
        }
        if (pts.length > 2) {
          var A = pts[0], B = pts[1], Y = pts[pts.length - 1], Z = pts[pts.length - 2];
          var over = 1 + R() * 3;
          pts.unshift([A[0] + (A[0] - B[0]) * over, A[1] + (A[1] - B[1]) * over]);
          pts.push([Y[0] + (Y[0] - Z[0]) * over, Y[1] + (Y[1] - Z[1]) * over]);
          var ft = (i / n) * 0.62 + (p / passes) * 0.26;
          var from = lerp(T0, T1, ft);
          stroke(pts, {
            layer: o.layer, c: o.c, w: o.w * (0.8 + R() * 0.4), a: alpha * (0.7 + R() * 0.3),
            t0: from, t1: lerp(T0, T1, ft + 0.12), rank: (p / passes) * 0.85 + R() * 0.15
          });
        }
        i += Math.max(4, Math.floor(len * (0.72 + R() * 0.25)));
      }
    }
  }

  /* Каракули: карандаш ходит туда-обратно вдоль случайной оси */
  function scribble(cx, cy, rx, ry, n) {
    var ang = R() * TAU, ctrl = [], v = (R() - 0.5) * ry;
    for (var i = 0; i < n; i++) {
      ang += (R() - 0.5) * 0.9;
      v += (R() - 0.5) * ry * 0.9;
      if (Math.abs(v) > ry) v *= 0.5;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      var u = (i % 2 ? 1 : -1) * (0.35 + R() * 0.75) * rx;
      ctrl.push([cx + u * ca - v * sa, cy + u * sa + v * ca]);
    }
    return spline(ctrl, false, 5);
  }

  /* ---------- Фигура ---------- */
  var HALF = [
    [0.17, 0.96], [0.2, 1.16], [0.3, 1.3], [0.6, 1.4], [0.94, 1.48], [1.12, 1.66], [1.2, 1.95], [1.22, 2.25],
    [1.24, 2.55], [1.3, 2.95], [1.34, 3.3], [1.36, 3.62], [1.44, 3.8], [1.47, 4.02], [1.41, 4.22], [1.31, 4.26],
    [1.23, 4.08], [1.19, 3.85], [1.2, 3.65], [1.12, 3.3], [1.03, 2.95], [0.98, 2.6], [0.94, 2.3], [0.88, 2.04],
    [0.82, 1.94], [0.8, 2.2], [0.75, 2.6], [0.69, 3.0], [0.67, 3.3], [0.7, 3.7], [0.74, 4.0], [0.74, 4.4],
    [0.68, 4.9], [0.6, 5.3], [0.57, 5.55], [0.57, 5.85], [0.58, 6.2], [0.5, 6.7], [0.43, 7.05], [0.5, 7.22],
    [0.58, 7.36], [0.4, 7.42], [0.19, 7.4], [0.16, 7.2], [0.2, 7.02], [0.2, 6.5], [0.16, 6.1], [0.2, 5.75],
    [0.2, 5.5], [0.13, 5.0], [0.07, 4.5], [0.02, 4.24]
  ];
  var HEAD = [
    [0, -0.02], [0.22, 0.02], [0.36, 0.16], [0.39, 0.4], [0.37, 0.62], [0.31, 0.82], [0.17, 1.0], [0, 1.04],
    [-0.17, 1.0], [-0.31, 0.82], [-0.37, 0.62], [-0.39, 0.4], [-0.36, 0.16], [-0.22, 0.02]
  ];
  var bodyR = spline(HALF, false, 12);
  var bodyL = mirror(bodyR);
  var head = spline(HEAD, true, 10);

  function drawFigure() {
    var o = { layer: LAYER.SIL, c: WHITE, w: 1.15, a: 0.6, passes: 16, wob: 0.014, spread: 1.3, min: 12, max: 46 };
    sketch(head, Object.assign({ closed: true, t0: 0, t1: 0.35 }, o));
    sketch(bodyR, Object.assign({ t0: 0.08, t1: 1 }, o));
    sketch(bodyL, Object.assign({ t0: 0.08, t1: 1 }, o));

    // Поисковые штрихи: рука несколько раз ищет линию и промахивается
    [bodyR, bodyL, head].forEach(function (path) {
      var hunts = Math.round((path === head ? 10 : 34) * Q);
      for (var h = 0; h < hunts; h++) {
        var from = Math.floor(R() * (path.length - 30)), span = 18 + Math.floor(R() * 70), line = [];
        var ox = (R() - 0.5) * 0.28, oy = (R() - 0.5) * 0.28, seedA = R() * 50;
        for (var s = 0; s < span && from + s < path.length; s += 3) {
          var pt = path[from + s], fade = Math.sin((Math.PI * s) / span);
          line.push([pt[0] + (ox + (noise2(seedA, s * 0.05) - 0.5) * 0.24) * fade, pt[1] + (oy + (noise2(s * 0.05, seedA) - 0.5) * 0.24) * fade]);
        }
        var from0 = 0.2 + R() * 0.7;
        stroke(line, { layer: LAYER.SIL, c: WHITE, w: 0.8 + R() * 0.7, a: 0.16 + R() * 0.24, t0: from0, t1: Math.min(1.1, from0 + 0.16) });
      }
    });

    // Построечные линии, как в учебном наброске
    var guide = { layer: LAYER.SIL, c: WHITE, w: 0.8, a: 0.2, passes: 2, wob: 0.012, t0: 0.5, t1: 1, min: 30, max: 90 };
    sketch(spline([[0, -0.3], [0.01, 2], [0, 4.25]], false, 40), guide);
    sketch(spline([[-1.0, 1.52], [0, 1.47], [1.0, 1.54]], false, 30), guide);
    sketch(spline([[-0.86, 3.86], [0, 3.92], [0.86, 3.84]], false, 30), guide);
    sketch(spline([[-0.42, 0.42], [0, 0.46], [0.42, 0.42]], false, 20), guide);
    sketch(spline([[-0.72, 5.55], [-0.38, 5.6], [-0.08, 5.55]], false, 14), guide);
    sketch(spline([[0.72, 5.55], [0.38, 5.6], [0.08, 5.55]], false, 14), guide);

    // Рёбра и ключицы
    var bones = { layer: LAYER.SIL, c: WHITE, w: 0.9, a: 0.3, passes: 2, wob: 0.01, t0: 0.55, t1: 1 };
    sketch(spline([[0.04, 1.5], [0.32, 1.42], [0.7, 1.5]], false, 16), bones);
    sketch(spline([[-0.04, 1.5], [-0.32, 1.42], [-0.7, 1.5]], false, 16), bones);
    for (var r = 0; r < 7; r++) {
      var y = 1.72 + r * 0.19, wid = 0.62 + Math.min(r, 3) * 0.02 - Math.max(0, r - 4) * 0.04;
      var rib = { layer: LAYER.SIL, c: WHITE, w: 0.7, a: 0.13, passes: 1, wob: 0.012, t0: 0.6, t1: 1 };
      sketch(spline([[0.04, y], [wid * 0.55, y + 0.05], [wid, y + 0.22]], false, 14), rib);
      sketch(spline([[-0.04, y], [-wid * 0.55, y + 0.05], [-wid, y + 0.22]], false, 14), rib);
    }

    // Штриховка тени с одной стороны тела
    for (var i = 8; i < bodyR.length - 8; i += compact ? 4 : 2) {
      if (R() < 0.5) continue;
      var p = bodyR[i], q = bodyR[i + 3], dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len, l = 0.05 + R() * 0.16, sx = p[0], sy = p[1];
      if (!inside(sx + nx * 0.05, sy + ny * 0.05, bodyR.concat(bodyL.slice().reverse()))) { nx = -nx; ny = -ny; }
      var lean = 0.35 + R() * 0.3;
      stroke(
        [[sx, sy], [sx + (nx + lean) * l * 0.5, sy + (ny + lean) * l * 0.5], [sx + (nx + lean) * l, sy + (ny + lean) * l]],
        { layer: LAYER.SIL, c: WHITE, w: 0.7, a: 0.2 * (0.5 + R() * 0.5), t0: 0.55 + R() * 0.35, t1: 1 }
      );
    }
  }

  /* ---------- Хаос: дым и путаные линии вокруг фигуры ---------- */
  function drawChaos() {
    var i, s, pts;
    // Дальний слой — медленные потоки
    var far = Math.round(340 * Q);
    for (i = 0; i < far; i++) {
      var x = -3.4 + R() * 6.8, y = -1.2 + R() * 9.6;
      pts = [[x, y]];
      var steps = 34 + Math.floor(R() * 60);
      for (s = 0; s < steps; s++) {
        var ang = noise2(x * 0.42 + 11, y * 0.42 + 4) * TAU * 2.1 - 1.2;
        x += Math.cos(ang) * 0.04;
        y += Math.sin(ang) * 0.04 - 0.006;
        pts.push([x, y]);
      }
      var t = R() * 0.84;
      stroke(pts, { layer: LAYER.FAR, c: WHITE, w: 0.7 + R() * 0.5, a: 0.05 + R() * 0.12, t0: t, t1: t + 0.14 });
    }
    // Размашистые дуги через всё тело
    var arcs = Math.round(210 * Q);
    for (i = 0; i < arcs; i++) {
      var ctrl = [], cnt = 3 + Math.floor(R() * 5);
      var cx = (R() - 0.5) * 2.4, cy = 0.3 + R() * 6.4, spread = 0.5 + R() * 1.7;
      for (s = 0; s < cnt; s++) ctrl.push([cx + (R() - 0.5) * spread * 2, cy + (R() - 0.5) * spread * 1.6]);
      var tt = R() * 0.85;
      stroke(spline(ctrl, false, 16), { layer: LAYER.NEAR, c: WHITE, w: 0.6 + R() * 0.8, a: 0.1 + R() * 0.24, t0: tt, t1: tt + 0.12 });
    }
    // Каракули: чаще в груди и у головы
    var knots = Math.round(150 * Q);
    for (i = 0; i < knots; i++) {
      var zone = R();
      var kx, ky;
      if (zone < 0.4) { kx = (R() - 0.5) * 1.5; ky = 1.6 + R() * 1.6; }
      else if (zone < 0.58) { kx = (R() - 0.5) * 1.0; ky = R() * 1.2; }
      else { kx = (R() - 0.5) * 3.2; ky = R() * 7.4; }
      var rx = 0.08 + R() * 0.42, ry = 0.04 + R() * 0.3;
      var kt = R() * 0.86;
      stroke(scribble(kx, ky, rx, ry, 8 + Math.floor(R() * 22)), { layer: LAYER.NEAR, c: WHITE, w: 0.6 + R() * 0.6, a: 0.1 + R() * 0.2, t0: kt, t1: kt + 0.14 });
    }
    // Дым поднимается от лица вверх и уходит за край
    var smoke = Math.round(46 * Q);
    for (i = 0; i < smoke; i++) {
      var ph = R() * TAU, f = 1.3 + R() * 1.9, side = (R() - 0.5) * 0.08, drift = (R() - 0.5) * 0.9;
      pts = [];
      for (s = 0; s < 80; s++) {
        var u = s / 79, yy = lerp(0.86, -3.4, u);
        var amp = 0.02 + u * u * (0.5 + R() * 0.02);
        pts.push([0.02 + side + drift * u * u + Math.sin(yy * f + ph) * amp, yy]);
      }
      stroke(pts, { layer: LAYER.NEAR, c: ASH, w: 0.7, a: 0.1 + R() * 0.12, t0: 0, t1: 0.6 + R() * 0.3 });
    }
  }

  /* ---------- Органы ---------- */
  var LUNG_R = spline([
    [-0.3, 1.6], [-0.4, 1.72], [-0.52, 1.95], [-0.62, 2.25], [-0.67, 2.6], [-0.66, 2.9], [-0.58, 3.06], [-0.4, 3.02],
    [-0.24, 3.06], [-0.13, 2.98], [-0.11, 2.62], [-0.12, 2.3], [-0.17, 2.05], [-0.2, 1.8], [-0.24, 1.66]
  ], true, 12);
  var LUNG_L = spline([
    [0.28, 1.62], [0.4, 1.74], [0.52, 1.97], [0.62, 2.27], [0.67, 2.62], [0.66, 2.92], [0.56, 3.07], [0.4, 3.02],
    [0.28, 3.06], [0.22, 2.95], [0.3, 2.72], [0.3, 2.5], [0.2, 2.3], [0.15, 2.05], [0.18, 1.78], [0.22, 1.66]
  ], true, 12);
  var HEART = spline([
    [-0.12, 2.03], [-0.25, 2.08], [-0.33, 2.25], [-0.3, 2.42], [-0.22, 2.5], [-0.24, 2.62], [-0.12, 2.82], [0.16, 3.07],
    [0.35, 2.87], [0.46, 2.58], [0.44, 2.32], [0.49, 2.2], [0.39, 2.11], [0.31, 2.16], [0.22, 2.06], [0.08, 2.04], [0.0, 2.07]
  ], true, 12);

  function bronchus(x, y, ang, len, depth, o) {
    var pts = [[x, y]], a = ang, px = x, py = y, hit = false;
    for (var s = 0; s < 6; s++) {
      a += (R() - 0.5) * o.curl;
      px += (Math.sin(a) * len) / 6;
      py += (Math.cos(a) * len) / 6;
      if (o.poly && !inside(px, py, o.poly)) { hit = true; break; }
      pts.push([px, py]);
    }
    var level = (o.max - depth) / o.max;
    stroke(pts, {
      layer: o.layer, c: o.c, w: o.w * (0.42 + (0.58 * depth) / o.max), a: o.a * (0.72 + (0.28 * depth) / o.max),
      t0: lerp(o.t0, o.t1, level * 0.82), t1: lerp(o.t0, o.t1, level * 0.82 + 0.18), rank: level * 0.8 + R() * 0.2
    });
    if (depth <= 0 || hit) {
      if (o.buds && !hit) {
        var r = 0.012 + R() * 0.012, ring = [];
        for (var c = 0; c <= 8; c++) ring.push([px + Math.cos((c / 8) * TAU) * r, py + Math.sin((c / 8) * TAU) * r]);
        stroke(ring, { layer: o.layer, c: o.c, w: 0.7, a: o.a * 0.7, t0: lerp(o.t0, o.t1, 0.85), t1: o.t1 });
      }
      return;
    }
    var kids = o.broken && R() < 0.24 ? 1 : 2;
    for (var i = 0; i < kids; i++) {
      var dir = kids === 1 ? (R() < 0.5 ? -1 : 1) : i ? 1 : -1;
      bronchus(px, py, a + dir * (0.28 + R() * 0.5), len * (0.68 + R() * 0.16), depth - 1, o);
    }
  }

  /* Мягкое свечение: очень широкий и почти прозрачный штрих */
  function glow(path, layer, c, w, a, t0, t1) {
    var step = 3, pts = [];
    for (var i = 0; i < path.length; i += step) pts.push(path[i]);
    pts.push(path[0]);
    stroke(pts, { layer: layer, c: c, w: w, a: a, t0: t0, t1: t1, rank: 0.8 });
  }

  function drawLungs(layer, c, healthy) {
    var a = healthy ? 1 : 0.62;
    var line = { layer: layer, c: c, w: healthy ? 2.2 : 1.35, a: a, passes: healthy ? 7 : 6, wob: healthy ? 0.011 : 0.024, spread: healthy ? 0.5 : 1.05, closed: true, t0: 0, t1: 0.55 };
    sketch(LUNG_R, line);
    sketch(LUNG_L, line);
    if (healthy) {
      glow(LUNG_R, layer, c, 30, 0.13, 0, 0.5);
      glow(LUNG_L, layer, c, 30, 0.13, 0, 0.5);
      // Объём: штрихи от края внутрь, как тень в карандашном рисунке
      [LUNG_R, LUNG_L].forEach(function (poly) {
        var mx = poly === LUNG_R ? -0.4 : 0.42, my = 2.42, total = compact ? 90 : 200;
        for (var n = 0; n < total; n++) {
          var P = poly[Math.floor(R() * poly.length)];
          var dx = mx - P[0], dy = my - P[1], d = Math.hypot(dx, dy) || 1, l = 0.05 + R() * 0.2;
          var tip = [P[0] + (dx / d) * l + (R() - 0.5) * 0.03, P[1] + (dy / d) * l + (R() - 0.5) * 0.03];
          if (!inside(tip[0], tip[1], poly)) continue;
          var t = 0.35 + R() * 0.55;
          stroke([[P[0], P[1]], [lerp(P[0], tip[0], 0.5) + (R() - 0.5) * 0.015, lerp(P[1], tip[1], 0.5)], tip], {
            layer: layer, c: c, w: 1 + R() * 0.9, a: 0.28 + R() * 0.3, t0: t, t1: Math.min(1, t + 0.1)
          });
        }
      });
    }
    var fis = { layer: layer, c: c, w: 0.9, a: a * 0.5, passes: 2, wob: 0.012, t0: 0.4, t1: 0.7 };
    sketch(spline([[-0.62, 2.28], [-0.4, 2.42], [-0.18, 2.72]], false, 14), fis);
    sketch(spline([[-0.66, 2.66], [-0.45, 2.66], [-0.27, 2.56]], false, 14), fis);
    sketch(spline([[0.62, 2.3], [0.44, 2.44], [0.3, 2.74]], false, 14), fis);

    // Трахея и бронхи
    var tr = { layer: layer, c: c, w: healthy ? 1.4 : 1, a: a * 0.9, passes: 2, wob: 0.006, t0: 0.15, t1: 0.45 };
    sketch(spline([[-0.05, 1.42], [-0.05, 1.74], [-0.2, 1.98], [-0.24, 2.14]], false, 14), tr);
    sketch(spline([[0.05, 1.42], [0.05, 1.74], [0.2, 1.98], [0.24, 2.14]], false, 14), tr);
    var depth = healthy ? (compact ? 6 : 7) : 5;
    var tree = {
      layer: layer, c: c, w: healthy ? 3 : 1.2, a: a, curl: healthy ? 0.32 : 0.75, max: depth, t0: 0.3, t1: 1,
      broken: !healthy, buds: healthy
    };
    [0.2, 0.75, 1.4].forEach(function (ang) {
      bronchus(-0.22, 2.1, -ang, 0.34, depth, Object.assign({ poly: LUNG_R }, tree));
    });
    [0.2, 0.75, 1.3].forEach(function (ang) {
      bronchus(0.22, 2.1, ang, 0.32, depth, Object.assign({ poly: LUNG_L }, tree));
    });
  }

  function drawStain() {
    // Серые пятна-каракули в нижних долях. Намёк, что лёгким тяжело, без анатомических подробностей.
    var n = Math.round(110 * Q);
    for (var i = 0; i < n; i++) {
      var left = R() < 0.5, poly = left ? LUNG_R : LUNG_L, cx, cy, tries = 0;
      do {
        cx = (left ? -1 : 1) * (0.14 + R() * 0.52);
        cy = 1.8 + Math.pow(R(), 0.6) * 1.26;
        tries++;
      } while (!inside(cx, cy, poly) && tries < 12);
      if (tries >= 12) continue;
      var t = ((cy - 1.8) / 1.3) * 0.75;
      stroke(scribble(cx, cy, 0.03 + R() * 0.08, 0.02 + R() * 0.05, 6 + Math.floor(R() * 12)), {
        layer: LAYER.STAIN, c: ASH, w: 0.7 + R() * 0.6, a: 0.2 + R() * 0.26, t0: 0.75 - t, t1: 0.95 - t
      });
    }
  }

  function scaled(path, k, cx, cy) {
    return path.map(function (p) { return [cx + (p[0] - cx) * k, cy + (p[1] - cy) * k]; });
  }

  function drawHeart(layer, c, healthy) {
    var k = healthy ? 1.2 : 1, cx = 0.06, cy = 2.5;
    function T(pts) { return scaled(pts, k, cx, cy); }
    var a = healthy ? 1 : 0.66;
    sketch(T(HEART), { layer: layer, c: c, w: healthy ? 2.8 : 1.35, a: a, passes: healthy ? 9 : 6, wob: healthy ? 0.009 : 0.026, spread: healthy ? 0.55 : 1.05, closed: true, t0: 0, t1: 0.5 });
    if (healthy) {
      glow(T(HEART), layer, c, 34, 0.14, 0, 0.5);
      glow(T(HEART), layer, c, 70, 0.05, 0, 0.5);
    }
    // Борозда между желудочками
    sketch(T(spline([[0.17, 2.14], [0.08, 2.4], [0.09, 2.7], [0.17, 3.0]], false, 12)), { layer: layer, c: c, w: healthy ? 1.8 : 1, a: a * 0.75, passes: healthy ? 3 : 2, wob: 0.01, t0: 0.3, t1: 0.7 });
    var vessel = { layer: layer, c: c, w: healthy ? 2.1 : 1.1, a: a * 0.9, passes: healthy ? 4 : 3, wob: 0.008, t0: 0.25, t1: 0.65 };
    sketch(T(spline([[-0.08, 2.06], [-0.1, 1.84], [0.02, 1.68], [0.2, 1.68], [0.32, 1.82], [0.33, 2.06]], false, 12)), vessel);
    sketch(T(spline([[0.04, 2.05], [0.03, 1.88], [0.1, 1.78], [0.2, 1.8], [0.23, 1.92], [0.22, 2.06]], false, 12)), vessel);
    sketch(T(spline([[0.08, 2.03], [0.16, 1.92], [0.3, 1.9], [0.48, 1.9]], false, 10)), vessel);
    sketch(T(spline([[0.14, 2.04], [0.22, 1.98], [0.34, 1.98], [0.5, 2.0]], false, 10)), vessel);
    sketch(T(spline([[-0.2, 2.1], [-0.2, 1.9], [-0.2, 1.62]], false, 10)), vessel);
    sketch(T(spline([[-0.12, 2.08], [-0.13, 1.9], [-0.13, 1.64]], false, 10)), vessel);

    // Венечные сосуды
    var depth = healthy ? 5 : 3;
    var poly = T(HEART);
    var tree = { layer: layer, c: c, w: healthy ? 1.9 : 0.95, a: a * 0.85, curl: healthy ? 0.42 : 0.9, max: depth, t0: 0.45, t1: 1, poly: poly, broken: !healthy };
    bronchus(cx + (0.04 - cx) * k, cy + (2.14 - cy) * k, 0.2, 0.28, depth, tree);
    bronchus(cx + (0.02 - cx) * k, cy + (2.14 - cy) * k, -0.75, 0.24, depth, tree);
    bronchus(cx + (0.14 - cx) * k, cy + (2.14 - cy) * k, 0.8, 0.22, depth, tree);

    if (!healthy) {
      // Сбитый ритм: неровная линия рядом с сердцем
      var ecg = [], x = 0.58;
      for (var i = 0; i < 26; i++) {
        x += 0.018 + R() * 0.012;
        var spike = i % 7 === 3 ? -0.22 * (0.4 + R()) : i % 7 === 4 ? 0.16 * (0.3 + R()) : (R() - 0.5) * 0.03;
        ecg.push([x, 2.46 + spike]);
      }
      stroke(ecg, { layer: layer, c: c, w: 1.0, a: 0.6, t0: 0.5, t1: 1 });
    } else {
      // Объём: штрихи вдоль края
      var n = compact ? 40 : 90;
      for (var j = 0; j < n; j++) {
        var P = poly[Math.floor(R() * poly.length)];
        var dx = cx - P[0], dy = cy - P[1], d = Math.hypot(dx, dy) || 1, l = 0.05 + R() * 0.12;
        if (!inside(P[0] + (dx / d) * l, P[1] + (dy / d) * l, poly)) continue;
        stroke([[P[0], P[1]], [P[0] + (dx / d) * l * 0.5 + 0.01, P[1] + (dy / d) * l * 0.5], [P[0] + (dx / d) * l, P[1] + (dy / d) * l]],
          { layer: layer, c: c, w: 0.8, a: 0.35 + R() * 0.25, t0: 0.5 + R() * 0.4, t1: 1 });
      }
    }
  }

  function drawThroat() {
    var o = { layer: LAYER.THROAT, c: WHITE, w: 1, a: 0.5, passes: 3, wob: 0.008, t0: 0, t1: 0.5 };
    sketch(spline([[-0.07, 1.02], [-0.1, 1.12], [-0.06, 1.24], [-0.05, 1.42]], false, 10), o);
    sketch(spline([[0.07, 1.02], [0.1, 1.12], [0.06, 1.24], [0.05, 1.42]], false, 10), o);
    sketch(spline([[-0.1, 1.08], [0, 1.13], [0.1, 1.08]], false, 8), o);
    for (var i = 0; i < 6; i++) {
      var y = 1.24 + i * 0.05;
      stroke(spline([[-0.055, y], [0, y + 0.018], [0.055, y]], false, 5), { layer: LAYER.THROAT, c: WHITE, w: 0.8, a: 0.42, t0: 0.4 + i * 0.05, t1: 0.6 + i * 0.05 });
    }
    for (var k = 0; k < Math.round(16 * Q) + 4; k++) {
      stroke(scribble((R() - 0.5) * 0.09, 1.04 + R() * 0.16, 0.03, 0.018, 8), { layer: LAYER.THROAT, c: ASH, w: 0.7, a: 0.32, t0: 0.6 + R() * 0.2, t1: 1 });
    }
  }

  function drawStomach() {
    var outline = spline([
      [0.05, 3.1], [0.34, 3.14], [0.46, 3.34], [0.36, 3.6], [0.06, 3.68], [-0.2, 3.56], [-0.2, 3.44], [-0.02, 3.46],
      [0.12, 3.36], [0.1, 3.22], [-0.02, 3.17]
    ], true, 10);
    sketch(outline, { layer: LAYER.STOMACH, c: WHITE, w: 1, a: 0.42, passes: 3, wob: 0.016, spread: 0.9, closed: true, t0: 0, t1: 0.6 });
    sketch(spline([[0, 3.12], [-0.03, 3.0], [-0.03, 2.86]], false, 8), { layer: LAYER.STOMACH, c: WHITE, w: 0.8, a: 0.34, passes: 2, wob: 0.008, t0: 0, t1: 0.3 });
    for (var i = 0; i < Math.round(26 * Q); i++) {
      stroke(scribble(0.04 + R() * 0.32, 3.2 + R() * 0.38, 0.05, 0.03, 8), { layer: LAYER.STOMACH, c: ASH, w: 0.7, a: 0.24, t0: 0.5 + R() * 0.3, t1: 1 });
    }
  }

  function drawBrain() {
    var outline = spline([
      [0, 0.1], [0.2, 0.12], [0.33, 0.25], [0.35, 0.42], [0.28, 0.56], [0.12, 0.62], [0, 0.6], [-0.12, 0.62], [-0.28, 0.56],
      [-0.35, 0.42], [-0.33, 0.25], [-0.2, 0.12]
    ], true, 10);
    sketch(outline, { layer: LAYER.BRAIN, c: WHITE, w: 1, a: 0.42, passes: 3, wob: 0.012, closed: true, t0: 0, t1: 0.5 });
    sketch(spline([[0, 0.1], [0.01, 0.34], [0, 0.6]], false, 14), { layer: LAYER.BRAIN, c: WHITE, w: 0.8, a: 0.36, passes: 2, wob: 0.008, t0: 0.2, t1: 0.5 });
    var folds = Math.round(30 * Q) + 8;
    for (var i = 0; i < folds; i++) {
      var side = i % 2 ? 1 : -1, x = side * (0.05 + R() * 0.24), y = 0.18 + R() * 0.38, a = R() * TAU, pts = [[x, y]];
      for (var s = 0; s < 18; s++) {
        a += (R() - 0.5) * 1.8;
        x += Math.cos(a) * 0.016;
        y += Math.sin(a) * 0.016;
        if (!inside(x, y, outline)) break;
        pts.push([x, y]);
      }
      var t = 0.4 + R() * 0.45;
      stroke(pts, { layer: LAYER.BRAIN, c: WHITE, w: 0.75, a: 0.3, t0: t, t1: t + 0.15 });
    }
  }

  function vesselPaths() {
    var arm = [[0.1, 1.86], [0.42, 1.6], [0.78, 1.66], [0.97, 2.1], [1.03, 2.6], [1.12, 3.2], [1.2, 3.7], [1.24, 4.05]];
    var leg = [[0.02, 2.95], [0.04, 3.7], [0.26, 4.1], [0.42, 4.7], [0.38, 5.5], [0.38, 6.2], [0.32, 6.9], [0.36, 7.25]];
    var neck = [[0.08, 1.76], [0.13, 1.3], [0.16, 0.92], [0.26, 0.56]];
    var out = [arm, leg, neck];
    return out.concat(out.map(mirror)).map(function (c) { return spline(c, false, 12); });
  }

  function drawVessels(layer, c, healthy) {
    vesselPaths().forEach(function (path) {
      var main = { layer: layer, c: c, w: healthy ? 1.15 : 0.85, a: healthy ? 0.55 : 0.32, passes: healthy ? 2 : 2, wob: 0.01, t0: 0, t1: 0.75, min: healthy ? 30 : 6, max: healthy ? 70 : 20 };
      sketch(path, main);
      var step = healthy ? (compact ? 7 : 4) : 9;
      for (var i = 6; i < path.length - 2; i += step) {
        var p = path[i], q = path[i + 1], base = Math.atan2(q[0] - p[0], q[1] - p[1]);
        var dir = R() < 0.5 ? -1 : 1;
        var t = (i / path.length) * 0.7;
        bronchus(p[0], p[1], base + dir * (0.6 + R() * 0.8), 0.09 + R() * 0.17, healthy ? 3 : 2, {
          layer: layer, c: c, w: healthy ? 0.85 : 0.6, a: healthy ? 0.42 : 0.2, curl: 0.7, max: healthy ? 3 : 2, t0: t, t1: Math.min(1, t + 0.28), broken: !healthy
        });
      }
    });
  }

  /* ---------- Цветы ---------- */
  function flower(cx, cy, size, birth) {
    var col = PETALS[Math.floor(R() * PETALS.length)];
    var kind = R();
    var count = kind < 0.6 ? 5 + Math.floor(R() * 3) : kind < 0.85 ? 3 : 8;
    var rot = R() * TAU;
    var grow = { layer: LAYER.FLOWERS, cx: cx, cy: cy, birth: birth, t0: 0, t1: 0 };
    for (var i = 0; i < count; i++) {
      var ang = rot + (i / count) * TAU + (R() - 0.5) * 0.18;
      var len = size * (0.85 + R() * 0.3);
      var wid = size * (count > 6 ? 0.18 : 0.34) * (0.85 + R() * 0.3);
      var dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
      var base = [cx + dx * size * 0.1, cy + dy * size * 0.1];
      var tip = [cx + dx * len, cy + dy * len];
      var s1 = [cx + dx * len * 0.55 + nx * wid, cy + dy * len * 0.55 + ny * wid];
      var s2 = [cx + dx * len * 0.55 - nx * wid, cy + dy * len * 0.55 - ny * wid];
      var loop = spline([base, s1, tip, s2], true, 6);
      loop.push(loop[0]);
      stroke(loop, Object.assign({ c: col, w: 1.2, a: 0.85 }, grow));
      // Заливка цветным карандашом
      var hatch = compact ? 7 : 12;
      for (var h = 0; h < hatch; h++) {
        var v = (h / (hatch - 1) - 0.5) * 1.5 * wid;
        var mid = [cx + dx * len * 0.5 + nx * v, cy + dy * len * 0.5 + ny * v];
        stroke([base, mid, [cx + dx * len * (0.86 - Math.abs(v / wid) * 0.26) + nx * v * 0.5, cy + dy * len * (0.86 - Math.abs(v / wid) * 0.26) + ny * v * 0.5]],
          Object.assign({ c: col, w: 2.1 + R() * 1.6, a: 0.42 + R() * 0.4 }, grow));
      }
    }
    var heart = [], a = R() * TAU, core = size * 0.13;
    for (var s = 0; s < 16; s++) {
      a += 1 + R();
      heart.push([cx + Math.cos(a) * core * R(), cy + Math.sin(a) * core * R()]);
    }
    stroke(heart, Object.assign({ c: col[1] > 0.8 ? [1, 0.55, 0.3] : [1, 0.82, 0.32], w: 1.3, a: 0.95 }, grow));
  }

  function leaf(cx, cy, ang, size, birth) {
    var dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx, wid = size * 0.34;
    var loop = spline([
      [cx, cy], [cx + dx * size * 0.5 + nx * wid, cy + dy * size * 0.5 + ny * wid], [cx + dx * size, cy + dy * size],
      [cx + dx * size * 0.5 - nx * wid, cy + dy * size * 0.5 - ny * wid]
    ], true, 5);
    loop.push(loop[0]);
    var o = { layer: LAYER.FLOWERS, cx: cx, cy: cy, birth: birth, t0: 0, t1: 0, c: GREEN };
    stroke(loop, Object.assign({ w: 1, a: 0.7 }, o));
    stroke([[cx, cy], [cx + dx * size * 0.9, cy + dy * size * 0.9]], Object.assign({ w: 0.8, a: 0.55 }, o));
  }

  function drawFlowers() {
    var chest = [0, 2.4], maxD = 5.2, spots = [], i;
    var heartZone = scaled(HEART, 1.1, 0.06, 2.5);
    function add(x, y, size) {
      if (inside(x, y, heartZone)) return;
      var d = Math.hypot(x - chest[0], y - chest[1]) / maxD;
      spots.push([x, y, size, clamp01(d * 0.9 + R() * 0.1)]);
    }
    var total = Math.round(170 * (compact ? 0.5 : 1));
    for (i = 0; i < total; i++) {
      var roll = R(), p, size = 0.045 + R() * 0.085;
      if (roll < 0.26) {
        p = LUNG_R[Math.floor(R() * LUNG_R.length)];
        if (R() < 0.5) p = LUNG_L[Math.floor(R() * LUNG_L.length)];
        add(p[0] + (R() - 0.5) * 0.08, p[1] + (R() - 0.5) * 0.08, size * 1.15);
      } else if (roll < 0.36) {
        p = HEART[Math.floor(R() * HEART.length)];
        add(p[0] + (R() - 0.5) * 0.06, p[1] + (R() - 0.5) * 0.06, size);
      } else if (roll < 0.9) {
        var src = R() < 0.5 ? bodyR : bodyL;
        p = src[Math.floor(R() * src.length)];
        add(p[0] + (R() - 0.5) * 0.1, p[1] + (R() - 0.5) * 0.1, size);
      } else {
        var a = -Math.PI + R() * Math.PI, rr = 0.46 + R() * 0.18;
        add(Math.cos(a) * rr, 0.48 + Math.sin(a) * rr, size * 1.1);
      }
    }
    // Несколько крупных цветов в груди для финала
    [[-0.74, 1.72], [0.76, 1.8], [-0.82, 2.72], [0.84, 2.62], [-0.3, 3.3], [0.42, 3.36], [0.02, 1.34]].forEach(function (c) {
      add(c[0], c[1], 0.15 + R() * 0.07);
    });
    spots.forEach(function (s) {
      var b = s[3];
      openUnit = { from: data.length, to: 0, rank: R() }; // цветок появляется или исчезает целиком
      flower(s[0], s[1], s[2], b);
      if (R() < 0.55) leaf(s[0], s[1], R() * TAU, s[2] * (1.1 + R() * 0.7), b + 0.02);
      // Стебель тянется к цветку вдоль тела
      if (R() < 0.6) {
        var a2 = R() * TAU, l = s[2] * (2 + R() * 3);
        var start = [s[0] + Math.cos(a2) * l, s[1] + Math.sin(a2) * l];
        var mid = [lerp(start[0], s[0], 0.5) + (R() - 0.5) * l * 0.5, lerp(start[1], s[1], 0.5) + (R() - 0.5) * l * 0.5];
        stroke(spline([start, mid, [s[0], s[1]]], false, 6), { layer: LAYER.VINES, c: GREEN, w: 0.9, a: 0.5, t0: b, t1: Math.min(1, b + 0.06) });
      }
      openUnit.to = data.length;
      units.push(openUnit);
      openUnit = null;
    });
  }

  // Рисунок хранится группами: невидимые на текущем участке страницы группы не считаются вовсе.
  var sections = [];
  function checkpoint() { sections.push(units); units = []; }
  drawFigure();
  checkpoint();
  drawChaos();
  checkpoint();
  drawLungs(LAYER.LUNGS, WHITE, false);
  drawStain();
  drawHeart(LAYER.HEART, WHITE, false);
  drawThroat();
  drawStomach();
  drawBrain();
  drawVessels(LAYER.VESSELS, WHITE, false);
  checkpoint();
  drawFlowers();
  checkpoint();
  drawLungs(LAYER.RED_LUNGS, CRIMSON, true);
  drawHeart(LAYER.RED_HEART, RED, true);
  drawVessels(LAYER.RED_VESSELS, RED, true);
  checkpoint();

  // Внутри каждой группы важные штрихи идут первыми, поэтому упростить рисунок можно одним числом.
  var segments = new Float32Array(data.length), checkpoints = [], filled = 0;
  sections.forEach(function (list) {
    list.sort(function (p, q) { return p.rank - q.rank; });
    list.forEach(function (u) {
      for (var i = u.from; i < u.to; i++) segments[filled++] = data[i];
    });
    checkpoints.push(filled / STRIDE);
  });
  var segCount = filled / STRIDE;
  data = null;
  sections = null;
  units = null;

  /* ---------- Сцены: что видно на каждом участке страницы ---------- */
  var ZERO = {
    camX: 0, camY: 3.6, zoom: 0.94, side: 0.25, silA: 1, chaos: 0, chaosA: 1,
    lungs: 0, stain: 0, heart: 0, throat: 0, stomach: 0, brain: 0, vessels: 0, whiteA: 1, shake: 0,
    bloom: 0, petals: 0, redL: 0, redH: 0, redV: 0, dim: 1, fs: 1
  };
  var SCENES = {
    hero: { chaos: 0.42 },
    roots: { camY: 3.0, zoom: 1.12, chaos: 0.5 },
    war: { camY: 2.3, zoom: 1.6, chaos: 0.55, lungs: 0.45 },
    fifties: { camY: 2.35, zoom: 2.15, chaos: 0.62, lungs: 1, stain: 0.2 },
    culture: { camY: 2.5, zoom: 1.75, chaos: 0.66, lungs: 1, stain: 0.35 },
    seventies: { camX: 0.05, camY: 2.42, zoom: 2.45, chaos: 0.74, lungs: 1, stain: 0.55, heart: 1, shake: 0.002 },
    riots: { camY: 1.25, zoom: 2.1, chaos: 0.85, lungs: 1, stain: 0.65, heart: 1, throat: 1, brain: 0.8, shake: 0.003 },
    nineties: { camY: 3.55, zoom: 0.98, chaos: 1, lungs: 1, stain: 1, heart: 1, throat: 1, brain: 1, stomach: 1, vessels: 1, shake: 0.008 },
    turn: { camY: 2.75, zoom: 1.32, chaos: 1, lungs: 1, stain: 1, heart: 1, throat: 1, brain: 1, stomach: 1, vessels: 1, shake: 0.006 },
    law13: { camY: 2.5, zoom: 1.66, chaos: 0.62, lungs: 1, stain: 0.85, heart: 1, throat: 1, brain: 1, stomach: 1, vessels: 1, shake: 0.002, bloom: 0.34, petals: 0.2, whiteA: 0.9 },
    law14: { camY: 2.42, zoom: 1.9, chaos: 0.32, lungs: 1, stain: 0.5, heart: 1, throat: 1, brain: 1, stomach: 1, vessels: 1, bloom: 0.62, petals: 0.45, whiteA: 0.72 },
    today: { camY: 3.45, zoom: 0.95, side: 0.32, chaos: 0.08, lungs: 1, stain: 0.15, heart: 1, throat: 1, brain: 1, stomach: 1, vessels: 1, bloom: 0.9, petals: 0.7, whiteA: 0.42 },
    final: { camY: 2.42, zoom: 3.0, side: 0, chaos: 0, lungs: 1, heart: 1, throat: 1, brain: 1, stomach: 1, vessels: 1, whiteA: 0, silA: 0.3, bloom: 1, petals: 1, redL: 1, redH: 1, redV: 1, fs: 0.56 },
    credits: { camY: 2.4, zoom: 2.6, side: 0.0, chaos: 0, whiteA: 0, silA: 0.1, bloom: 1, petals: 0.4, redL: 1, redH: 1, redV: 1, dim: 0.28, fs: 0.56 }
  };
  Object.keys(SCENES).forEach(function (k) { SCENES[k] = Object.assign({}, ZERO, SCENES[k]); });

  var keys = [];
  function measure() {
    keys = [];
    var H = innerHeight;
    document.querySelectorAll('[data-scene]').forEach(function (el) {
      var box = el.getBoundingClientRect();
      var top = box.top + scrollY;
      var at = parseFloat(el.dataset.at || '0.35');
      keys.push({ y: top + box.height * at - H * 0.5, s: SCENES[el.dataset.scene] || ZERO });
    });
    keys.sort(function (a, b) { return a.y - b.y; });
  }
  function target(y) {
    if (!keys.length) return ZERO;
    if (y <= keys[0].y) return keys[0].s;
    for (var i = 0; i < keys.length - 1; i++) {
      var a = keys[i], b = keys[i + 1];
      if (y < b.y) {
        var t = smooth((y - a.y) / Math.max(1, b.y - a.y)), out = {};
        for (var k in a.s) out[k] = lerp(a.s[k], b.s[k], t);
        return out;
      }
    }
    return keys[keys.length - 1].s;
  }

  var cur = Object.assign({}, SCENES.hero);
  var mouse = [0, 0], mouseT = [0, 0];
  addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    mouseT[0] = e.clientX / innerWidth - 0.5;
    mouseT[1] = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  /* Надписи от руки рядом с органами */
  var LABELS = [
    { key: 'lungs', x: 0, y: 1.5, text: 'лёгкие: рак, хроническая болезнь', align: 'mid', min: 0.75 },
    { key: 'heart', x: 0.74, y: 2.72, text: 'сердце: инфаркт', align: 'left', min: 0.7 },
    { key: 'throat', x: 0.24, y: 1.14, text: 'гортань: рак', align: 'left', min: 0.7 },
    { key: 'brain', x: 0.46, y: 0.32, text: 'сосуды мозга: инсульт', align: 'left', min: 0.7 },
    { key: 'stomach', x: 0.5, y: 3.42, text: 'желудок: рак', align: 'left', min: 0.7 }
  ];
  var labelBox = document.getElementById('organ-labels');
  if (labelBox) {
    LABELS.forEach(function (l) {
      var el = document.createElement('span');
      el.className = 'organ-label ' + l.align;
      var inner = document.createElement('span');
      inner.textContent = l.text;
      el.appendChild(inner);
      labelBox.appendChild(el);
      l.el = el;
    });
  }

  var W = 1, H = 1, DPR = 1, PPU = 100;
  function viewScale() {
    return Math.min(innerHeight, innerWidth * 1.72) / 8;
  }
  function side() {
    return innerWidth < 900 ? 0 : cur.side;
  }
  function project(x, y) {
    var ppu = viewScale() * cur.zoom;
    return [(x - cur.camX) * ppu + innerWidth * (0.5 + side()), (y - cur.camY) * ppu + innerHeight * 0.5];
  }
  function updateLabels() {
    if (!labelBox) return;
    var hide = innerWidth < 900;
    var fade = 1 - clamp01(cur.bloom * 2.2);
    LABELS.forEach(function (l) {
      var v = hide ? 0 : clamp01((cur[l.key] - l.min) / 0.25) * fade * cur.dim;
      if (v <= 0.01) { if (l.el.style.opacity !== '0') l.el.style.opacity = '0'; return; }
      var p = project(l.x, l.y);
      var offscreen = p[0] < 0 || p[0] > innerWidth || p[1] < 30 || p[1] > innerHeight - 30;
      l.el.style.opacity = offscreen ? '0' : v.toFixed(2);
      l.el.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)';
    });
  }

  /* ---------- Видеокарта ---------- */
  /* Уровни качества. Обычный компьютер и телефон остаются на нулевом.
     Без видеокарты или при низкой частоте кадров рисунок упрощается, чтобы страница оставалась плавной. */
  var TIERS = [
    { lod: 1, dprMax: compact ? 1.5 : 2, gap: 0, alive: compact ? 33 : 0, idle: 70 },
    { lod: 0.55, dprMax: 1.25, gap: 0, alive: 33, idle: 80 },
    { lod: 0.28, dprMax: 1, gap: 33, alive: 66, idle: 120 },
    { lod: 0.13, dprMax: 0.85, gap: 90, alive: 140, idle: 320 }
  ];
  function softwareRenderer() {
    try {
      var probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return false;
      var info = probe.getExtension('WEBGL_debug_renderer_info');
      var name = String(probe.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : probe.RENDERER));
      var lose = probe.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (e) { return false; }
  }
  var forcedTier = /[?&]q=(\d)/.exec(location.search);
  var softGL = softwareRenderer();
  var tier = forcedTier ? Math.min(3, +forcedTier[1]) : softGL ? 3 : 0;
  var canAdapt = !forcedTier || /[?&]adapt/.test(location.search);

  var gl = canvas.getContext('webgl2', { alpha: false, antialias: !softGL, powerPreference: 'high-performance' });

  var VS_LINE = '#version 300 es\n' +
    'precision highp float;precision highp int;\n' +
    'layout(location=0) in vec2 aQ;layout(location=1) in vec4 aSeg;layout(location=2) in vec4 aM;layout(location=3) in vec4 aC;layout(location=4) in vec3 aG;\n' +
    'uniform vec2 uRes;uniform float uDpr;uniform vec4 uCam;uniform float uStep;uniform float uTime;uniform float uBloom;uniform vec2 uPar;uniform vec3 uCalm;uniform float uFs;\n' +
    'uniform float uProg[' + NL + '];uniform float uAlpha[' + NL + '];uniform float uDepth[' + NL + '];uniform vec4 uPulse[' + NL + '];\n' +
    'out vec4 vCol;out float vY;\n' +
    'vec2 jit(vec2 p,float amp){float a=fract(sin(dot(p,vec2(127.1,311.7))+uStep*1.37)*43758.5453);float b=fract(sin(dot(p,vec2(269.5,183.3))+uStep*2.11)*24634.6345);return(vec2(a,b)-.5)*amp;}\n' +
    'vec2 place(vec2 raw,int L,float grow){vec2 p=raw;\n' +
    ' if(aG.z>=0.){vec2 d=p-aG.xy;float sw=sin(uTime*.9+aC.a)*.08;float c=cos(sw),s=sin(sw);d=mat2(c,-s,s,c)*d;p=aG.xy+d*grow*uFs;}\n' +
    ' vec4 P=uPulse[L];p=P.xy+(p-P.xy)*P.z;p+=jit(raw,.0055+P.w);\n' +
    ' float depth=uDepth[L];float k=uCam.z*(1.+depth*.045);\n' +
    ' return(p-uCam.xy)*k+.5*uRes+vec2(uCam.w,0.)+uPar*depth;}\n' +
    'void main(){int L=int(aM.y+.5);\n' +
    ' float v=clamp((uProg[L]-aM.x)/.018,0.,1.);float grow=1.;\n' +
    ' if(aG.z>=0.){float g=clamp((uBloom-aG.z)/.08,0.,1.);float back=1.+2.2*pow(g-1.,3.)+1.2*pow(g-1.,2.);grow=g<=0.?0.:back;v=g>0.?1.:0.;}\n' +
    ' float al=aM.w*uAlpha[L]*v;\n' +
    ' if(al<.002){gl_Position=vec4(2.,2.,2.,1.);vCol=vec4(0.);vY=0.;return;}\n' +
    ' vec2 a=place(aSeg.xy,L,grow),b=place(aSeg.zw,L,grow);\n' +
    ' vec2 d=b-a;float len=length(d);d=len>.001?d/len:vec2(1.,0.);vec2 n=vec2(-d.y,d.x);\n' +
    ' float zk=uCam.z/(100.*uDpr);\n' +
    ' float w=aG.z>=0.?aM.z*uDpr*clamp(zk,.55,3.2)*uFs:max(aM.z*uDpr*(.8+.2*sqrt(zk)),1.);\n' +
    ' vec2 pos=mix(a,b,aQ.x)+n*aQ.y*w*.5+d*(aQ.x*2.-1.)*w*.5;\n' +
    ' if(L==1||L==2){al*=mix(1.,smoothstep(uCalm.x,uCalm.y,pos.x),uCalm.z);}\n' +
    ' gl_Position=vec4(pos.x/uRes.x*2.-1.,1.-pos.y/uRes.y*2.,0.,1.);\n' +
    ' vCol=vec4(aC.rgb,al);vY=aQ.y;}';
  var FS_LINE = '#version 300 es\nprecision mediump float;in vec4 vCol;in float vY;out vec4 o;\n' +
    'void main(){float e=1.-smoothstep(.4,1.,abs(vY));float g=fract(sin(dot(floor(gl_FragCoord.xy/1.5),vec2(12.9898,78.233)))*43758.5453);float a=vCol.a*e*(.74+.26*g);o=vec4(vCol.rgb*a,a);}';

  var VS_PETAL = '#version 300 es\nprecision highp float;\n' +
    'layout(location=0) in vec2 aQ;layout(location=1) in vec4 aP;layout(location=2) in vec4 aC;\n' +
    'uniform vec2 uRes;uniform float uDpr;uniform float uTime;uniform float uScroll;uniform float uPetal;\n' +
    'out vec2 vUv;out vec4 vCol;\n' +
    'void main(){float ph=aP.y,dp=aP.w;\n' +
    ' float t=uTime*(.012+.04*dp)+ph;\n' +
    ' float y=fract(t+uScroll*.00016*(.4+dp));\n' +
    ' float x=aP.x+sin(t*12.566+ph*20.)*.035*(.5+dp);\n' +
    ' float rot=uTime*(.25+ph*.6)+ph*20.;float sq=abs(cos(uTime*.7+ph*30.))*.65+.35;\n' +
    ' vec2 l=(aQ*2.-1.)*aP.z*(.45+dp)*uDpr;vUv=aQ*2.-1.;l.x*=sq;\n' +
    ' float c=cos(rot),s=sin(rot);l=mat2(c,-s,s,c)*l;\n' +
    ' vec2 pos=vec2(x*uRes.x,(y*1.2-.1)*uRes.y)+l;\n' +
    ' float vis=smoothstep(aC.a,aC.a+.08,uPetal);\n' +
    ' if(vis<=0.){gl_Position=vec4(2.,2.,2.,1.);vCol=vec4(0.);return;}\n' +
    ' gl_Position=vec4(pos.x/uRes.x*2.-1.,1.-pos.y/uRes.y*2.,0.,1.);\n' +
    ' vCol=vec4(aC.rgb,vis*(.32+.68*dp));}';
  var FS_PETAL = '#version 300 es\nprecision mediump float;in vec2 vUv;in vec4 vCol;out vec4 o;\n' +
    'void main(){float y=vUv.y;float w=.62*sqrt(max(1.-y*y,0.))*(.78+.3*y);float d=abs(vUv.x);float e=1.-smoothstep(w-.14,w,d);\n' +
    ' float vein=1.-.35*(1.-smoothstep(0.,.05,d));float tone=mix(.72,1.08,(y+1.)*.5);\n' +
    ' float a=vCol.a*e;o=vec4(vCol.rgb*tone*vein*a,a);}';

  var progLine, progPetal, loc = {}, locP = {}, vaoLine, vaoPetal, petalCount = 0, instBuf = null;
  var groups = [
    { from: 0, to: checkpoints[0], on: function () { return cur.silA > 0.002; } },
    { from: checkpoints[0], to: checkpoints[1], on: function () { return cur.chaos > 0.001; } },
    { from: checkpoints[1], to: checkpoints[2], on: function () { return cur.whiteA > 0.002 && (cur.lungs > 0.001 || cur.heart > 0.001 || cur.vessels > 0.001 || cur.brain > 0.001); } },
    { from: checkpoints[2], to: checkpoints[3], lodMin: 0.3, on: function () { return cur.bloom > 0.001; } },
    { from: checkpoints[3], to: segCount, lodMin: 0.2, on: function () { return cur.redL > 0.001 || cur.redH > 0.001 || cur.redV > 0.001; } }
  ];
  function groupCount(group, lod) {
    return Math.ceil((group.to - group.from) * Math.max(lod, group.lodMin || 0));
  }

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  function initGL() {
    progLine = program(VS_LINE, FS_LINE);
    progPetal = program(VS_PETAL, FS_PETAL);
    ['uRes', 'uDpr', 'uCam', 'uStep', 'uTime', 'uBloom', 'uPar', 'uCalm', 'uFs', 'uProg', 'uAlpha', 'uDepth', 'uPulse'].forEach(function (n) {
      loc[n] = gl.getUniformLocation(progLine, n);
    });
    ['uRes', 'uDpr', 'uTime', 'uScroll', 'uPetal'].forEach(function (n) {
      locP[n] = gl.getUniformLocation(progPetal, n);
    });

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);

    vaoLine = gl.createVertexArray();
    gl.bindVertexArray(vaoLine);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, segments, gl.STATIC_DRAW);
    [1, 2, 3, 4].forEach(function (i) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribDivisor(i, 1);
    });

    var petalQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, petalQuad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    vaoPetal = gl.createVertexArray();
    gl.bindVertexArray(vaoPetal);
    gl.bindBuffer(gl.ARRAY_BUFFER, petalQuad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    petalCount = compact ? 70 : 150;
    var pd = [];
    for (var i = 0; i < petalCount; i++) {
      var c = PETALS[i % PETALS.length];
      pd.push(R(), R(), 7 + R() * 11, R(), c[0], c[1], c[2], R() * 0.9);
    }
    var pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pd), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
  }

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, TIERS[tier].dprMax);
    W = Math.round(innerWidth * DPR);
    H = Math.round(innerHeight * DPR);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    if (gl) gl.viewport(0, 0, W, H);
    measure();
  }

  var prog = new Float32Array(NL), alpha = new Float32Array(NL), pulse = new Float32Array(NL * 4);
  var depthArr = new Float32Array(DEPTH);
  var CENTER_LUNGS = [0, 2.4], CENTER_HEART = [0.08, 2.55];

  var start = performance.now(), intro = reduceMotion ? 1 : 0, last = start, lastDraw = 0, snapNext = false;

  function setPulse(l, cx, cy, s, shake) {
    pulse[l * 4] = cx; pulse[l * 4 + 1] = cy; pulse[l * 4 + 2] = s; pulse[l * 4 + 3] = shake;
  }

  function heartBeat(t) {
    var p = (t * 1.05) % 1;
    return Math.exp(-Math.pow((p - 0.1) / 0.05, 2)) + 0.6 * Math.exp(-Math.pow((p - 0.28) / 0.06, 2));
  }

  function fillUniforms(time) {
    var t = reduceMotion ? 0 : time;
    var wide = innerWidth >= 900;
    var dimMobile = wide ? 1 : 0.62;
    var dim = cur.dim * dimMobile;
    var sil = Math.min(1, intro);
    var C = cur.chaos;
    prog[LAYER.SIL] = sil * 1.2;
    prog[LAYER.FAR] = C * 1.12;
    prog[LAYER.NEAR] = C * 1.12;
    prog[LAYER.LUNGS] = cur.lungs * 1.03;
    prog[LAYER.STAIN] = cur.stain * 1.03;
    prog[LAYER.HEART] = cur.heart * 1.03;
    prog[LAYER.THROAT] = cur.throat * 1.03;
    prog[LAYER.STOMACH] = cur.stomach * 1.03;
    prog[LAYER.BRAIN] = cur.brain * 1.03;
    prog[LAYER.VESSELS] = cur.vessels * 1.03;
    prog[LAYER.FLOWERS] = 1;
    prog[LAYER.VINES] = cur.bloom * 1.1;
    prog[LAYER.RED_LUNGS] = cur.redL * 1.03;
    prog[LAYER.RED_HEART] = cur.redH * 1.03;
    prog[LAYER.RED_VESSELS] = cur.redV * 1.03;

    alpha[LAYER.SIL] = cur.silA * dim;
    alpha[LAYER.FAR] = cur.chaosA * dim;
    alpha[LAYER.NEAR] = cur.chaosA * dim;
    [LAYER.LUNGS, LAYER.STAIN, LAYER.HEART, LAYER.THROAT, LAYER.STOMACH, LAYER.BRAIN, LAYER.VESSELS].forEach(function (l) {
      alpha[l] = cur.whiteA * dim;
    });
    alpha[LAYER.FLOWERS] = Math.max(dim, 0.45);
    alpha[LAYER.VINES] = Math.max(dim, 0.45);
    var redDim = Math.max(dim, 0.34);
    alpha[LAYER.RED_LUNGS] = redDim;
    alpha[LAYER.RED_HEART] = redDim;
    alpha[LAYER.RED_VESSELS] = redDim;

    var shake = cur.shake;
    for (var i = 0; i < NL; i++) setPulse(i, 0, 3.4, 1, 0);
    setPulse(LAYER.FAR, 0, 3.4, 1, shake * 0.4);
    setPulse(LAYER.NEAR, 0, 3.4, 1, shake * 0.9);
    setPulse(LAYER.SIL, 0, 3.4, 1, shake * 0.5);
    var breath = reduceMotion ? 0 : Math.sin(t * 1.0);
    var beat = reduceMotion ? 0 : heartBeat(t);
    var wheeze = 1 + breath * 0.008;
    [LAYER.LUNGS, LAYER.STAIN].forEach(function (l) { setPulse(l, CENTER_LUNGS[0], CENTER_LUNGS[1], wheeze, shake); });
    setPulse(LAYER.HEART, CENTER_HEART[0], CENTER_HEART[1], 1 + beat * 0.012, shake + 0.003);
    setPulse(LAYER.THROAT, 0, 1.3, 1, shake);
    setPulse(LAYER.STOMACH, 0.1, 3.4, 1, shake);
    setPulse(LAYER.BRAIN, 0, 0.36, 1, shake);
    setPulse(LAYER.VESSELS, 0, 3.4, 1, shake);
    setPulse(LAYER.RED_LUNGS, CENTER_LUNGS[0], CENTER_LUNGS[1], 1.04 + breath * 0.028, 0);
    setPulse(LAYER.RED_HEART, CENTER_HEART[0], CENTER_HEART[1], 1.02 + beat * 0.06, 0);
    setPulse(LAYER.RED_VESSELS, 0, 2.5, 1 + beat * 0.006, 0);
  }

  function camera() {
    return [cur.camX, cur.camY, viewScale() * cur.zoom * DPR, innerWidth * side() * DPR];
  }

  function draw(time) {
    fillUniforms(time);
    var t = reduceMotion ? 0 : time;
    var st = reduceMotion ? 0 : Math.floor(time * 7);
    var cam = camera();
    var parX = (mouse[0] * 34 + 0) * DPR;
    var parY = (mouse[1] * 22 + Math.sin(scrollY * 0.0013) * 26) * DPR;

    gl.clear(gl.COLOR_BUFFER_BIT);
    // Обычное наложение: густая штриховка не выгорает в белый, красный остаётся красным.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(progLine);
    gl.uniform2f(loc.uRes, W, H);
    gl.uniform1f(loc.uDpr, DPR);
    gl.uniform4f(loc.uCam, cam[0], cam[1], cam[2], cam[3]);
    gl.uniform1f(loc.uStep, st);
    gl.uniform1f(loc.uTime, t);
    gl.uniform1f(loc.uBloom, cur.bloom * 1.12);
    gl.uniform2f(loc.uPar, parX, parY);
    gl.uniform1f(loc.uFs, cur.fs);
    // На широком экране слева колонка текста: путаные линии там тише, чтобы не мешать читать.
    gl.uniform3f(loc.uCalm, W * 0.26, W * 0.56, innerWidth >= 900 ? clamp01(cur.side * 4) * 0.82 : 0);
    gl.uniform1fv(loc.uProg, prog);
    gl.uniform1fv(loc.uAlpha, alpha);
    gl.uniform1fv(loc.uDepth, depthArr);
    gl.uniform4fv(loc.uPulse, pulse);
    gl.bindVertexArray(vaoLine);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    var sb = STRIDE * 4;
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      if (!group.on() || group.to <= group.from) continue;
      var off = group.from * sb;
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, sb, off);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, sb, off + 16);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, sb, off + 32);
      gl.vertexAttribPointer(4, 3, gl.FLOAT, false, sb, off + 48);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, groupCount(group, TIERS[tier].lod));
    }

    if (cur.petals > 0.002) {
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(progPetal);
      gl.uniform2f(locP.uRes, W, H);
      gl.uniform1f(locP.uDpr, DPR);
      gl.uniform1f(locP.uTime, t);
      gl.uniform1f(locP.uScroll, scrollY);
      gl.uniform1f(locP.uPetal, cur.petals);
      gl.bindVertexArray(vaoPetal);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.ceil(petalCount * Math.max(0.35, TIERS[tier].lod)));
    }
    gl.bindVertexArray(null);
  }

  /* Запасной вариант без WebGL2: упрощённый рисунок, который обновляется только при смене сцены */
  var ctx2d = null, lastSig = '';
  function draw2D() {
    fillUniforms(0);
    var sig = [W, H, intro >= 1 ? 1 : intro.toFixed(1)];
    ['camX', 'camY', 'zoom', 'side', 'chaos', 'bloom', 'redH', 'lungs', 'heart', 'vessels', 'stain', 'whiteA', 'silA', 'dim'].forEach(function (k) {
      sig.push(cur[k].toFixed(2));
    });
    sig = sig.join();
    if (sig === lastSig) return;
    lastSig = sig;
    var ppu = viewScale() * cur.zoom * DPR, ox = W * 0.5 + innerWidth * side() * DPR, oy = H * 0.5;
    var zk = clamp01((ppu / DPR / 100) / 3.2) * 3.2;
    var calmFrom = W * 0.26, calmTo = W * 0.56, calm = innerWidth >= 900 ? clamp01(cur.side * 4) * 0.82 : 0;
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, W, H);
    ctx2d.lineCap = 'round';
    groups.forEach(function (group) {
      if (!group.on()) return;
      var end = group.from + groupCount(group, 0.22);
      for (var i = group.from; i < end; i++) {
        var b = i * STRIDE, l = segments[b + 5], birth = segments[b + 14];
        var vis = birth >= 0 ? cur.bloom * 1.12 > birth : prog[l] > segments[b + 4];
        var a = segments[b + 7] * alpha[l];
        if (!vis || a < 0.01) continue;
        var x0 = segments[b], y0 = segments[b + 1], x1 = segments[b + 2], y1 = segments[b + 3], w = segments[b + 6];
        if (birth >= 0) {
          var cx = segments[b + 12], cy = segments[b + 13];
          x0 = cx + (x0 - cx) * cur.fs; y0 = cy + (y0 - cy) * cur.fs;
          x1 = cx + (x1 - cx) * cur.fs; y1 = cy + (y1 - cy) * cur.fs;
          w *= Math.max(0.55, zk) * cur.fs;
        }
        var sx = (x0 - cur.camX) * ppu + ox;
        if ((l === LAYER.FAR || l === LAYER.NEAR) && calm > 0) a *= lerp(1, smooth((sx - calmFrom) / (calmTo - calmFrom)), calm);
        if (a < 0.01) continue;
        ctx2d.strokeStyle = 'rgba(' + (segments[b + 8] * 255 | 0) + ',' + (segments[b + 9] * 255 | 0) + ',' + (segments[b + 10] * 255 | 0) + ',' + a.toFixed(3) + ')';
        ctx2d.lineWidth = Math.max(1, w * DPR);
        ctx2d.beginPath();
        ctx2d.moveTo(sx, (y0 - cur.camY) * ppu + oy);
        ctx2d.lineTo((x1 - cur.camX) * ppu + ox, (y1 - cur.camY) * ppu + oy);
        ctx2d.stroke();
      }
    });
  }

  /* Следим за плавностью: если кадры идут слишком редко, упрощаем рисунок на ступень */
  var speedAvg = 16, speedClock = 0;
  function applyTier() {
    document.documentElement.classList.toggle('lite', tier >= 2);
    resize();
  }
  function watchSpeed(raw, now) {
    if (!canAdapt || tier >= 3 || raw > 1500 || document.hidden || now - start < 2500) return;
    speedAvg += (raw - speedAvg) * 0.08;
    speedClock += raw;
    if (speedClock < 1500) return;
    speedClock = 0;
    if (speedAvg > 42) {
      tier++;
      speedAvg = 20;
      applyTier();
    }
  }

  function frame(now) {
    var raw = now - last;
    var dt = Math.min(0.2, raw / 1000);
    last = now;
    watchSpeed(raw, now);
    var time = (now - start) / 1000;
    if (intro < 1) intro = Math.min(1, intro + dt / 2.8);

    var goal = target(scrollY);
    var k = snapNext ? 1 : 1 - Math.exp(-dt * 4.5);
    snapNext = false;
    var moving = 0;
    for (var key in cur) {
      var d = goal[key] - cur[key];
      cur[key] += d * k;
      moving = Math.max(moving, Math.abs(d));
    }
    mouse[0] += (mouseT[0] - mouse[0]) * 0.06;
    mouse[1] += (mouseT[1] - mouse[1]) * 0.06;

    // Плавно обновляем кадр, когда картинка движется; в покое хватает частоты «дрожания» линий.
    var active = moving > 0.0008 || intro < 1;
    var alive = cur.petals > 0.002 || cur.redH > 0.01;
    var pace = TIERS[tier];
    var minGap = active ? pace.gap : alive ? pace.alive : pace.idle;
    if (now - lastDraw >= minGap) {
      lastDraw = now;
      if (gl) draw(time); else if (ctx2d) draw2D();
      updateLabels();
    }
    requestAnimationFrame(frame);
  }

  function boot() {
    if (gl) {
      try { initGL(); }
      catch (e) {
        console.warn('Рисунок: WebGL2 не запустился', e);
        gl = null;
        // На холсте с уже созданным WebGL обычное рисование недоступно, нужен новый холст.
        var fresh = canvas.cloneNode(false);
        canvas.parentNode.replaceChild(fresh, canvas);
        canvas = fresh;
      }
    }
    if (!gl) {
      ctx2d = canvas.getContext('2d');
      document.documentElement.classList.add('no-webgl');
      tier = 3;
      canAdapt = false;
    }
    document.documentElement.classList.toggle('lite', tier >= 2);
    resize();
    requestAnimationFrame(frame);
  }

  canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
  canvas.addEventListener('webglcontextrestored', function () { initGL(); resize(); });
  addEventListener('resize', resize);
  addEventListener('load', measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  window.VydohSketch = {
    remeasure: measure,
    snap: function () { snapNext = true; intro = 1; },
    state: function () { return cur; },
    stats: function () { return { segments: segCount, webgl: !!gl, tier: tier, soft: softGL }; }
  };

  boot();
})();
