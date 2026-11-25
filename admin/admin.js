/* Админка сайта Halal Beauty: все разделы сайта.
 *
 * Вход — через GitHub (сервис входа в oauth/worker.js). Данные читаются и
 * записываются прямо в репозиторий (JSON в data/,
 * фото в photos/works/ и photos/news/) через GitHub API от имени вошедшего человека, поэтому
 * сохранить может только тот, у кого есть доступ на запись. После сохранения
 * workflow пересобирает index.html (render.py).
 *
 * На localhost админка открывается без входа и ничего не сохраняет — для проверки вёрстки.
 */
(function () {
  'use strict';

  var REPO = 'halalbeauty/halalbeauty.github.io';
  var BRANCH = 'main';
  var FILE = 'data/services.json';
  var WORKS_FILE = 'data/works.json';
  var NEWS_FILE = 'data/news.json';
  var PHOTO_DIR = 'photos/works/';
  var NEWS_DIR = 'photos/news/';
  var MAX_SIDE = 1600;     // длинная сторона фото после сжатия, px
  var JPEG_QUALITY = 0.82;
  var AUTH = 'https://halalbeauty-auth.kazakhbaimeyrzhan.workers.dev';
  var TOKEN_KEY = 'hb_admin_token';
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  var token = null;
  var data = null;
  var sha = null;
  var works = null;        // { blocks: [{ id, title, hidden?, photos: [путь] }] }
  var worksSha = null;     // null — файла в репозитории ещё нет
  var savedPhotos = [];    // фото, которые сейчас лежат в репозитории и привязаны к блокам
  var pending = {};        // путь → { blob, url, done }: загруженные в админке, но ещё не отправленные фото
  var news = null;         // { items: [{ id, type, title, text, photo, price, old, from, to, hidden? }] }
  var newsSha = null;
  var savedNewsPhotos = [];

  /* Разделы «форма + список». f: [ключ, подпись, вид, подсказка]; вид: text, area, date, select, url.
     У обязательных полей подпись со звёздочкой. */
  var SEC = {
    masters: {
      what: 'Мастера', empty: { items: [] }, photoDir: 'photos/masters/',
      hint: 'Карточки в разделе «Наши мастера». Фото лучше квадратное, лицо по центру: на сайте оно в круге.',
      add: '+ Добавить мастера', title: ['name', 'Имя'], one: 'мастера',
      f: [['role', 'Специальности через запятую *', 'text', 'Hair stylist, Lamimaker'], ['exp', 'Опыт', 'text', '5 лет опыта'],
        ['about', 'О мастере', 'area', 'Два-три коротких предложения']]
    },
    training: {
      what: 'Обучение', empty: { title: '', lead: '', items: [] },
      hint: 'Раздел «Обучение». Кнопка «Записаться» у курса сама подставит его название в WhatsApp.',
      top: [['title', 'Заголовок раздела *', 'text'], ['lead', 'Описание раздела', 'area']],
      add: '+ Добавить курс', title: ['name', 'Название курса'], one: 'курса',
      f: [['code', 'Короткое имя', 'text', 'Start'], ['badge', 'Метка', 'text', 'Рекомендуем'],
        ['style', 'Оформление', 'select', [['', 'Обычное'], ['hot', 'Выделенное'], ['max', 'Расширенное']]],
        ['price', 'Цена', 'text', '49 000 ₸'], ['priceNote', 'Пояснение к цене', 'text', 'мини-группа до 3 учениц'],
        ['solo', 'Цена индивидуально', 'text', '75 000 ₸'], ['time', 'Длительность', 'text', '1 день, 4 часа'],
        ['practice', 'Практика', 'text', '2 модели лично каждой ученице'],
        ['incl', 'Что входит: каждый пункт с новой строки', 'area'],
        ['program', 'Программа: каждый пункт с новой строки, заголовок начинается с #', 'area'],
        ['note', 'Примечание', 'area']]
    },
    reviews: {
      what: 'Отзывы', empty: { rating: '', count: '', items: [] }, first: true,
      hint: 'На сайте видны отзывы с оценкой от 4,5 — девять самых свежих. Копируйте настоящие отзывы из 2ГИС без изменений.',
      top: [['rating', 'Рейтинг в 2ГИС *', 'text', '4,9'], ['count', 'Всего отзывов в 2ГИС *', 'text', '1716']],
      add: '+ Добавить отзыв', title: ['name', 'Имя автора'], one: 'отзыва',
      f: [['text', 'Текст отзыва *', 'area'],
        ['rating', 'Оценка', 'select', [['5', '5'], ['4.5', '4,5'], ['4', '4'], ['3', '3'], ['2', '2'], ['1', '1']]],
        ['date', 'Дата отзыва *', 'date'], ['service', 'Услуга', 'text', 'маникюр']]
    },
    contacts: {
      what: 'Контакты', empty: { items: [] },
      hint: 'Меняются сразу везде: первый экран, контакты, подвал и кнопки записи. Пустые необязательные поля на сайте не видны.',
      top: [['city', 'Город *', 'text'], ['street', 'Улица и дом, без «ул.» *', 'text'], ['place', 'Здание, этаж', 'text'], ['district', 'Район, индекс', 'text'],
        ['days', 'Дни работы *', 'text', 'Ежедневно'], ['open', 'Открытие *', 'text', '09:00'], ['close', 'Закрытие *', 'text', '20:00'],
        ['phone', 'Телефон *', 'text'], ['phone2', 'Второй телефон', 'text'], ['whatsapp', 'Номер WhatsApp *', 'text'],
        ['booking', 'Ссылка онлайн-записи', 'url'], ['instagram', 'Instagram', 'url'], ['tiktok', 'TikTok', 'url'],
        ['gis', 'Карточка в 2ГИС', 'url'], ['gisReviews', 'Отзывы в 2ГИС *', 'url']],
      listTitle: 'Частые вопросы', add: '+ Добавить вопрос', title: ['q', 'Вопрос'], one: 'вопроса',
      f: [['a', 'Ответ *', 'area']]
    }
  };
  var SECS = Object.keys(SEC);
  SECS.forEach(function (k) { var s = SEC[k]; s.key = k; s.file = 'data/' + k + '.json'; s.data = null; s.sha = null; s.dirty = false; s.saved = []; });

  var view = 'news';
  var priceDirty = false;
  var worksDirty = false;
  var newsDirty = false;
  var dirty = false;       // есть что сохранять хотя бы в одном разделе
  var saving = false;
  var active = 0;
  var openRows = new WeakSet();

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Мелочи ---------- */

  function h(tag, props) {
    var el = document.createElement(tag);
    var kids = Array.prototype.slice.call(arguments, 2);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    kids.forEach(function (c) {
      if (c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { /* приватный режим: просто не запоминаем */ }
  }
  function recall(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  var toastTimer;
  function toast(text, isErr) {
    var t = $('toast');
    t.textContent = text;
    t.className = 'adm-toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 7000 : 4500);
  }

  function show(name) {
    ['login', 'loading', 'denied', 'editor'].forEach(function (s) {
      $('screen-' + s).hidden = s !== name;
    });
    $('bar-actions').hidden = name === 'login' || name === 'loading';
    $('savebar').hidden = name !== 'editor';
  }

  function refreshDirty() {
    dirty = priceDirty || worksDirty || newsDirty || SECS.some(function (k) { return SEC[k].dirty; });
    var st = $('save-status');
    st.textContent = dirty ? 'Есть несохранённые изменения' : 'Нет изменений';
    st.className = 'adm-save-status' + (dirty ? ' dirty' : '');
    $('save').disabled = !dirty || saving;
    Array.prototype.forEach.call($('views').children, function (b) {
      var v = b.getAttribute('data-view');
      b.classList.toggle('dirty', SEC[v] ? SEC[v].dirty : { price: priceDirty, works: worksDirty, news: newsDirty }[v]);
    });
  }

  function setDirty(v) { priceDirty = v; refreshDirty(); }
  function setWorksDirty(v) { worksDirty = v; refreshDirty(); }

  function setNewsDirty(v) { newsDirty = v; refreshDirty(); }

  function touch() { if (!priceDirty) setDirty(true); }
  function touchWorks() { if (!worksDirty) setWorksDirty(true); }

  function touchNews() { if (!newsDirty) setNewsDirty(true); }

  function setView(v) {
    view = v;
    $('view-price').hidden = v !== 'price';
    $('view-works').hidden = v !== 'works';
    $('view-news').hidden = v !== 'news';
    SECS.forEach(function (k) { $('view-' + k).hidden = v !== k; });
    Array.prototype.forEach.call($('views').children, function (b) {
      var on = b.getAttribute('data-view') === v;
      b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
  }

  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- GitHub ---------- */

  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function gh(path, opts) {
    opts = opts || {};
    return fetch('https://api.github.com' + path, {
      method: opts.method || 'GET',
      body: opts.body,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token
      }
    }).then(function (r) {
      if (r.status === 401) {
        logout();
        throw new Error('Сессия закончилась — войдите заново.');
      }
      if (r.ok) return r.json();
      return r.json().catch(function () { return {}; }).then(function (j) {
        var err = new Error(j.message || ('Ошибка ' + r.status));
        err.status = r.status;
        throw err;
      });
    });
  }

  /* ---------- Вход / выход ---------- */

  function logout() {
    token = null;
    data = null;
    works = null;
    news = null;
    SECS.forEach(function (k) { SEC[k].data = null; SEC[k].dirty = false; });
    pending = {};
    store(TOKEN_KEY, null);
    priceDirty = false;
    worksDirty = false;
    newsDirty = false;
    refreshDirty();
    show('login');
  }

  function login() {
    $('login-error').hidden = true;
    var popup = window.open(AUTH + '/auth', 'hb-login', 'width=620,height=760');
    if (!popup) {
      $('login-error').textContent = 'Браузер заблокировал окно входа. Разрешите всплывающие окна для этого сайта.';
      $('login-error').hidden = false;
      return;
    }
    function onMessage(e) {
      if (e.origin !== AUTH) return;
      if (e.data === 'authorizing:github') {
        e.source.postMessage('authorizing:github', AUTH);
        return;
      }
      var m = /^authorization:github:(success|error):([\s\S]*)$/.exec(String(e.data));
      if (!m) return;
      window.removeEventListener('message', onMessage);
      var payload = {};
      try { payload = JSON.parse(m[2]); } catch (err) { /* пусто */ }
      if (m[1] === 'success' && payload.token) {
        token = payload.token;
        store(TOKEN_KEY, token);
        start();
      } else {
        $('login-error').textContent = 'Не удалось войти: ' + (payload.message || 'неизвестная ошибка');
        $('login-error').hidden = false;
      }
    }
    window.addEventListener('message', onMessage);
  }

  /* ---------- Загрузка ---------- */

  function afterLoad() {
    active = Math.min(active, data.tabs.length - 1);
    savedPhotos = allPhotos(works);
    priceDirty = false;
    savedNewsPhotos = newsPhotos(news);
    SECS.forEach(function (k) { SEC[k].dirty = false; SEC[k].saved = newsPhotos(SEC[k].data); });
    worksDirty = false;
    newsDirty = false;
    refreshDirty();
    show('editor');
    render();
    renderWorks();
    renderNews();
    SECS.forEach(function (k) { renderSec(SEC[k]); });
  }

  function start() {
    show('loading');
    $('loading-text').textContent = 'Загружаем данные…';

    if (LOCAL) {
      var json = function (file, fallback) {
        return fetch('../' + file).then(function (r) { return r.json(); }).catch(function () { return fallback; });
      };
      Promise.all([json(FILE), json(WORKS_FILE, { blocks: [] }), json(NEWS_FILE, { items: [] })].concat(SECS.map(function (k) {
        return json(SEC[k].file, SEC[k].empty);
      }))).then(function (r) {
        data = r[0];
        works = r[1];
        news = r[2];
        SECS.forEach(function (k, i) { SEC[k].data = r[3 + i]; });
        active = 0;
        afterLoad();
      });
      return;
    }

    gh('/repos/' + REPO).then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) {
        show('denied');
        return null;
      }
      var price = gh('/repos/' + REPO + '/contents/' + FILE + '?ref=' + BRANCH);
      // works.json и news.json могут ещё не существовать — тогда начинаем с пустого списка
      var optional = function (file) {
        return gh('/repos/' + REPO + '/contents/' + file + '?ref=' + BRANCH).catch(function (err) {
          if (err.status === 404) return null;
          throw err;
        });
      };
      return Promise.all([price, optional(WORKS_FILE), optional(NEWS_FILE)].concat(SECS.map(function (k) {
        return optional(SEC[k].file);
      }))).then(function (r) {
        sha = r[0].sha;
        data = JSON.parse(b64ToUtf8(r[0].content));
        worksSha = r[1] ? r[1].sha : null;
        works = r[1] ? JSON.parse(b64ToUtf8(r[1].content)) : { blocks: [] };
        if (!works.blocks) works.blocks = [];
        newsSha = r[2] ? r[2].sha : null;
        news = r[2] ? JSON.parse(b64ToUtf8(r[2].content)) : { items: [] };
        if (!news.items) news.items = [];
        SECS.forEach(function (k, i) {
          var f = r[3 + i];
          SEC[k].sha = f ? f.sha : null;
          SEC[k].data = f ? JSON.parse(b64ToUtf8(f.content)) : JSON.parse(JSON.stringify(SEC[k].empty));
          if (!SEC[k].data.items) SEC[k].data.items = [];
        });
        afterLoad();
      });
    }).catch(function (err) {
      if (!token) return;
      if (err.status === 404) {
        show('denied');
        return;
      }
      show('loading');
      $('loading-text').textContent = 'Не получилось загрузить данные: ' + err.message;
    });
  }

  /* ---------- Сохранение ---------- */

  function clean() {
    var problems = [];
    var out = { tabs: data.tabs.map(function (t) {
      return {
        id: t.id,
        title: t.title.trim(),
        groups: t.groups.map(function (g) {
          var group = { title: g.title.trim() };
          if (g.split) group.split = true;
          group.rows = g.rows.map(function (r) {
            var row = { name: r.name.trim() };
            if (r.note && r.note.trim()) row.note = r.note.trim();
            if (r.meta && r.meta.trim()) row.meta = r.meta.trim();
            if (r.incl && r.incl.length) {
              row.incl = r.incl.map(function (i) {
                var item = { text: i.text };
                if (i.stage) item.stage = true;
                return item;
              });
            }
            row.price = r.price.trim();
            return row;
          });
          return group;
        })
      };
    }) };
    out.tabs.forEach(function (t) {
      if (!t.title) problems.push('у одной из категорий нет названия');
      t.groups.forEach(function (g) {
        if (!g.title) problems.push('в категории «' + t.title + '» у блока нет заголовка');
        g.rows.forEach(function (r) {
          if (!r.name) problems.push('в «' + g.title + '» есть услуга без названия');
          else if (!r.price) problems.push('у услуги «' + r.name + '» не указана цена');
        });
      });
    });
    return { out: out, problems: problems };
  }

  function cleanWorks() {
    var problems = [];
    var out = { blocks: works.blocks.map(function (b) {
      var block = { id: b.id, title: b.title.trim() };
      if (b.hidden) block.hidden = true;
      block.photos = b.photos.slice();
      return block;
    }) };
    out.blocks.forEach(function (b) {
      if (!b.title) problems.push('у одного из блоков в «Наших работах» нет названия');
      else if (!b.photos.length && !b.hidden) {
        problems.push('в блоке «' + b.title + '» нет фото — добавьте фото или уберите галочку «Показывать»');
      }
    });
    return { out: out, problems: problems };
  }

  function cleanNews() {
    var problems = [];
    var out = { items: news.items.map(function (n) {
      var item = { id: n.id, type: n.type, title: (n.title || '').trim() };
      ['text', 'price', 'old', 'photo', 'from', 'to'].forEach(function (k) {
        var v = (n[k] || '').trim();
        if (v && !((k === 'price' || k === 'old') && n.type !== 'promo')) item[k] = v;
      });
      if (n.hidden) item.hidden = true;
      return item;
    }) };
    out.items.forEach(function (n) {
      if (!n.title) problems.push('у записи в «Важном» нет заголовка');
      else if (n.from && n.to && n.to < n.from) problems.push('у записи «' + n.title + '» последняя дата раньше первой');
    });
    return { out: out, problems: problems };
  }

  function trimmed(o) {
    var out = {};
    Object.keys(o).forEach(function (k) {
      if (k === 'items') return;
      if (typeof o[k] === 'string') out[k] = o[k].trim();
      else if (o[k]) out[k] = o[k];
    });
    return out;
  }

  function cleanSec(s) {
    var problems = [];
    var check = function (fields, o, where) {
      fields.forEach(function (f) {
        var v = o[f[0]] || '';
        var name = f[1].replace(' *', '').split(':')[0];
        if (/\*$/.test(f[1]) && !v) problems.push(where + ' не заполнено «' + name + '»');
        else if (f[2] === 'url' && v && !/^https?:\/\/\S+$/.test(v)) problems.push(where + ' ссылка «' + name + '» должна начинаться с https://');
        else if (/^(phone2?|whatsapp)$/.test(f[0]) && v && v.replace(/\D/g, '').length !== 11) problems.push(where + ' в «' + name + '» должно быть 11 цифр');
        else if (/^(open|close)$/.test(f[0]) && v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) problems.push(where + ' «' + name + '» пишется как 09:00');
      });
    };
    var out = trimmed(s.data);
    if (s.key === 'reviews') {
      out.rating = (out.rating || '').replace('.', ',');
      if (out.rating && !/^([1-4](,\d)?|5(,0)?)$/.test(out.rating)) problems.push('рейтинг пишется как 4,9');
      if (out.count && !/^\d+$/.test(out.count)) problems.push('число отзывов пишется цифрами');
    }
    check(s.top || [], out, 'в разделе «' + s.what + '»');
    out.items = s.data.items.map(trimmed);
    out.items.forEach(function (i) {
      var t = i[s.title[0]];
      if (!t) problems.push('в разделе «' + s.what + '» есть запись, где не заполнено «' + s.title[1] + '»');
      else check(s.f, i, 'у «' + t + '»');
    });
    return { out: out, problems: problems };
  }

  function saveSec(s, out) {
    var used = newsPhotos(out);
    return saveWithPhotos(s.what, s.file, s.sha, out, used, s.saved, function (newSha) {
      s.sha = newSha;
      s.data = out;
      s.saved = used;
      s.dirty = false;
      refreshDirty();
      renderSec(s);
    });
  }

  function newsPhotos(n) {
    return n.items.map(function (i) { return i.photo; }).filter(function (p, i, all) {
      return p && all.indexOf(p) === i;
    });
  }

  function allPhotos(w) {
    return w.blocks.reduce(function (all, b) { return all.concat(b.photos); }, []);
  }

  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1]); };
      r.onerror = function () { reject(new Error('не удалось прочитать фото')); };
      r.readAsDataURL(blob);
    });
  }

  // Подряд идущие коммиты в одну ветку изредка получают 409 — повторяем один раз
  function retry409(fn) {
    return fn().catch(function (err) {
      if (err.status !== 409) throw err;
      return new Promise(function (r) { setTimeout(r, 900); }).then(fn);
    });
  }

  function setBusy(text) { $('save').textContent = text; }

  function savePrice(out) {
    return retry409(function () {
      return gh('/repos/' + REPO + '/contents/' + FILE, {
        method: 'PUT',
        body: JSON.stringify({
          message: 'Прайс: правки через админку',
          content: utf8ToB64(JSON.stringify(out, null, 2) + '\n'),
          sha: sha,
          branch: BRANCH
        })
      });
    }).then(function (res) {
      sha = res.content.sha;
      data = out;
      setDirty(false);
      render();
    });
  }

  function deleteFile(path, what) {
    // Лишний файл в репозитории — не беда, поэтому ошибки здесь не показываем
    return gh('/repos/' + REPO + '/contents/' + path + '?ref=' + BRANCH).then(function (f) {
      return gh('/repos/' + REPO + '/contents/' + path, {
        method: 'DELETE',
        body: JSON.stringify({ message: what + ': удалено фото', sha: f.sha, branch: BRANCH })
      });
    }).catch(function () { /* пусто */ });
  }

  // Общее для разделов с фото: what — «Работы»/«Важное», onSaved(sha) вызывается после записи JSON
  function saveWithPhotos(what, file, fileSha, out, used, before, onSaved) {
    var todo = used.filter(function (p) { return pending[p] && !pending[p].done; });
    var n = 0;
    var chain = Promise.resolve();

    // 1. Фото. Файлы, на которые пока никто не ссылается, сайту не мешают
    todo.forEach(function (path) {
      chain = chain.then(function () {
        setBusy('Загружаем фото ' + (++n) + ' из ' + todo.length + '…');
        return blobToB64(pending[path].blob).then(function (b64) {
          return retry409(function () {
            return gh('/repos/' + REPO + '/contents/' + path, {
              method: 'PUT',
              body: JSON.stringify({ message: what + ': новое фото', content: b64, branch: BRANCH })
            });
          });
        }).then(function () { pending[path].done = true; });
      });
    });

    // 2. JSON — после него сайт пересоберётся
    chain = chain.then(function () {
      setBusy('Сохраняем…');
      var body = {
        message: what + ': правки через админку',
        content: utf8ToB64(JSON.stringify(out, null, 2) + '\n'),
        branch: BRANCH
      };
      if (fileSha) body.sha = fileSha;
      return retry409(function () {
        return gh('/repos/' + REPO + '/contents/' + file, { method: 'PUT', body: JSON.stringify(body) });
      });
    }).then(function (res) {
      var gone = before.filter(function (p) { return used.indexOf(p) < 0; });
      onSaved(res.content.sha);

      // 3. Убираем из репозитория фото, на которые больше никто не ссылается
      var del = Promise.resolve();
      gone.forEach(function (p) {
        del = del.then(function () { setBusy('Убираем старые фото…'); return deleteFile(p, what); });
      });
      return del;
    });
    return chain;
  }

  function saveWorks(out) {
    var used = allPhotos(out);
    return saveWithPhotos('Работы', WORKS_FILE, worksSha, out, used, savedPhotos, function (newSha) {
      worksSha = newSha;
      works = out;
      savedPhotos = used;
      setWorksDirty(false);
      renderWorks();
    });
  }

  function saveNews(out) {
    var used = newsPhotos(out);
    return saveWithPhotos('Важное', NEWS_FILE, newsSha, out, used, savedNewsPhotos, function (newSha) {
      newsSha = newSha;
      news = out;
      savedNewsPhotos = used;
      setNewsDirty(false);
      renderNews();
    });
  }

  function save() {
    if (saving || !dirty) return;
    var c = priceDirty ? clean() : null;
    var w = worksDirty ? cleanWorks() : null;
    var n = newsDirty ? cleanNews() : null;
    var secs = SECS.filter(function (k) { return SEC[k].dirty; }).map(function (k) {
      var r = cleanSec(SEC[k]);
      r.sec = SEC[k];
      return r;
    });
    var badSec = secs.filter(function (r) { return r.problems.length; })[0];
    var problems = (n ? n.problems : []).concat(c ? c.problems : [], w ? w.problems : []);
    secs.forEach(function (r) { problems = problems.concat(r.problems); });
    if (problems.length) {
      toast('Заполните: ' + problems[0] + (problems.length > 1 ? ' (и ещё ' + (problems.length - 1) + ')' : ''), true);
      setView(n && n.problems.length ? 'news' : c && c.problems.length ? 'price' : w && w.problems.length ? 'works' : badSec.sec.key);
      markEmpty();
      return;
    }
    if (LOCAL) {
      if (c) window.hbLocalSave = JSON.stringify(c.out, null, 2) + '\n';
      secs.forEach(function (r) { (window.hbLocalSec = window.hbLocalSec || {})[r.sec.key] = r.out; });
      if (n) window.hbLocalNews = JSON.stringify(n.out, null, 2) + '\n';
      if (w) window.hbLocalWorks = JSON.stringify(w.out, null, 2) + '\n';
      toast('Локальная проверка: ничего не отправлено', false);
      return;
    }
    saving = true;
    $('save').disabled = true;
    setBusy('Сохраняем…');
    var chain = Promise.resolve();
    if (n) chain = chain.then(function () { return saveNews(n.out); });
    if (c) chain = chain.then(function () { return savePrice(c.out); });
    if (w) chain = chain.then(function () { return saveWorks(w.out); });
    secs.forEach(function (r) { chain = chain.then(function () { return saveSec(r.sec, r.out); }); });
    chain.then(function () {
      saving = false;
      setBusy('Сохранить');
      refreshDirty();
      toast('Сохранено. На сайте изменения появятся через 1–2 минуты.');
    }).catch(function (err) {
      saving = false;
      setBusy('Сохранить');
      refreshDirty();
      if (err.status === 409 || err.status === 422) {
        toast('Данные уже изменили в другом месте. Скопируйте свои правки, обновите страницу и внесите их заново.', true);
      } else if (err.status === 403 || err.status === 404) {
        toast('Нет прав на сохранение (' + err.message + ')', true);
      } else {
        toast('Не сохранилось: ' + err.message, true);
      }
    });
  }

  function markEmpty() {
    Array.prototype.forEach.call(document.querySelectorAll('.adm [data-req]'), function (el) {
      el.classList.toggle('bad', !el.value.trim());
    });
    var first = document.querySelector('.adm .bad');
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ---------- Правки данных ---------- */

  function move(arr, i, d) {
    var j = i + d;
    if (j < 0 || j >= arr.length) return false;
    var x = arr[i]; arr[i] = arr[j]; arr[j] = x;
    return true;
  }

  function newId() { return 'cat-' + Date.now().toString(36); }

  function inclToText(incl) {
    return (incl || []).map(function (i) { return (i.stage ? '# ' : '') + i.text; }).join('\n');
  }
  function textToIncl(text) {
    return text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
      return /^#\s*/.test(l) ? { text: l.replace(/^#\s*/, ''), stage: true } : { text: l };
    });
  }

  /* ---------- Отрисовка ---------- */

  // Поле, которое пишет в объект без перерисовки (чтобы не терять курсор)
  function field(obj, key, opts) {
    opts = opts || {};
    var input = h('input', {
      type: 'text',
      class: opts.class || '',
      value: obj[key] || '',
      placeholder: opts.placeholder || '',
      'aria-label': opts.label || opts.placeholder || '',
      autocomplete: 'off',
      'data-req': opts.required ? '1' : null,
      oninput: function () {
        obj[key] = input.value;
        if (opts.required) input.classList.toggle('bad', !input.value.trim());
        (opts.touch || touch)();
      }
    });
    return input;
  }

  function iconBtn(sym, label, onClick, extra) {
    return h('button', { type: 'button', class: 'adm-ico' + (extra ? ' ' + extra : ''), title: label, 'aria-label': label, onclick: onClick }, sym);
  }

  function renderTabs() {
    var tabs = $('tabs');
    tabs.textContent = '';
    data.tabs.forEach(function (t, i) {
      tabs.appendChild(h('button', {
        type: 'button', role: 'tab',
        'aria-selected': String(i === active),
        onclick: function () { active = i; render(); }
      }, t.title || 'Без названия'));
    });
  }

  function renderTabTools(tab) {
    var box = $('tab-tools');
    box.textContent = '';
    box.className = 'adm-tab-tools';
    box.appendChild(h('span', { class: 'adm-muted', text: 'Название вкладки:' }));
    var title = field(tab, 'title', { class: 'adm-field', label: 'Название вкладки', required: true });
    title.addEventListener('input', function () {
      var btn = $('tabs').children[active];
      if (btn) btn.textContent = tab.title || 'Без названия';
    });
    box.appendChild(title);
    box.appendChild(iconBtn('←', 'Сдвинуть влево', function () {
      if (move(data.tabs, active, -1)) { active -= 1; touch(); render(); }
    }));
    box.appendChild(iconBtn('→', 'Сдвинуть вправо', function () {
      if (move(data.tabs, active, 1)) { active += 1; touch(); render(); }
    }));
    box.appendChild(iconBtn('×', 'Удалить категорию', function () {
      var n = tab.groups.reduce(function (s, g) { return s + g.rows.length; }, 0);
      if (data.tabs.length < 2) { toast('Нельзя удалить последнюю категорию.', true); return; }
      if (!confirm('Удалить категорию «' + (tab.title || 'без названия') + '» вместе со всеми услугами (' + n + ')?')) return;
      data.tabs.splice(active, 1);
      active = Math.max(0, active - 1);
      touch();
      render();
    }, 'danger'));
  }

  function renderRow(group, row, i) {
    var open = openRows.has(row);
    var hasMore = !!(row.note || row.meta || (row.incl && row.incl.length));
    var el = h('li', { class: 'adm-row' });

    var nameWrap = h('div', { class: 'f-name' }, field(row, 'name', { placeholder: 'Название услуги', required: true }));
    var price = field(row, 'price', { class: 'f-price', placeholder: 'Цена', label: 'Цена', required: true });

    var more = h('button', {
      type: 'button',
      class: 'adm-ico',
      'aria-pressed': String(open),
      title: 'Пояснение, длительность, состав',
      'aria-label': 'Пояснение, длительность, состав',
      onclick: function () {
        if (openRows.has(row)) openRows.delete(row); else openRows.add(row);
        render();
      }
    }, hasMore ? '✎' : '⋯');

    var actions = h('div', { class: 'adm-ico-row' },
      more,
      iconBtn('↑', 'Выше', function () { if (move(group.rows, i, -1)) { touch(); render(); } }),
      iconBtn('↓', 'Ниже', function () { if (move(group.rows, i, 1)) { touch(); render(); } }),
      iconBtn('×', 'Удалить услугу', function () { group.rows.splice(i, 1); touch(); render(); }, 'danger')
    );

    el.appendChild(nameWrap);
    el.appendChild(price);
    el.appendChild(actions);

    if (open) {
      var ta = h('textarea', {
        rows: '6',
        placeholder: 'Один пункт на строку',
        value: inclToText(row.incl),
        oninput: function () {
          var list = textToIncl(ta.value);
          if (list.length) row.incl = list; else delete row.incl;
          touch();
        }
      });
      el.appendChild(h('div', { class: 'adm-details' },
        h('label', null, 'Пояснение под названием', field(row, 'note', { placeholder: 'Например: Массаж горячими камнями, 60 минут' })),
        h('label', null, 'Длительность / на сколько человек', field(row, 'meta', { placeholder: 'Например: 2 ч · на 2 человека' })),
        h('label', null, 'Состав комплекса',
          ta,
          h('small', null, 'Строка, которая начинается с «# », станет заголовком этапа (например, «# Этап 1»).'))
      ));
    }
    return el;
  }

  function renderGroup(tab, group, gi) {
    var head = h('div', { class: 'adm-group-head' },
      field(group, 'title', { class: 'adm-field-title', placeholder: 'Заголовок блока', label: 'Заголовок блока', required: true }),
      h('div', { class: 'adm-ico-row' },
        h('label', { class: 'adm-wide', title: 'На сайте блок занимает всю ширину, услуги идут в две колонки' },
          h('input', {
            type: 'checkbox',
            checked: group.split ? true : null,
            onchange: function (e) { group.split = e.target.checked; touch(); render(); }
          }), 'Во всю ширину'),
        iconBtn('↑', 'Блок выше', function () { if (move(tab.groups, gi, -1)) { touch(); render(); } }),
        iconBtn('↓', 'Блок ниже', function () { if (move(tab.groups, gi, 1)) { touch(); render(); } }),
        iconBtn('×', 'Удалить блок', function () {
          if (group.rows.length && !confirm('Удалить блок «' + (group.title || 'без названия') + '» и все услуги в нём (' + group.rows.length + ')?')) return;
          tab.groups.splice(gi, 1); touch(); render();
        }, 'danger')
      )
    );

    var list = h('ul', { class: 'adm-list' });
    group.rows.forEach(function (row, i) { list.appendChild(renderRow(group, row, i)); });

    return h('div', { class: 'menu-group' + (group.split ? ' split' : '') },
      head,
      list,
      h('button', {
        type: 'button', class: 'adm-add',
        onclick: function () {
          group.rows.push({ name: '', price: '' });
          touch();
          render();
          // фокус на название только что добавленной услуги
          var mine = document.querySelectorAll('.adm-list')[gi];
          var f = mine && mine.lastElementChild && mine.lastElementChild.querySelector('input');
          if (f) f.focus();
        }
      }, '+ Добавить услугу')
    );
  }

  function render() {
    var tab = data.tabs[active];
    renderTabs();
    renderTabTools(tab);
    var panel = $('panel');
    panel.textContent = '';
    tab.groups.forEach(function (g, gi) { panel.appendChild(renderGroup(tab, g, gi)); });
    panel.appendChild(h('button', {
      type: 'button', class: 'adm-add adm-add-group',
      onclick: function () {
        tab.groups.push({ title: '', rows: [{ name: '', price: '' }] });
        touch();
        render();
        var heads = document.querySelectorAll('.adm-group-head input');
        if (heads.length) heads[heads.length - 1].focus();
      }
    }, '+ Добавить блок'));
  }

  /* ---------- Наши работы ---------- */

  function newName() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('не открывается')); };
      img.src = url;
    });
  }

  // Сжимаем в браузере: телефонное фото на 5–10 МБ не должно попасть на сайт как есть
  function prepare(file) {
    var decoded = window.createImageBitmap
      ? createImageBitmap(file).catch(function () { return decodeViaImg(file); })
      : decodeViaImg(file);
    return decoded.then(function (img) {
      var w = img.naturalWidth || img.width;
      var hgt = img.naturalHeight || img.height;
      var k = Math.min(1, MAX_SIDE / Math.max(w, hgt));
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * k));
      cv.height = Math.max(1, Math.round(hgt * k));
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; // у PNG с прозрачностью фон иначе станет чёрным
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      if (img.close) img.close();
      return new Promise(function (resolve, reject) {
        cv.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('не сжимается'));
        }, 'image/jpeg', JPEG_QUALITY);
      });
    });
  }

  function previewUrl(src) {
    return pending[src] ? pending[src].url : '../' + src;
  }

  // Фото, которое ни разу не отправляли в репозиторий, просто забываем
  function forget(src) {
    var p = pending[src];
    if (p && !p.done) {
      URL.revokeObjectURL(p.url);
      delete pending[src];
    }
  }

  function addPhotos(block, files) {
    var failed = [];
    var added = 0;
    var chain = Promise.resolve();
    toast('Обрабатываем фото…');
    files.forEach(function (file) {
      chain = chain.then(function () {
        return prepare(file).then(function (blob) {
          var path = PHOTO_DIR + newName() + '.jpg';
          pending[path] = { blob: blob, url: URL.createObjectURL(blob), done: false };
          block.photos.push(path);
          added++;
        }, function () { failed.push(file.name); });
      });
    });
    chain.then(function () {
      if (added) touchWorks();
      renderWorks();
      if (failed.length) {
        toast('Не удалось открыть: ' + failed.join(', ') + '. Подойдут JPG, PNG и WebP.', true);
      } else {
        $('toast').hidden = true;
      }
    });
  }

  function renderPhoto(block, src, i) {
    var last = block.photos.length - 1;
    return h('li', { class: 'adm-photo' },
      h('img', { src: previewUrl(src), alt: 'Фото ' + (i + 1), loading: 'lazy', draggable: 'false' }),
      i === 0 && last > 0 ? h('span', { class: 'adm-photo-tag', text: 'Обложка' }) : null,
      h('div', { class: 'adm-photo-tools' },
        iconBtn('←', 'Сдвинуть влево', function () { if (move(block.photos, i, -1)) { touchWorks(); renderWorks(); } }),
        iconBtn('→', 'Сдвинуть вправо', function () { if (move(block.photos, i, 1)) { touchWorks(); renderWorks(); } }),
        iconBtn('×', 'Убрать фото', function () {
          forget(src);
          block.photos.splice(i, 1);
          touchWorks();
          renderWorks();
        }, 'danger')
      )
    );
  }

  function renderBlock(block, bi) {
    var head = h('div', { class: 'adm-group-head' },
      field(block, 'title', {
        class: 'adm-field-title', placeholder: 'Название блока, например «Маникюр»',
        label: 'Название блока', required: true, touch: touchWorks
      }),
      h('div', { class: 'adm-ico-row' },
        h('label', { class: 'adm-wide', title: 'Скрытый блок остаётся в админке, но не показывается на сайте' },
          h('input', {
            type: 'checkbox',
            checked: block.hidden ? null : true,
            onchange: function (e) { block.hidden = !e.target.checked; touchWorks(); renderWorks(); }
          }), 'Показывать'),
        iconBtn('↑', 'Блок выше', function () { if (move(works.blocks, bi, -1)) { touchWorks(); renderWorks(); } }),
        iconBtn('↓', 'Блок ниже', function () { if (move(works.blocks, bi, 1)) { touchWorks(); renderWorks(); } }),
        iconBtn('×', 'Удалить блок', function () {
          var n = block.photos.length;
          if (!confirm('Удалить блок «' + (block.title.trim() || 'без названия') + '»' + (n ? ' вместе с фото (' + n + ')' : '') + '?')) return;
          block.photos.forEach(forget);
          works.blocks.splice(bi, 1);
          touchWorks();
          renderWorks();
        }, 'danger')
      )
    );

    var strip = h('ul', { class: 'adm-photos' });
    block.photos.forEach(function (src, i) { strip.appendChild(renderPhoto(block, src, i)); });
    var input = h('input', {
      type: 'file', accept: 'image/*', multiple: true, class: 'adm-file',
      onchange: function () {
        var files = Array.prototype.slice.call(input.files);
        input.value = '';
        if (files.length) addPhotos(block, files);
      }
    });
    strip.appendChild(h('li', { class: 'adm-photo-add' },
      h('label', null, block.photos.length ? '+ Ещё фото' : '+ Добавить фото', input)));

    return h('div', { class: 'menu-group adm-block' + (block.hidden ? ' is-hidden' : '') },
      head,
      block.hidden ? h('p', { class: 'adm-muted adm-hidden-note', text: 'Скрыт — на сайте не виден.' }) : null,
      strip
    );
  }

  function renderWorks() {
    var box = $('works-list');
    box.textContent = '';
    if (!works.blocks.length) {
      box.appendChild(h('p', { class: 'adm-muted adm-empty', text: 'Пока нет ни одного блока. Добавьте первый, например «Маникюр», и загрузите в него фото.' }));
    }
    works.blocks.forEach(function (b, bi) { box.appendChild(renderBlock(b, bi)); });
  }

  /* ---------- Важное ---------- */

  // Сегодня по Алматы (UTC+5) + days, как ГГГГ-ММ-ДД
  function almatyDay(days) {
    return new Date(Date.now() + 5 * 3600e3 + (days || 0) * 864e5).toISOString().slice(0, 10);
  }

  function newsState(n) {
    var t = almatyDay();
    var ru = function (d) { return d.split('-').reverse().join('.'); };
    if (n.hidden) return { off: true, text: 'Скрыта — на сайте не видна' };
    if (n.to && n.to < t) return { off: true, text: 'Закончилась ' + ru(n.to) };
    if (n.from && n.from > t) return { off: true, text: 'Появится ' + ru(n.from) };
    return { off: false, text: n.to ? 'Показ до ' + ru(n.to) + ' включительно' : 'Показ без срока' };
  }

  function changedNews() { touchNews(); renderNews(); }

  // Фото может быть общим у записи и её копии
  function dropNewsPhoto(n) {
    var p = n.photo;
    n.photo = '';
    if (p && newsPhotos(news).indexOf(p) < 0) forget(p);
  }

  function newsDate(n, key, label) {
    var input = h('input', { type: 'date', value: n[key] || '', onchange: function () { n[key] = input.value; changedNews(); } });
    return h('label', null, label, input);
  }

  function renderNewsItem(n, i) {
    var input = function (key, placeholder) {
      return field(n, key, { placeholder: placeholder, touch: touchNews });
    };
    var state = newsState(n);

    var type = h('select', { onchange: function () { n.type = type.value; changedNews(); } },
      h('option', { value: 'promo' }, 'Акция / сет'),
      h('option', { value: 'greet' }, 'Поздравление'),
      h('option', { value: 'info' }, 'Важная информация'));
    type.value = n.type;

    var text = h('textarea', {
      rows: '4',
      placeholder: n.type === 'promo' ? 'Что входит: каждая услуга с новой строки' : 'Текст',
      oninput: function () { n.text = text.value; touchNews(); }
    });
    text.value = n.text || '';

    var file = h('input', {
      type: 'file', accept: 'image/*', class: 'adm-file',
      onchange: function () {
        var f = file.files[0];
        if (!f) return;
        toast('Обрабатываем фото…');
        prepare(f).then(function (blob) {
          var path = NEWS_DIR + newName() + '.jpg';
          dropNewsPhoto(n);
          pending[path] = { blob: blob, url: URL.createObjectURL(blob), done: false };
          n.photo = path;
          $('toast').hidden = true;
          changedNews();
        }, function () { toast('Не удалось открыть фото. Подойдут JPG, PNG и WebP.', true); });
      }
    });
    var photos = h('ul', { class: 'adm-photos' },
      n.photo ? h('li', { class: 'adm-photo' },
        h('img', { src: previewUrl(n.photo), alt: 'Фото записи' }),
        h('div', { class: 'adm-photo-tools' },
          iconBtn('×', 'Убрать фото', function () { dropNewsPhoto(n); changedNews(); }, 'danger'))) : null,
      h('li', { class: 'adm-photo-add' }, h('label', null, n.photo ? 'Заменить фото' : '+ Фото', file)));

    var chip = function (label, from, to) {
      return h('button', { type: 'button', class: 'adm-add', onclick: function () { n.from = from; n.to = to; changedNews(); } }, label);
    };

    return h('div', { class: 'menu-group adm-news' + (state.off ? ' is-off' : '') },
      h('div', { class: 'adm-group-head' },
        field(n, 'title', { class: 'adm-field-title', placeholder: 'Заголовок, например «Сет: маникюр + педикюр»', label: 'Заголовок', required: true, touch: touchNews }),
        h('div', { class: 'adm-ico-row' },
          h('label', { class: 'adm-wide' },
            h('input', { type: 'checkbox', checked: n.hidden ? null : true, onchange: function (e) { n.hidden = !e.target.checked; changedNews(); } }),
            'Показывать'),
          iconBtn('↑', 'Выше', function () { if (move(news.items, i, -1)) changedNews(); }),
          iconBtn('↓', 'Ниже', function () { if (move(news.items, i, 1)) changedNews(); }),
          iconBtn('×', 'Удалить запись', function () {
            if (!confirm('Удалить запись «' + ((n.title || '').trim() || 'без заголовка') + '»?')) return;
            news.items.splice(i, 1);
            if (n.photo && newsPhotos(news).indexOf(n.photo) < 0) forget(n.photo);
            changedNews();
          }, 'danger'))),
      h('p', { class: 'adm-state' + (state.off ? ' off' : ''), text: state.text }),
      h('div', { class: 'adm-news-form' },
        h('label', { class: 'full' }, 'Тип записи', type),
        h('label', { class: 'full' }, 'Текст', text),
        n.type === 'promo' ? h('label', null, 'Цена по акции', input('price', '9 900 ₸')) : null,
        n.type === 'promo' ? h('label', null, 'Старая цена', input('old', '14 000 ₸')) : null,
        newsDate(n, 'from', 'Показывать с'),
        newsDate(n, 'to', 'По (включительно)'),
        h('div', { class: 'adm-chips full' },
          chip('Только сегодня', almatyDay(), almatyDay()),
          chip('Завтра', almatyDay(1), almatyDay(1)),
          chip('Неделя', almatyDay(), almatyDay(6)),
          chip('Без срока', '', '')),
        h('div', { class: 'full' }, photos),
        h('div', { class: 'adm-chips full' },
          h('button', {
            type: 'button', class: 'adm-add',
            onclick: function () {
              var copy = JSON.parse(JSON.stringify(n));
              copy.id = 'n-' + newName();
              copy.from = copy.to = almatyDay();
              delete copy.hidden;
              news.items.unshift(copy);
              changedNews();
              $('view-news').scrollIntoView({ behavior: 'smooth' });
              toast('Копия на сегодня добавлена сверху списка.');
            }
          }, 'Повторить сегодня'))));
  }

  function renderNews() {
    var box = $('news-list');
    box.textContent = '';
    if (!news.items.length) {
      box.appendChild(h('p', { class: 'adm-muted adm-empty', text: 'Пока нет записей — раздел на сайте скрыт.' }));
    }
    news.items.forEach(function (n, i) { box.appendChild(renderNewsItem(n, i)); });
  }

  /* ---------- Мастера, обучение, отзывы, контакты ---------- */

  function touchSec(s) { if (!s.dirty) { s.dirty = true; refreshDirty(); } }

  function secField(s, o, f) {
    var key = f[0], kind = f[2], req = /\*$/.test(f[1]);
    var el;
    if (kind === 'select') {
      el = h('select', { onchange: function () { o[key] = el.value; touchSec(s); renderSec(s); } });
      f[3].forEach(function (x) { el.appendChild(h('option', { value: x[0] }, x[1])); });
    } else {
      el = h(kind === 'area' ? 'textarea' : 'input', {
        type: kind === 'area' ? null : kind === 'date' ? 'date' : 'text',
        rows: kind === 'area' ? '4' : null,
        placeholder: f[3] || (kind === 'url' ? 'https://' : ''),
        'data-req': req ? '1' : null,
        oninput: function () {
          o[key] = el.value;
          if (req) el.classList.toggle('bad', !el.value.trim());
          touchSec(s);
        }
      });
    }
    el.value = o[key] || '';
    return h('label', { class: kind === 'area' ? 'full' : '' }, f[1], el);
  }

  function secPhoto(s, o) {
    var drop = function () {
      var p = o.photo;
      o.photo = '';
      if (p) forget(p);
    };
    var changed = function () { touchSec(s); renderSec(s); };
    var file = h('input', {
      type: 'file', accept: 'image/*', class: 'adm-file',
      onchange: function () {
        var f = file.files[0];
        if (!f) return;
        toast('Обрабатываем фото…');
        prepare(f).then(function (blob) {
          var path = s.photoDir + newName() + '.jpg';
          drop();
          pending[path] = { blob: blob, url: URL.createObjectURL(blob), done: false };
          o.photo = path;
          $('toast').hidden = true;
          changed();
        }, function () { toast('Не удалось открыть фото. Подойдут JPG, PNG и WebP.', true); });
      }
    });
    return h('div', { class: 'full' }, h('ul', { class: 'adm-photos' },
      o.photo ? h('li', { class: 'adm-photo' },
        h('img', { src: previewUrl(o.photo), alt: 'Фото', loading: 'lazy' }),
        h('div', { class: 'adm-photo-tools' },
          iconBtn('×', 'Убрать фото', function () { drop(); changed(); }, 'danger'))) : null,
      h('li', { class: 'adm-photo-add' }, h('label', null, o.photo ? 'Заменить фото' : '+ Фото', file))));
  }

  function renderSecItem(s, o, i) {
    var items = s.data.items;
    var changed = function () { touchSec(s); renderSec(s); };
    var low = s.key === 'reviews' && Number(o.rating) < 4.5;
    var form = h('div', { class: 'adm-news-form' });
    if (s.photoDir) form.appendChild(secPhoto(s, o));
    s.f.forEach(function (f) { form.appendChild(secField(s, o, f)); });
    return h('div', { class: 'menu-group' },
      h('div', { class: 'adm-group-head' },
        field(o, s.title[0], { class: 'adm-field-title', placeholder: s.title[1], label: s.title[1], required: true, touch: function () { touchSec(s); } }),
        h('div', { class: 'adm-ico-row' },
          h('label', { class: 'adm-wide' },
            h('input', { type: 'checkbox', checked: o.hidden ? null : true, onchange: function (e) { o.hidden = !e.target.checked; changed(); } }),
            'Показывать'),
          s.key === 'reviews' ? null : iconBtn('↑', 'Выше', function () { if (move(items, i, -1)) changed(); }),
          s.key === 'reviews' ? null : iconBtn('↓', 'Ниже', function () { if (move(items, i, 1)) changed(); }),
          iconBtn('×', 'Удалить', function () {
            if (!confirm('Удалить «' + ((o[s.title[0]] || '').trim() || 'без названия') + '»?')) return;
            items.splice(i, 1);
            if (o.photo) forget(o.photo);
            changed();
          }, 'danger'))),
      o.hidden || low ? h('p', { class: 'adm-state off', text: o.hidden ? 'Скрыто — на сайте не видно' : 'Оценка ниже 4,5 — на сайте не видно' }) : null,
      form);
  }

  function renderSec(s) {
    var box = $('view-' + s.key);
    box.textContent = '';
    box.appendChild(h('p', { class: 'adm-hint' }, s.hint + ' Изменения попадут на сайт после кнопки ', h('b', { text: '«Сохранить»' }), '.'));
    if (s.top) {
      var form = h('div', { class: 'adm-news-form' });
      s.top.forEach(function (f) { form.appendChild(secField(s, s.data, f)); });
      box.appendChild(h('div', { class: 'menu-group' }, form));
    }
    if (s.listTitle) box.appendChild(h('h2', { class: 'adm-sec-title', text: s.listTitle }));
    var add = h('button', {
      type: 'button', class: 'adm-add adm-add-group adm-sec-add',
      onclick: function () {
        var o = { id: s.key.charAt(0) + '-' + newName() };
        o[s.title[0]] = '';
        if (s.key === 'reviews') { o.rating = '5'; o.date = almatyDay(); }
        if (s.first) s.data.items.unshift(o); else s.data.items.push(o);
        touchSec(s);
        renderSec(s);
        var t = box.querySelectorAll('.adm-field-title');
        t[s.first ? 0 : t.length - 1].focus();
      }
    }, s.add);
    var list = h('div', { class: 'adm-works' });
    s.data.items.forEach(function (o, i) { list.appendChild(renderSecItem(s, o, i)); });
    if (s.first) { box.appendChild(add); box.appendChild(list); } else { box.appendChild(list); box.appendChild(add); }
  }

  /* ---------- Старт ---------- */

  $('login').addEventListener('click', login);
  $('logout').addEventListener('click', function () {
    if (dirty && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) return;
    logout();
  });
  $('denied-logout').addEventListener('click', logout);
  $('save').addEventListener('click', save);
  Array.prototype.forEach.call($('views').children, function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });
  $('add-block').addEventListener('click', function () {
    works.blocks.push({ id: 'w-' + newName(), title: '', photos: [] });
    touchWorks();
    renderWorks();
    var titles = document.querySelectorAll('.adm-block .adm-field-title');
    if (titles.length) titles[titles.length - 1].focus();
  });
  $('add-news').addEventListener('click', function () {
    news.items.unshift({ id: 'n-' + newName(), type: 'promo', title: '', from: almatyDay(), to: almatyDay() });
    changedNews();
    var f = document.querySelector('.adm-news .adm-field-title');
    if (f) f.focus();
  });
  $('add-tab').addEventListener('click', function () {
    data.tabs.push({ id: newId(), title: 'Новая категория', groups: [{ title: '', rows: [{ name: '', price: '' }] }] });
    active = data.tabs.length - 1;
    touch();
    render();
    var f = document.querySelector('#tab-tools input');
    if (f) { f.focus(); f.select(); }
  });

  // Ctrl/⌘ + S
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  });

  if (LOCAL) {
    start();
  } else {
    token = recall(TOKEN_KEY);
    if (token) start(); else show('login');
  }
})();
