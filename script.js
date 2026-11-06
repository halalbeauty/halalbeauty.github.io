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
     Листание — нативный scroll-snap (свайп работает и без скрипта);
     здесь только индикатор, стрелки для мыши и клавиши ← →. */
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  Array.prototype.forEach.call(document.querySelectorAll('.work'), function (card) {
    var track = card.querySelector('.work-track');
    var bars = card.querySelectorAll('.work-bars i');
    var prev = card.querySelector('.work-nav.prev');
    var next = card.querySelector('.work-nav.next');
    var count = bars.length;
    var current = -1;
    var queued = false;
    if (!track || count < 2) return;

    function update() {
      queued = false;
      var i = Math.round(track.scrollLeft / track.clientWidth);
      i = Math.max(0, Math.min(count - 1, i));
      if (i === current) return;
      current = i;
      Array.prototype.forEach.call(bars, function (bar, k) { bar.classList.toggle('on', k === i); });
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === count - 1;
    }

    function go(step) {
      var i = Math.max(0, Math.min(count - 1, current + step));
      track.scrollTo({ left: i * track.clientWidth, behavior: calm ? 'auto' : 'smooth' });
    }

    track.addEventListener('scroll', function () {
      if (!queued) { queued = true; window.requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', function () {
      track.scrollLeft = Math.max(0, current) * track.clientWidth;
    });
    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });
    track.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    });
    update();
  });
})();
