/* Админка прайса Halal Beauty.
 *
 * Вход — через GitHub (сервис входа в oauth/worker.js). Прайс читается и
 * записывается прямо в data/services.json репозитория через GitHub API от имени
 * вошедшего человека, поэтому сохранить может только тот, у кого есть доступ
 * на запись. После сохранения workflow пересобирает index.html (render.py).
 *
 * На localhost админка открывается без входа и ничего не сохраняет — для проверки вёрстки.
 */
(function () {
  'use strict';

  var REPO = 'halalbeauty/halalbeauty.github.io';
  var BRANCH = 'main';
  var FILE = 'data/services.json';
  var AUTH = 'https://halalbeauty-auth.kazakhbaimeyrzhan.workers.dev';
  var TOKEN_KEY = 'hb_admin_token';
  var LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  var token = null;
  var data = null;
  var sha = null;
  var dirty = false;
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

  function setDirty(v) {
    dirty = v;
    var st = $('save-status');
    st.textContent = v ? 'Есть несохранённые изменения' : 'Нет изменений';
    st.className = 'adm-save-status' + (v ? ' dirty' : '');
    $('save').disabled = !v || saving;
  }

  function touch() { if (!dirty) setDirty(true); }

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
    store(TOKEN_KEY, null);
    setDirty(false);
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

  function start() {
    show('loading');
    $('loading-text').textContent = 'Загружаем прайс…';

    if (LOCAL) {
      fetch('../' + FILE).then(function (r) { return r.json(); }).then(function (d) {
        data = d;
        active = 0;
        setDirty(false);
        show('editor');
        render();
      });
      return;
    }

    gh('/repos/' + REPO).then(function (repo) {
      if (!repo.permissions || !repo.permissions.push) {
        show('denied');
        return null;
      }
      return gh('/repos/' + REPO + '/contents/' + FILE + '?ref=' + BRANCH).then(function (f) {
        sha = f.sha;
        data = JSON.parse(b64ToUtf8(f.content));
        active = Math.min(active, data.tabs.length - 1);
        setDirty(false);
        show('editor');
        render();
      });
    }).catch(function (err) {
      if (!token) return;
      if (err.status === 404) {
        show('denied');
        return;
      }
      show('loading');
      $('loading-text').textContent = 'Не получилось загрузить прайс: ' + err.message;
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

  function save() {
    if (saving || !dirty) return;
    var c = clean();
    if (c.problems.length) {
      toast('Заполните: ' + c.problems[0] + (c.problems.length > 1 ? ' (и ещё ' + (c.problems.length - 1) + ')' : ''), true);
      markEmpty();
      return;
    }
    if (LOCAL) {
      window.hbLocalSave = JSON.stringify(c.out, null, 2) + '\n';
      toast('Локальная проверка: ничего не отправлено', false);
      return;
    }
    saving = true;
    $('save').disabled = true;
    $('save').textContent = 'Сохраняем…';
    gh('/repos/' + REPO + '/contents/' + FILE, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Прайс: правки через админку',
        content: utf8ToB64(JSON.stringify(c.out, null, 2) + '\n'),
        sha: sha,
        branch: BRANCH
      })
    }).then(function (res) {
      sha = res.content.sha;
      data = c.out;
      saving = false;
      $('save').textContent = 'Сохранить';
      setDirty(false);
      render();
      toast('Сохранено. На сайте изменения появятся через 1–2 минуты.');
    }).catch(function (err) {
      saving = false;
      $('save').textContent = 'Сохранить';
      $('save').disabled = !dirty;
      if (err.status === 409 || err.status === 422) {
        toast('Прайс уже изменили в другом месте. Скопируйте свои правки, обновите страницу и внесите их заново.', true);
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
        touch();
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

  /* ---------- Старт ---------- */

  $('login').addEventListener('click', login);
  $('logout').addEventListener('click', function () {
    if (dirty && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) return;
    logout();
  });
  $('denied-logout').addEventListener('click', logout);
  $('save').addEventListener('click', save);
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
