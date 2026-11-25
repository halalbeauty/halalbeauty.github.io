/* Halal Beauty — меню, появление секций, табы, карусели работ */
(function () {
  'use strict';

  /* ---------- Мобильное меню ---------- */
  var burger = document.querySelector('.burger');
  var nav = document.getElementById('nav');

  function setNav(open) {
    document.body.classList.toggle('nav-open', open);
    burger.setAttribute('aria-expanded', String(open));
  }

  burger.addEventListener('click', function () {
    setNav(!document.body.classList.contains('nav-open'));
  });

  /* Панель закрывается по клику на ссылку; переход по якорю — нативный
     (scroll-behavior: smooth + scroll-margin-top), скролл фона мы не
     блокируем, поэтому sticky-шапка не ломается. */
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setNav(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setNav(false);
  });

  // Меню сбрасывается, если экран стал широким при открытом меню
  var wide = window.matchMedia('(min-width: 980px)');
  var onWide = function (e) { if (e.matches) setNav(false); };
  if (wide.addEventListener) wide.addEventListener('change', onWide);
  else if (wide.addListener) wide.addListener(onWide); // Safari < 14

  /* ---------- Линия под шапкой при прокрутке ---------- */
  var header = document.querySelector('.header');

  /* Реальная высота шапки → --header-h: от неё считается верх и высота
     мобильной панели. Захардкоженное значение расходилось с фактическим
     (перенос строки в логотипе, крупный шрифт), и панель уезжала. */
  var syncHeaderH = function () {
    document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
  };
  syncHeaderH();
  window.addEventListener('resize', syncHeaderH);
  window.addEventListener('orientationchange', syncHeaderH);

  var onScroll = function () {
    header.classList.toggle('scrolled', window.scrollY > 16);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Важное: показываем записи по датам (время Алматы, UTC+5) ---------- */
  var news = document.getElementById('news');
  var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function syncNews() {
    if (!news) return;
    var today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
    var any = false;
    Array.prototype.forEach.call(news.querySelectorAll('.news-card'), function (card) {
      var from = card.getAttribute('data-from');
      var to = card.getAttribute('data-to');
      var on = (!from || from <= today) && (!to || to >= today);
      card.hidden = !on;
      if (on) any = true;
      var term = '';
      if (to) {
        var d = to.split('-');
        term = to === today
          ? (from === to ? 'только сегодня' : 'последний день')
          : 'до ' + Number(d[2]) + ' ' + MONTHS[Number(d[1]) - 1];
      }
      card.querySelector('.news-term').textContent = card.classList.contains('is-promo') ? term : '';
    });
    news.hidden = !any;
    Array.prototype.forEach.call(document.querySelectorAll('[data-news-link]'), function (li) { li.hidden = !any; });
  }
  syncNews();
  // Вкладку могли оставить открытой до следующего дня
  document.addEventListener('visibilitychange', function () { if (!document.hidden) syncNews(); });

  /* ---------- Появление секций ---------- */
  var reveals = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- Категории услуг ---------- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.cat-nav button'));

  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focus) tab.focus();
  }

  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { selectTab(tab); });
    tab.addEventListener('keydown', function (e) {
      var next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
      if (next < 0 || next >= tabs.length) return;
      e.preventDefault();
      selectTab(tabs[next], true);
    });
  });

  /* ---------- Работы: карусели ----------
     Листание — нативный scroll-snap (свайп работает и без скрипта).
     Скрипт делает пять вещей: индикатор, стрелки/клавиши для десктопа,
     высоту окна (оно следует за пальцем и плавно переходит от пропорций
     текущего фото к пропорциям следующего), подгрузку соседних фото и
     цвет фона окна по текущему фото (виден, если лента «пружинит» за краем). */
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Array.prototype.forEach.call(document.querySelectorAll('.work'), function (card) {
    var media = card.querySelector('.work-media');
    var track = card.querySelector('.work-track');
    var imgs = card.querySelectorAll('.work-slide');
    var bars = card.querySelectorAll('.work-bars i');
    var prev = card.querySelector('.work-nav.prev');
    var next = card.querySelector('.work-nav.next');
    var count = imgs.length;
    var current = -1;
    var queued = false;
    var width = 0;
    if (!media || !track || count < 2) return;

    // Ленивая загрузка браузера не знает, что соседнее фото вот-вот понадобится:
    // когда карточка рядом с экраном, подгружаем все её фото, чтобы при свайпе не было пустоты
    // Заодно заранее декодируем: иначе фото, на которое только что перелистнули, может мигнуть пустым
    function warmUp() {
      Array.prototype.forEach.call(imgs, function (im) {
        im.loading = 'eager';
        if (im.decode) im.decode().catch(function () { /* не критично */ });
      });
    }
    if ('IntersectionObserver' in window) {
      var warm = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        warm.disconnect();
        warmUp();
      }, { rootMargin: '600px 0px' });
      warm.observe(card);
    } else {
      warmUp();
    }

    // Средний цвет каждого фото (чуть темнее, чтобы не слепил). Фото с того же сайта,
    // поэтому canvas не «грязнится»; если вдруг не вышло — остаётся обычный фон.
    var colors = [];
    function paint() { if (current >= 0 && colors[current]) media.style.backgroundColor = colors[current]; }
    Array.prototype.forEach.call(imgs, function (im, k) {
      function sample() {
        try {
          var cv = document.createElement('canvas');
          cv.width = cv.height = 8;
          var cx = cv.getContext('2d');
          cx.drawImage(im, 0, 0, 8, 8);
          var d = cx.getImageData(0, 0, 8, 8).data;
          var r = 0, g = 0, b = 0, n = d.length / 4;
          for (var j = 0; j < d.length; j += 4) { r += d[j]; g += d[j + 1]; b += d[j + 2]; }
          colors[k] = 'rgb(' + Math.round(r / n * 0.85) + ',' + Math.round(g / n * 0.85) + ',' + Math.round(b / n * 0.85) + ')';
          if (k === current) paint();
        } catch (e) { /* без цвета фона — не страшно */ }
      }
      if (im.complete && im.naturalWidth) sample(); else im.addEventListener('load', sample);
    });

    // ширину не читаем на каждом кадре: меняется она только при повороте/изменении окна
    var measure = function () { width = track.clientWidth; };
    measure();

    // высота / ширина каждого фото — считаем один раз (из атрибутов, их пишет render.py)
    var ratios = Array.prototype.map.call(imgs, function (im) {
      var w = +im.getAttribute('width');
      var h = +im.getAttribute('height');
      return w && h ? h / w : 0;
    });

    function fit(p) {
      var i = Math.min(count - 1, Math.floor(p));
      var a = ratios[i];
      var b = ratios[Math.min(count - 1, i + 1)];
      if (!a || !b) return;
      media.style.aspectRatio = String(1 / (a + (b - a) * (p - i)));
    }

    function update() {
      queued = false;
      if (!width) { measure(); if (!width) return; }
      var p = Math.max(0, Math.min(count - 1, track.scrollLeft / width));
      fit(p);
      var i = Math.round(p);
      if (i === current) return;
      current = i;
      paint();
      Array.prototype.forEach.call(bars, function (bar, k) { bar.classList.toggle('on', k === i); });
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === count - 1;
    }

    function go(step) {
      var i = Math.max(0, Math.min(count - 1, current + step));
      track.scrollTo({ left: i * width, behavior: calm ? 'auto' : 'smooth' });
    }

    function queue() {
      if (!queued) { queued = true; window.requestAnimationFrame(update); }
    }

    track.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', function () {
      measure();
      track.scrollLeft = Math.max(0, current) * width;
      queue();
    });
    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    });
    update();
  });
  /* ---------- Обучение: раскрытие «Программы обучения» ----------
     Анимация целиком в CSS (.plan-more.is-open); скрипт только переключает класс,
     aria-expanded и подпись кнопки. Карточки раскрываются независимо друг от друга. */
  Array.prototype.forEach.call(document.querySelectorAll('.plan-more'), function (box) {
    var btn = box.querySelector('.plan-toggle');
    var label = btn && btn.querySelector('span');
    if (!btn || !label) return;
    btn.addEventListener('click', function () {
      var open = !box.classList.contains('is-open');
      box.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      label.textContent = open ? 'Скрыть' : 'Программа обучения';
    });
  });

  /* ---------- Филиалы: золотое свечение следует за курсором ----------
     Только для мыши; на телефоне и при «уменьшении движения» не подключается.
     Скрипт лишь передаёт координаты в --mx/--my, двигает свечение CSS (transform). */
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    Array.prototype.forEach.call(document.querySelectorAll('.branch'), function (card) {
      var raf = 0, px = 0, py = 0;
      card.addEventListener('pointermove', function (e) {
        px = e.clientX; py = e.clientY;
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          var r = card.getBoundingClientRect();
          card.style.setProperty('--mx', (px - r.left) + 'px');
          card.style.setProperty('--my', (py - r.top) + 'px');
        });
      });
    });
  }
})();

/* ---------- Наши мастера: ряд «как на вешалке» ----------
   Одна дробная позиция pos догоняет target каждый кадр (requestAnimationFrame).
   Положение, ширина, масштаб, прозрачность, тень, затемнение и z-index каждой карточки
   считаются непрерывно от d = i - pos, а не включаются классом.
   Все карточки непрозрачные: «дальность» — это тёмный слой поверх и уменьшение. */
(function () {
  'use strict';

  var PHOTO_DIR = 'images/masters/';

  /* ================= ДАННЫЕ МАСТЕРОВ — править здесь =================
     Карточка оформлена как «Почему нам доверяют»: круг с фото, имя,
     строка капсом (role + exp) и короткий абзац about.
     photo — файл в images/masters/ (нет файла — круг с первой буквой).          */
  var MASTERS = [
    {
      name: 'Камшат', photo: 'kamshat.jpg', role: ['Косметолог'], exp: '5 лет опыта',
      about: 'Чистка лица, пилинги, мезотерапия, капилляротерапия, хиджама, отбеливающие и уходовые процедуры. Каждую процедуру подбирает с учётом состояния и потребностей кожи.'
    },
    {
      name: 'Зейнеп', photo: 'zeynep.jpg', role: ['Lamimaker'], exp: '3 года опыта',
      about: 'Ламинирование ресниц и бровей, подбор изгиба, укладка и уход. Подбирает форму под индивидуальные особенности, сохраняя естественность и гармонию образа.'
    },
    {
      name: 'Бакнур', photo: 'baknur.jpg', role: ['Lamimaker'], exp: '3 года опыта',
      about: 'Ламинирование ресниц и бровей с подбором изгиба под длину и густоту ресниц. В работе ценит естественный результат, аккуратность и выразительный взгляд.'
    },
    {
      name: 'Диля', photo: 'dilya.jpg', role: ['Podolog', 'Nail stylist'], exp: '23 года опыта',
      about: 'Маникюр, педикюр и подологический уход: работа с проблемными ногтями и стопами, профилактика. Берётся не только за эстетику, но и за сложные случаи.'
    },
    {
      name: 'Карина', photo: 'karina.jpg', role: ['Nail stylist'], exp: '3 месяца опыта',
      about: 'Маникюр и педикюр, в том числе гигиенические, холодный парафин для рук и ног, снятие гель-лака. Для неё важны аккуратность, чистота и комфорт клиентки.'
    },
    {
      name: 'Асель', photo: 'asel.jpg', role: ['Hair stylist'], exp: '9 лет опыта',
      about: 'Стрижки и окрашивание любой сложности — мелирование, балаяж, AirTouch, а также укладки, уход и биозавивка. Подбирает образ с учётом структуры волос и черт лица.'
    },
    {
      name: 'Салтанат', photo: 'saltanat.jpg', role: ['Lamimaker'], exp: '2 года опыта',
      about: 'Ламинирование ресниц и бровей, архитектура, коррекция и окрашивание бровей. Добивается гармоничного, естественного результата и открытого взгляда.'
    },
    {
      name: 'Гульзара', photo: 'gulzara.jpg', role: ['Hair stylist'], exp: '10 лет опыта',
      about: 'Стрижки, окрашивание любой сложности, причёски и укладки. Подбирает форму и оттенок, которые действительно подходят, — с учётом структуры волос, стиля и пожеланий.'
    },
    {
      name: 'Айгуль', photo: 'aigul.jpg', role: ['Мастер массажа', 'Lamimaker'], exp: '5 лет опыта',
      about: 'Массаж тела, ламинирование ресниц и бровей. В ламинировании любит естественный эффект без перегруженности, в массаже — помочь расслабиться и снять напряжение.'
    },
    {
      name: 'Рабия', photo: 'rabiya.jpg', role: ['Массажист'], exp: 'Более 1 года опыта',
      about: 'Бережно работает с мышечными зажимами, усталостью, напряжением в спине и шее, скованностью после нагрузок. После массажа тело расслабляется, а движения становятся лёгкими.'
    },
    {
      name: 'Балым', photo: 'balym.jpg', role: ['Hair stylist'], exp: '20 лет опыта',
      about: 'Женские стрижки, укладки, окрашивание и сложные техники, уход за волосами. Точно подбирает форму, оттенок и образ с учётом особенностей внешности.'
    },
    {
      name: 'Лейла', photo: 'leyla.jpg', role: ['Массажист', 'Остеопат'], exp: '7 лет практики',
      about: 'Массаж для расслабления, снятия напряжения и восстановления: зажимы, дискомфорт в спине и шее, усталость. Сертифицированный остеопат — дополняет массаж более глубокой работой с телом.'
    },
    {
      name: 'Асем', photo: 'asem.jpg', role: ['Hair stylist'], exp: '15 лет опыта',
      about: 'Женские стрижки, окрашивание и сложные техники, укладки и уход. Подбирает стрижку и оттенок с учётом структуры волос, черт лица и желаемого образа.'
    },
    {
      name: 'Сабина', photo: 'sabina.jpg', role: ['Nail stylist', 'Лазерная эпиляция'], exp: '19 лет в beauty-сфере',
      about: 'Маникюр и педикюр с вниманием к деталям, бережная лазерная эпиляция. Точность на каждом этапе — к Сабине возвращаются и рекомендуют её близким.'
    }
  ];

  /* ================= Ряд ================= */
  var stage = document.querySelector('[data-masters]');
  if (!stage || !MASTERS.length) return;

  var track = stage.querySelector('.team-track');
  var count = stage.querySelector('.team-count');
  var dotsBox = stage.querySelector('.team-dots');
  var live = stage.querySelector('.team-sr');
  var btnPrev = stage.querySelector('.team-nav.prev');
  var btnNext = stage.querySelector('.team-nav.next');
  var N = MASTERS.length;

  var states = [], dots = [];
  var pos = 0, target = 0;          // дробный индекс карточки в центре и цель, к которой он едет
  var raf = 0, lastTs = 0;
  var shown = -1;                    // какая карточка сейчас «текущая» (для счётчика, точек, aria)

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function idxOf(v) { return clamp(Math.round(v), 0, N - 1); }
  function reduced() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function ease(t) { return t * t * (3 - 2 * t); }   // smoothstep

  /* ---------- Геометрия ряда ---------- */
  var SC = [1, 0.92, 0.84, 0.78, 0.74];     // масштаб по расстоянию от центра в карточках
  var DIM = [0, 0.34, 0.5, 0.62, 1.1];      // затемнение: растёт с расстоянием (у самого края почти чёрное)
  var SHD = [1, 0.35, 0.25, 0.2, 0.2];      // сила тени
  var MAXD = 3.5;                            // видны 3 карточки с каждой стороны; четвёртая только «выезжает» (до 3.5), дальше visibility:hidden
  var geo = { E: 560, c: 170, unit: 255, Xs: [0, 0, 0, 0, 0] };

  /* значение по узлам (узлы — целые t), первый отрезок — со сглаживанием */
  function pts(arr, t, smoothFirst) {
    var i = Math.floor(t);
    if (i >= arr.length - 1) return arr[arr.length - 1];
    var f = t - i;
    if (i === 0 && smoothFirst) f = ease(f);
    return arr[i] + (arr[i + 1] - arr[i]) * f;
  }
  function computeGeo() {
    var vw = stage.clientWidth || window.innerWidth;
    var E, c, overlap;
    if (vw < 640) { E = Math.min(vw * 0.86, 420); c = 140; overlap = 22; }
    else { E = Math.min(480, vw * 0.9); c = vw < 900 ? 160 : 170; overlap = 26; }
    var gap = 10, Xs = [0];
    Xs[1] = E / 2 + (c * SC[1]) / 2 - overlap;          // ближайший сосед чуть заходит под центральную
    for (var k = 2; k < SC.length; k++) Xs[k] = Xs[k - 1] + (c * SC[k - 1]) / 2 + (c * SC[k]) / 2 + gap;
    geo = { E: E, c: c, unit: c * 1.5, Xs: Xs };
    stage.style.setProperty('--E', E.toFixed(1) + 'px');
    stage.style.setProperty('--c', c + 'px');
  }

  /* ---------- Фото ----------
     Файл images/masters/<имя>.<jpg|png|webp> подключается сам, по имени из поля photo
     (kamshat.jpg → kamshat). Расширения проверяются по очереди; какое подошло у предыдущего
     мастера, пробуется первым, чтобы не плодить лишние запросы. Нет файла — заглушка с буквой.
     Ищем только у тех, кто попал в видимую зону ряда. */
  var PHOTO_EXT = ['jpg', 'png', 'webp'];     // все текущие фото — jpg; остальные форматы — запасные
  var rings = [];                                   // у каждого мастера два кольца: свёрнутая и раскрытая карточки

  function ring(m, mini, i) {
    var r = el('span', 'tm-ring');
    var ph = el('span', 'tm-ph is-wait');
    var img = document.createElement('img');
    var size = mini ? 96 : 136;
    img.alt = mini ? '' : 'Фото: ' + m.name;
    img.width = size;
    img.height = size;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    var letter = el('span', 'tm-letter', m.name.charAt(0));
    letter.setAttribute('aria-hidden', 'true');
    ph.appendChild(letter);
    ph.appendChild(img);
    r.appendChild(ph);
    (rings[i] = rings[i] || []).push({ ph: ph, img: img });
    return r;
  }

  var photoState = [];                              // 0 — не искали, 1 — ищем, 2 — готово
  function ensurePhoto(i) {
    if (photoState[i]) return;
    photoState[i] = 1;
    var base = MASTERS[i].photo.replace(/\.\w+$/, '');
    var exts = PHOTO_EXT.slice();
    if (ensurePhoto.last) { exts.splice(exts.indexOf(ensurePhoto.last), 1); exts.unshift(ensurePhoto.last); }
    var k = 0;
    (function next() {
      if (k >= exts.length) { done(null); return; }
      var probe = new Image();
      probe.onload = function () { ensurePhoto.last = exts[k]; done(PHOTO_DIR + base + '.' + exts[k]); };
      probe.onerror = function () { k++; next(); };
      probe.src = PHOTO_DIR + base + '.' + exts[k];
    })();
    function done(url) {
      photoState[i] = 2;
      (rings[i] || []).forEach(function (x) {
        x.ph.classList.remove('is-wait');
        if (!url) { x.ph.classList.add('is-empty'); if (x.img.parentNode) x.img.parentNode.removeChild(x.img); return; }
        x.img.addEventListener('load', function () { x.ph.classList.add('has-photo'); });
        x.img.src = url;
        if (x.img.complete) x.ph.classList.add('has-photo');
      });
    }
  }

  function roleNode(cls, lines) {
    var p = el('p', cls);
    lines.forEach(function (t) { p.appendChild(el('span', 'tm-rl', t)); });
    return p;
  }

  function buildItem(m, i) {
    var item = el('article', 'tm-item');
    item.tabIndex = 0;
    item.setAttribute('role', 'group');
    item.setAttribute('aria-roledescription', 'слайд');
    item.setAttribute('aria-label', m.name + ', ' + (i + 1) + ' из ' + N);

    var shadow = el('span', 'tm-shadow');
    shadow.setAttribute('aria-hidden', 'true');
    var card = el('div', 'tm-card');

    /* свёрнутый вид */
    var mini = el('div', 'tm-mini');
    mini.appendChild(ring(m, true, i));
    mini.appendChild(el('h3', 'tm-mini-name', m.name));
    mini.appendChild(roleNode('tm-mini-role', m.role));

    /* раскрытый вид */
    var full = el('div', 'tm-full');
    var inner = el('div', 'tm-inner');
    var anims = [];
    function anim(node) { node.classList.add('tm-a'); anims.push(node); return node; }

    inner.appendChild(anim(ring(m, false, i)));
    inner.appendChild(anim(el('h3', 'tm-name', m.name)));
    inner.appendChild(anim(el('p', 'tm-role', m.role.concat(m.exp).join(' · '))));
    inner.appendChild(anim(el('p', 'tm-about', m.about)));
    full.appendChild(inner);

    var dim = el('span', 'tm-dim');
    dim.setAttribute('aria-hidden', 'true');
    card.appendChild(mini);
    card.appendChild(full);
    card.appendChild(dim);
    item.appendChild(shadow);
    item.appendChild(card);
    track.appendChild(item);

    states.push({ item: item, shadow: shadow, dim: dim, mini: mini, full: full, inner: inner, anims: anims,
                  hidden: true, miniVis: true, fullVis: true, r: -1, ro: -1 });
  }

  MASTERS.forEach(function (m, i) {
    buildItem(m, i);
    var dot = el('button', 'team-dot');
    dot.type = 'button';
    dot.setAttribute('aria-label', m.name + ', ' + (i + 1) + ' из ' + N);
    dot.addEventListener('click', function () { setTarget(i); });
    dotsBox.appendChild(dot);
    dots.push(dot);
  });

  /* ---------- Отрисовка: всё считается от d = i - pos ---------- */
  function renderItem(i) {
    var st = states[i], it = st.item;
    var d = i - pos, t = Math.abs(d);

    if (t > MAXD) {
      if (!st.hidden) { it.style.visibility = 'hidden'; st.hidden = true; }
      return;
    }
    if (st.hidden) { it.style.visibility = 'visible'; st.hidden = false; ensurePhoto(i); }

    var e0 = ease(Math.min(t, 1));
    var W = geo.E + (geo.c - geo.E) * e0;             // ширина: от раскрытой к свёрнутой
    var S = pts(SC, t, false);                         // масштаб
    var X = (d < 0 ? -1 : 1) * pts(geo.Xs, t, false);  // смещение центра от центра ряда
    var tx = X - W / 2;

    it.style.width = W.toFixed(1) + 'px';
    it.style.transform = 'translate3d(' + tx.toFixed(1) + 'px,0,0) scale(' + S.toFixed(4) + ')';
    it.style.zIndex = String(20000 - Math.round(t * 1000) + (d < 0 ? 1 : 0));   // ближе к центру — выше
    /* у карточек дальше второй от центра остаются только фото и имя (должность и нить уходят) */
    var ro = clamp((2.9 - t) / 0.6, 0, 1);
    if (ro !== st.ro) { st.ro = ro; st.mini.style.setProperty('--ro', ro.toFixed(3)); }

    st.shadow.style.opacity = pts(SHD, t, true).toFixed(3);
    st.dim.style.opacity = pts(DIM, t, true).toFixed(3);

    /* свёрнутый и раскрытый вид перетекают друг в друга */
    var mo = clamp((t - 0.5) / 0.25, 0, 1);            // свёрнутая грань проявляется после того, как погасла раскрытая
    var fo = clamp((0.55 - t) / 0.25, 0, 1);
    st.mini.style.opacity = mo.toFixed(3);
    st.full.style.opacity = fo.toFixed(3);
    var mv = mo > 0, fv = fo > 0;
    if (mv !== st.miniVis) { st.mini.style.visibility = mv ? '' : 'hidden'; st.miniVis = mv; }   // '' = наследовать от карточки (явное visible перебивало бы скрытую карточку)
    if (fv !== st.fullVis) { st.full.style.visibility = fv ? '' : 'hidden'; st.fullVis = fv; }

    /* содержимое раскрытой карточки проявляется по очереди по мере приближения к центру */
    var r = clamp((0.75 - t) / 0.65, 0, 1);
    if (r !== st.r) {
      st.r = r;
      var K = st.anims.length;
      for (var k = 0; k < K; k++) {
        var o = clamp((r - (0.5 * k) / K) / 0.5, 0, 1);
        var a = st.anims[k];
        a.style.opacity = o.toFixed(3);
        a.style.transform = o < 1 ? 'translate3d(0,' + ((1 - o) * 12).toFixed(1) + 'px,0)' : '';
      }
    }
  }

  function render() {
    for (var i = 0; i < N; i++) renderItem(i);
  }

  /* ---------- Цикл: pos плавно догоняет target ---------- */
  var dragging = false;
  function tick(ts) {
    raf = 0;
    var dt = Math.min(50, ts - (lastTs || ts));
    lastTs = ts;
    var k = reduced() ? 0.5 : (dragging ? 0.32 : 0.12);
    k = 1 - Math.pow(1 - k, dt / 16.667);              // одинаково на 60 и 144 Гц
    pos += (target - pos) * k;
    if (Math.abs(target - pos) < 0.0006) pos = target;
    render();
    if (pos !== target) raf = requestAnimationFrame(tick);
    else { lastTs = 0; settle(); }
  }
  function kick() {
    if (!raf) { lastTs = 0; raf = requestAnimationFrame(tick); }
  }

  /* Какая карточка «текущая»: счётчик, точки, aria-current, кнопки */
  function syncUI() {
    var idx = idxOf(target);
    if (idx === shown) return;
    shown = idx;
    states.forEach(function (st, k) {
      st.item.classList.toggle('is-center', k === idx);
      if (k === idx) st.item.setAttribute('aria-current', 'true');
      else st.item.removeAttribute('aria-current');
      if (k === idx) dots[k].setAttribute('aria-current', 'true');
      else dots[k].removeAttribute('aria-current');
    });
    count.textContent = '';
    count.appendChild(el('b', null, pad(idx + 1)));
    count.appendChild(document.createTextNode(' / ' + pad(N)));
    btnPrev.disabled = idx === 0;
    btnNext.disabled = idx === N - 1;
  }
  function settle() {
    live.textContent = 'Мастер ' + (shown + 1) + ' из ' + N + ': ' + MASTERS[shown].name;
  }

  function setTarget(v) {
    target = clamp(Math.round(v), 0, N - 1);
    syncUI();
    kick();
  }

  /* ---------- Мышь, палец: pointer events ---------- */
  var drag = null;
  track.addEventListener('dragstart', function (e) { e.preventDefault(); });

  track.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, on: false, pos0: 0, x0: 0,
             samples: [{ t: e.timeStamp, x: e.clientX }] };
  });

  window.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) return;          // вертикальный жест — это прокрутка страницы
      drag.on = true;
      dragging = true;
      drag.pos0 = pos;                                   // подхватываем ряд там, где он сейчас
      drag.x0 = e.clientX;
      target = pos;
      track.classList.add('is-drag');
      try { track.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
    }
    var s = drag.samples;
    s.push({ t: e.timeStamp, x: e.clientX });
    while (s.length > 2 && e.timeStamp - s[0].t > 110) s.shift();
    target = clamp(drag.pos0 - (e.clientX - drag.x0) / geo.unit, -0.4, N - 0.6);
    kick();
  });

  function endPointer(e, canceled) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (!d.on) {
      /* обычный клик/тап: боковая карточка встаёт в центр */
      if (canceled) return;
      var item = e.target.closest ? e.target.closest('.tm-item') : null;
      var i = item ? states.map(function (s) { return s.item; }).indexOf(item) : -1;
      if (i !== -1 && i !== idxOf(target)) setTarget(i);
      return;
    }
    dragging = false;
    track.classList.remove('is-drag');
    var s = d.samples, from = s[0], to = s[s.length - 1];
    var v = 0;                                           // карточек в секунду
    if (!canceled && to.t - from.t > 8) v = -((to.x - from.x) / (to.t - from.t)) * 1000 / geo.unit;
    /* «Бросок»: спокойное движение (меньше ~2 карточек/с) — ровно на столько, на сколько довели;
       быстрое добавляет до 3 карточек. Считаем от цели target, а не от отстающей pos. */
    var bonus = reduced() ? 0 : Math.min(3, Math.max(0, Math.abs(v) - 2) * 0.15) * (v < 0 ? -1 : 1);
    var projected = target + bonus;
    setTarget(projected);
  }
  window.addEventListener('pointerup', function (e) { endPointer(e, false); });
  window.addEventListener('pointercancel', function (e) { endPointer(e, true); });

  /* ---------- Колесо и трекпад ---------- */
  var wheelTimer = 0, wheelBase = 0, wheelOn = false, wheelNotch = false;
  track.addEventListener('wheel', function (e) {
    var dx = e.deltaX, dy = e.deltaY;
    if (e.shiftKey && Math.abs(dx) < Math.abs(dy)) dx = dy;      // Shift + колесо
    else if (Math.abs(dx) <= Math.abs(dy)) return;                // вертикальное колесо листает страницу
    if (e.deltaMode === 1) dx *= 16;
    e.preventDefault();
    if (!wheelOn) { wheelOn = true; wheelBase = idxOf(target); wheelNotch = false; }
    if (Math.abs(dx) >= 50) wheelNotch = true;                    // крупный дискретный щелчок мыши (не трекпад)
    target = clamp(target + dx / 320, -0.4, N - 0.6);
    kick();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(function () {
      wheelOn = false;
      var delta = target - wheelBase;
      var t2 = Math.round(target);
      if (wheelNotch && Math.abs(delta) > 0.1 && Math.abs(delta) < 0.5) t2 = wheelBase + (delta > 0 ? 1 : -1);  // один щелчок колеса — одна карточка
      setTarget(t2);
    }, reduced() ? 80 : 140);
  }, { passive: false });

  /* ---------- Клавиатура, стрелки ---------- */
  stage.addEventListener('keydown', function (e) {
    var k = e.key, base = idxOf(target), i = null;
    if (k === 'ArrowLeft') i = base - 1;
    else if (k === 'ArrowRight') i = base + 1;
    else if (k === 'Home') i = 0;
    else if (k === 'End') i = N - 1;
    if (i === null) return;
    e.preventDefault();
    i = clamp(i, 0, N - 1);
    setTarget(i);
    if (e.target.classList && e.target.classList.contains('tm-item')) states[i].item.focus({ preventScroll: true });
  });
  track.addEventListener('focusin', function (e) {
    var item = e.target.closest ? e.target.closest('.tm-item') : null;
    var i = item ? states.map(function (s) { return s.item; }).indexOf(item) : -1;
    if (i !== -1 && i !== idxOf(target)) setTarget(i);
  });
  btnPrev.addEventListener('click', function () { setTarget(idxOf(target) - 1); });
  btnNext.addEventListener('click', function () { setTarget(idxOf(target) + 1); });

  /* ---------- Размеры: одинаковая высота по самой длинной раскрытой карточке ---------- */
  function measure() {
    computeGeo();
    var h = 0;
    states.forEach(function (st) { h = Math.max(h, st.inner.offsetHeight); });
    if (h) stage.style.setProperty('--mh', Math.ceil(h) + 'px');
    render();
  }
  var resizeRaf = 0;
  window.addEventListener('resize', function () {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(function () { resizeRaf = 0; measure(); });
  });

  /* ---------- Шрифты сайта: пересчитать высоту, когда они загрузятся ---------- */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  window.addEventListener('load', measure);

  /* ---------- Старт ---------- */
  measure();
  syncUI();
  settle();
})();
