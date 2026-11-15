# CLAUDE.md

Руководство для Claude Code по проекту сайта Halal Beauty.

## Язык общения
Всегда отвечай только на русском языке.

## О проекте
Статический сайт салона Halal Beauty (Алматы, ресницы).
Публикуется через GitHub Pages: https://halalbeauty.github.io
Репозиторий: halalbeauty/halalbeauty.github.io (remote `origin`; `old` — устаревший smartqmj/halal-beauty).

## Структура
- index.html, styles.css, script.js — сайт (без сборщика, чистый HTML/CSS/JS)
- data/services.json — прайс и услуги; data/works.json — блок «Наши работы»
- photos/ — фото работ
- render.py — подставляет data/*.json в index.html между маркерами SERVICES:START/END и WORKS:START/END
- build.py — собирает один файл dist/halal-beauty.html (dist/ в .gitignore)
- admin/ — админка (/admin/), правит data/*.json через GitHub API
- oauth/worker.js — Cloudflare Worker для GitHub OAuth админки (https://halalbeauty-auth.kazakhbaimeyrzhan.workers.dev)
- .github/workflows/render.yml — при пуше в main с изменениями data/** или render.py пересобирает index.html и коммитит его обратно
- "Cream and Brown Modern Eyelash Salon Price List/" — исходные PNG прайса из Canva, только локально (в .gitignore)

## Команды
```bash
python render.py          # обновить index.html из data/*.json
python render.py --check  # проверка: код 1, если index.html отстаёт от данных
python build.py           # собрать dist/halal-beauty.html
```

## Правила
- Блоки между SERVICES:START/END и WORKS:START/END в index.html генерируются — руками не править; менять data/*.json и запускать render.py.
- После git pull учитывай, что бот GitHub Actions коммитит index.html в main.
- Не делай git push без явной просьбы пользователя.
- Перед большими изменениями (3+ файла) сначала покажи план.
- После завершённой задачи предлагай сделать git commit.

## Известные нюансы
- Имя папки проекта содержит «й» в разобранном виде (и + знак над ней, как на macOS): путь, набранный с клавиатуры, может не находиться. В bash используй маску: `cd /c/Users/Hp/Downloads/Halal*/`.
- Кодировка файлов — UTF-8. Вывод PowerShell может показывать кракозябры — это только отображение, файлы в порядке. Не пересохраняй файлы через PowerShell echo/Set-Content без -Encoding utf8.
