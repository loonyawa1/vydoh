/* Всё, что движется на странице, кроме фонового рисунка: параллакс, счётчики, лента хронологии,
   сравнение витрин, «толпа» и график. */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.add('js');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Зерно плёнки: маленькая случайная текстура */
  (function grain() {
    var el = document.getElementById('grain');
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var ctx = c.getContext('2d'), img = ctx.createImageData(128, 128);
    for (var i = 0; i < img.data.length; i += 4) {
      var v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    el.style.backgroundImage = 'url(' + c.toDataURL() + ')';
  })();

  /* ---------- Появление ---------- */
  var reveal = document.querySelectorAll('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    var ioR = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.remove('pre');
          ioR.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    reveal.forEach(function (el) {
      if (el.getBoundingClientRect().top > innerHeight * 0.92) {
        el.classList.add('pre');
        ioR.observe(el);
      }
    });
  }

  /* ---------- Счётчики ---------- */
  function format(v, dec) { return v.toFixed(dec).replace('.', ','); }
  if ('IntersectionObserver' in window && !reduce) {
    var ioC = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        ioC.unobserve(e.target);
        var el = e.target, to = parseFloat(el.dataset.to), dec = parseInt(el.dataset.dec || '0', 10);
        var suffix = el.textContent.replace(/[\d\s,.]+/, ''), t0 = performance.now();
        (function step(now) {
          var k = Math.min(1, (now - t0) / 1300);
          k = 1 - Math.pow(1 - k, 3);
          el.textContent = format(to * k, dec) + suffix;
          if (k < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.6 });
    document.querySelectorAll('.num[data-to]').forEach(function (el) { ioC.observe(el); });
  }

  /* ---------- Параллакс ---------- */
  var layers = [], bleeds = [], framed = [];
  function collect() {
    layers = [];
    document.querySelectorAll('[data-speed]').forEach(function (el) {
      el.style.transform = '';
      var r = el.getBoundingClientRect();
      layers.push({ el: el, s: parseFloat(el.dataset.speed), mid: r.top + scrollY + r.height / 2, h: r.height });
    });
    bleeds = [];
    document.querySelectorAll('[data-parallax]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      bleeds.push({ img: el.querySelector('img'), top: r.top + scrollY, h: r.height });
    });
    framed = [];
    document.querySelectorAll('.ph-in').forEach(function (el) {
      var r = el.getBoundingClientRect();
      framed.push({ img: el.querySelector('img'), top: r.top + scrollY, h: r.height });
    });
  }
  var parallaxCleared = false;
  function parallax(y, H) {
    if (reduce) return;
    // На слабом компьютере картинки стоят на месте: так прокрутка остаётся плавной.
    if (root.classList.contains('lite')) {
      if (!parallaxCleared) {
        parallaxCleared = true;
        layers.forEach(function (o) { o.el.style.transform = ''; });
        bleeds.concat(framed).forEach(function (o) { o.img.style.removeProperty('--img-y'); });
      }
      return;
    }
    var soft = innerWidth < 900 ? 0.5 : 1;
    var i, o;
    for (i = 0; i < layers.length; i++) {
      o = layers[i];
      var d = y + H / 2 - o.mid;
      if (Math.abs(d) > H * 1.4 + o.h) continue;
      o.el.style.transform = 'translate3d(0,' + (d * o.s * soft).toFixed(1) + 'px,0)';
    }
    for (i = 0; i < bleeds.length; i++) {
      o = bleeds[i];
      if (y + H < o.top - 100 || y > o.top + o.h + 100) continue;
      var p = (y + H - o.top) / (H + o.h);
      o.img.style.setProperty('--img-y', ((p - 0.5) * o.h * 0.24).toFixed(1) + 'px');
    }
    for (i = 0; i < framed.length; i++) {
      o = framed[i];
      if (y + H < o.top - 100 || y > o.top + o.h + 100) continue;
      var q = (y + H - o.top) / (H + o.h);
      o.img.style.setProperty('--img-y', ((q - 0.5) * o.h * 0.075).toFixed(1) + 'px');
    }
  }

  /* ---------- Счётчик лет и полоса прогресса ---------- */
  var yearEl = document.getElementById('year');
  var progress = document.querySelector('#progress i');
  var marks = [];
  function collectYears() {
    marks = [];
    document.querySelectorAll('[data-year]').forEach(function (el) {
      var r = el.getBoundingClientRect();
      marks.push({ y: r.top + scrollY, v: parseInt(el.dataset.year, 10) });
    });
    marks.sort(function (a, b) { return a.y - b.y; });
  }
  var shownYear = '';
  function updateYear(y, H) {
    var at = y + H * 0.5, v = marks.length ? marks[0].v : 1941;
    for (var i = 0; i < marks.length - 1; i++) {
      if (at >= marks[i].y && at < marks[i + 1].y) {
        var k = (at - marks[i].y) / (marks[i + 1].y - marks[i].y);
        var ease = k < 0.6 ? 0 : (k - 0.6) / 0.4;
        v = marks[i].v + (marks[i + 1].v - marks[i].v) * ease;
        break;
      }
      if (at >= marks[i + 1].y) v = marks[i + 1].v;
    }
    var label = String(Math.round(v));
    if (label !== shownYear) { yearEl.textContent = label; shownYear = label; }
    var total = root.scrollHeight - H;
    progress.style.transform = 'scaleY(' + (total > 0 ? y / total : 0).toFixed(4) + ')';
  }

  /* ---------- Хронология: лента едет вбок при прокрутке вниз ---------- */
  var hs = document.querySelector('.hs');
  var track = hs && hs.querySelector('.hs-track');
  var hsDist = 0, hsTop = 0;
  function setupHs() {
    if (!hs) return;
    track.style.transform = '';
    hsDist = Math.max(0, track.scrollWidth - innerWidth * 0.72);
    hs.style.height = 'calc(100svh + ' + hsDist + 'px)';
    hsTop = hs.getBoundingClientRect().top + scrollY;
  }
  function updateHs(y) {
    if (!hs) return;
    var p = (y - hsTop) / Math.max(1, hsDist);
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    track.style.transform = 'translate3d(' + (-p * hsDist).toFixed(1) + 'px,0,0)';
  }

  /* ---------- Цикл прокрутки ---------- */
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var y = scrollY, H = innerHeight;
      parallax(y, H);
      updateYear(y, H);
      updateHs(y);
    });
  }
  function layout() {
    setupHs();
    collect();
    collectYears();
    if (window.VydohSketch) window.VydohSketch.remeasure();
    onScroll();
  }
  addEventListener('scroll', onScroll, { passive: true });
  var resizeTimer;
  addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 160);
  });
  addEventListener('load', layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  layout();

  /* ---------- Сравнение витрин ---------- */
  document.querySelectorAll('.ba').forEach(function (box) {
    var input = box.querySelector('input');
    input.addEventListener('input', function () { box.style.setProperty('--pos', input.value + '%'); });
  });

  /* ---------- Из ста человек ---------- */
  var PEOPLE = {
    1985: { m: 58, w: 18, s: 'LRC и MONICA, оценка на 1985 год, опросы в отдельных городах' },
    1992: { m: 57, w: 7, s: 'RLMS 1992, старше 18 лет, по Perlman и др., 2007' },
    2003: { m: 63, w: 15, s: 'RLMS 2003, старше 18 лет, по Perlman и др., 2007' },
    2009: { m: 61, w: 22, s: 'GATS 2009, 15 лет и старше, любой табак' },
    2016: { m: 51, w: 14, s: 'GATS 2016, 15 лет и старше, любой табак' },
    2024: { m: 32, w: 8, s: 'Росстат 2024, 15 лет и старше, наблюдение здоровья' }
  };
  function fillCrowd(id) {
    var box = document.getElementById(id), html = '';
    for (var i = 0; i < 100; i++) html += '<svg aria-hidden="true"><use href="#man"/></svg>';
    box.innerHTML = html;
    return box.children;
  }
  var menIcons = fillCrowd('men'), womenIcons = fillCrowd('women');
  function setYear(y) {
    var d = PEOPLE[y];
    for (var i = 0; i < 100; i++) {
      menIcons[i].classList.toggle('lit', i < d.m);
      womenIcons[i].classList.toggle('lit', i < d.w);
    }
    document.getElementById('men-n').textContent = d.m;
    document.getElementById('women-n').textContent = d.w;
    document.getElementById('people-src').textContent = d.s + '. Числа округлены.';
    document.querySelectorAll('.years button').forEach(function (b) {
      var on = b.dataset.y === String(y);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  document.querySelectorAll('.years button').forEach(function (b) {
    b.addEventListener('click', function () { setYear(b.dataset.y); });
  });
  setYear(2009);

  /* ---------- График: разные методики намеренно не соединены ---------- */
  var SERIES = [
    { key: 'monica', name: 'LRC/MONICA', shape: 'tri', line: null, pts: [[1985, 58.2, 18.4]] },
    { key: 'rlmsA', name: 'RLMS (Perlman)', shape: 'dot', line: '', pts: [[1992, 57.4, 6.9], [1993, 60.8, 7.7], [1994, 59.0, 9.0], [1995, 61.3, 9.1], [1996, 61.9, 9.8], [1998, 61.0, 10.5], [2000, 61.3, 11.5], [2001, 62.2, 13.9], [2002, 63.0, 13.8], [2003, 62.6, 14.8]] },
    { key: 'rlmsB', name: 'RLMS (Shkolnikov)', shape: 'dot', line: '', pts: [[2004, 62.0, 18.0], [2007, 62.9, 18.8], [2010, 56.5, 17.9], [2013, 53.3, 17.5], [2014, 52.3, 17.8], [2015, 48.6, 17.3], [2016, 48.1, 17.5]] },
    { key: 'gats', name: 'GATS', shape: 'dia', line: '5 5', pts: [[2009, 60.7, 21.7], [2016, 50.9, 14.3]] },
    { key: 'rosstat', name: 'Росстат', shape: 'sq', line: '2 5', pts: [[2019, 40, 11], [2024, 32.3, 7.7]] }
  ];
  var MEN = '#3f8ddb', WOMEN = '#e0568f', INK = '#f1ece2', INK2 = '#c2bcb0', GRID = 'rgba(241,236,226,.16)';
  var comma = function (v) { return String(v).replace('.', ','); };

  var tbody = document.querySelector('#chart-table tbody');
  var rows = [];
  SERIES.forEach(function (s) { s.pts.forEach(function (p) { rows.push({ y: p[0], m: p[1], w: p[2], src: s.name }); }); });
  rows.sort(function (a, b) { return a.y - b.y; });
  tbody.innerHTML = rows.map(function (r) {
    return '<tr><td>' + r.y + '</td><td>' + r.src + '</td><td>' + comma(r.m) + '</td><td>' + comma(r.w) + '</td></tr>';
  }).join('');

  function mark(shape, x, y, color) {
    var ring = ' stroke="#000" stroke-width="2"';
    if (shape === 'dot') return '<circle cx="' + x + '" cy="' + y + '" r="4" fill="' + color + '"' + ring + '/>';
    if (shape === 'dia') return '<rect x="' + (x - 4.5) + '" y="' + (y - 4.5) + '" width="9" height="9" fill="#000" stroke="' + color + '" stroke-width="2" transform="rotate(45 ' + x + ' ' + y + ')"/>';
    if (shape === 'sq') return '<rect x="' + (x - 4.5) + '" y="' + (y - 4.5) + '" width="9" height="9" rx="1" fill="' + color + '"' + ring + '/>';
    return '<path d="M' + x + ' ' + (y - 6) + 'l6 10h-12z" fill="' + color + '"' + ring + '/>';
  }

  var chartBox = document.getElementById('chart');
  function drawChart() {
    var W = chartBox.clientWidth;
    if (!W) return;
    var narrow = W < 520;
    var H = Math.round(Math.max(300, Math.min(440, W * 0.66)));
    var m = { l: 42, r: 14, t: 16, b: 30 };
    var X0 = 1983, X1 = 2026, Y1 = 70;
    function X(v) { return +(m.l + ((v - X0) / (X1 - X0)) * (W - m.l - m.r)).toFixed(1); }
    function Y(v) { return +(m.t + ((Y1 - v) / Y1) * (H - m.t - m.b)).toFixed(1); }
    var fs = narrow ? 11.5 : 12.5, s = '';
    [0, 20, 40, 60].forEach(function (v) {
      s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="' + GRID + '"/>';
      s += '<text x="' + (m.l - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="' + fs + '" fill="' + INK2 + '">' + v + '%</text>';
    });
    (narrow ? [1985, 2000, 2015] : [1985, 1995, 2005, 2015, 2025]).forEach(function (v) {
      s += '<text x="' + X(v) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="' + fs + '" fill="' + INK2 + '">' + v + '</text>';
    });
    // Полоса закона
    s += '<rect x="' + X(2013) + '" y="' + m.t + '" width="' + Math.max(4, X(2014) - X(2013)) + '" height="' + (H - m.t - m.b) + '" fill="rgba(255,143,177,.22)"/>';
    s += '<text x="' + (X(2014) + 7) + '" y="' + (m.t + 12) + '" font-size="' + fs + '" fill="' + INK + '">закон</text>';
    // Подписи линий
    s += '<text x="' + X(1994) + '" y="' + (Y(61) - 14) + '" text-anchor="middle" font-size="' + (fs + 1) + '" font-weight="500" fill="' + INK + '">мужчины</text>';
    s += '<text x="' + X(1994) + '" y="' + (Y(8) + 22) + '" text-anchor="middle" font-size="' + (fs + 1) + '" font-weight="500" fill="' + INK + '">женщины</text>';

    var lines = '', marks = '';
    SERIES.forEach(function (ser) {
      [[1, MEN], [2, WOMEN]].forEach(function (pair) {
        var idx = pair[0], col = pair[1];
        if (ser.line !== null && ser.pts.length > 1) {
          var d = ser.pts.map(function (p) { return X(p[0]) + ',' + Y(p[idx]); }).join(' ');
          lines += '<polyline class="ln" points="' + d + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (ser.line ? ' stroke-dasharray="' + ser.line + '"' : '') + '/>';
        }
        ser.pts.forEach(function (p) { marks += mark(ser.shape, X(p[0]), Y(p[idx]), col); });
      });
    });
    s += lines + marks;
    s += '<line class="cross" x1="0" x2="0" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="' + INK + '" stroke-width="1" opacity="0"/>';
    chartBox.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Доля курящих мужчин и женщин с 1985 по 2024 год. У мужчин около 60 процентов до середины 2000-х, затем снижение до 32 процентов. У женщин рост с 7 до 18 процентов и снижение до 8. Таблица ниже.">' + s + '</svg><div class="chart-tip"></div>';

    var tip = chartBox.querySelector('.chart-tip'), cross = chartBox.querySelector('.cross'), tipTimer;
    function show(e) {
      // На телефоне нет ухода курсора, поэтому подсказка закрывается сама.
      clearTimeout(tipTimer);
      if (e.pointerType === 'touch') tipTimer = setTimeout(hide, 3200);
      var box = chartBox.getBoundingClientRect();
      var px = e.clientX - box.left;
      var best = null, dist = 1e9;
      rows.forEach(function (r) {
        var d = Math.abs(X(r.y) - px);
        if (d < dist) { dist = d; best = r.y; }
      });
      var hit = rows.filter(function (r) { return r.y === best; });
      var top = Y(Math.max.apply(null, hit.map(function (r) { return r.m; })));
      tip.innerHTML = '<b>' + best + '</b><br>' + hit.map(function (r) {
        return r.src + ': мужчины ' + comma(r.m) + '%, женщины ' + comma(r.w) + '%';
      }).join('<br>');
      var half = tip.offsetWidth / 2, lx = Math.min(W - half - 2, Math.max(half + 2, X(best)));
      tip.style.left = lx + 'px';
      tip.style.top = Math.max(tip.offsetHeight + 6, top) + 'px';
      tip.style.opacity = 1;
      cross.setAttribute('x1', X(best));
      cross.setAttribute('x2', X(best));
      cross.setAttribute('opacity', '.5');
    }
    function hide() { tip.style.opacity = 0; cross.setAttribute('opacity', '0'); }
    var svg = chartBox.querySelector('svg');
    svg.addEventListener('pointermove', show);
    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointerleave', hide);
  }
  drawChart();
  var chartWidth = chartBox.clientWidth;
  addEventListener('resize', function () {
    if (chartBox.clientWidth !== chartWidth) {
      chartWidth = chartBox.clientWidth;
      drawChart();
    }
  });
})();
