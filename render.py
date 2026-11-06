#!/usr/bin/env python3
"""Подставляет прайс и «Наши работы» из data/*.json в index.html.

Блоки между SERVICES:START/END и WORKS:START/END в index.html — сгенерированные:
править их руками бесполезно, следующий запуск перезапишет. Цены и услуги
меняются в data/services.json, блоки с фото — в data/works.json
(или через админку /admin/).

    python3 render.py          # перезаписывает блок в index.html
    python3 render.py --check  # ничего не пишет; код 1, если index.html отстаёт от данных
"""

import html
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data", "services.json")
WORKS = os.path.join(ROOT, "data", "works.json")
PAGE = os.path.join(ROOT, "index.html")

BLOCK = re.compile(
    r"(?P<head>[ \t]*<!-- SERVICES:START[^\n]*-->\n)(?P<body>.*?)(?P<tail>[ \t]*<!-- SERVICES:END -->)",
    re.S,
)
WORKS_BLOCK = re.compile(
    r"(?P<head>[ \t]*<!-- WORKS:START[^\n]*-->\n)(?P<body>.*?)(?P<tail>[ \t]*<!-- WORKS:END -->)",
    re.S,
)


def esc(text):
    return html.escape(text, quote=False)


def attr(text):
    return html.escape(text, quote=True)


def row(r):
    name = esc(r["name"])
    meta, note, incl = r.get("meta"), r.get("note"), r.get("incl")
    if meta or incl:
        small = '<small class="meta">%s</small>' % esc(meta) if meta else ""
        lines = ['<li class="menu-row">']
        if incl:
            lines.append('  <span class="name">%s%s<span class="incl">' % (name, small))
            for item in incl:
                cls = ' class="stage"' if item.get("stage") else ""
                lines.append("    <span%s>%s</span>" % (cls, esc(item["text"])))
            lines.append("  </span></span>")
        else:
            lines.append('  <span class="name">%s%s</span>' % (name, small))
    else:
        small = "<small>%s</small>" % esc(note) if note else ""
        lines = ['<li class="menu-row">', '  <span class="name">%s%s</span>' % (name, small)]
    lines.append('  <span class="dots"></span><span class="price">%s</span>' % esc(r["price"]))
    lines.append("</li>")
    return lines


def render(data):
    out = ['<div class="cat-nav reveal" role="tablist" aria-label="Категории услуг">']
    for i, tab in enumerate(data["tabs"]):
        out.append(
            '  <button type="button" role="tab" id="tab-%s" aria-controls="panel-%s" aria-selected="%s">%s</button>'
            % (tab["id"], tab["id"], "true" if i == 0 else "false", esc(tab["title"]))
        )
    out.append("</div>")
    out.append("")
    for i, tab in enumerate(data["tabs"]):
        hidden = "" if i == 0 else " hidden"
        out.append(
            '<div class="menu cat-panel" id="panel-%s" role="tabpanel" aria-labelledby="tab-%s"%s>'
            % (tab["id"], tab["id"], hidden)
        )
        for g in tab["groups"]:
            out.append('  <div class="menu-group%s">' % (" split" if g.get("split") else ""))
            out.append("    <h3>%s</h3>" % esc(g["title"]))
            out.append("    <ul>")
            for r in g["rows"]:
                out += ["      " + line for line in row(r)]
            out.append("    </ul>")
            out.append("  </div>")
        out.append("</div>")
    return "\n".join(("      " + l) if l else "" for l in out) + "\n"


CHEVRON = (
    '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="%s" fill="none" '
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)


def work(block):
    """Карточка с каруселью: фото листаются свайпом (CSS scroll-snap), script.js рисует индикатор."""
    title = block["title"].strip()
    photos = block["photos"]
    many = len(photos) > 1
    out = [
        '<article class="work">',
        '  <div class="work-track" tabindex="0" role="group" aria-roledescription="carousel" aria-label="%s">'
        % attr(title),
    ]
    for i, src in enumerate(photos):
        alt = "%s, фото %d из %d" % (title, i + 1, len(photos)) if many else title
        out.append(
            '    <img class="work-slide" src="%s" alt="%s" loading="lazy" decoding="async" draggable="false">'
            % (attr(src), attr(alt))
        )
    out.append("  </div>")
    if many:
        out.append('  <div class="work-bars" aria-hidden="true">%s</div>' % "".join(
            '<i class="on"></i>' if i == 0 else "<i></i>" for i in range(len(photos))
        ))
        out.append(
            '  <button type="button" class="work-nav prev" aria-label="Предыдущее фото" disabled>%s</button>'
            % (CHEVRON % "M15 5l-7 7 7 7")
        )
        out.append(
            '  <button type="button" class="work-nav next" aria-label="Следующее фото">%s</button>'
            % (CHEVRON % "M9 5l7 7-7 7")
        )
    out.append('  <h3 class="work-title">%s</h3>' % esc(title))
    out.append("</article>")
    return out


def render_works(data):
    """Скрытые блоки и блоки без фото на сайт не попадают. Нет блоков — нет и сетки."""
    shown = [
        b for b in data.get("blocks", [])
        if not b.get("hidden") and b.get("photos") and b.get("title", "").strip()
    ]
    if not shown:
        return ""
    out = ['<div class="works reveal">']
    for b in shown:
        out += ["  " + line for line in work(b)]
    out.append("</div>")
    return "\n".join(("      " + l) if l else "" for l in out) + "\n"


def read_json(path, default=None):
    if default is not None and not os.path.exists(path):
        return default
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    services = read_json(DATA)
    works = read_json(WORKS, {"blocks": []})
    with io.open(PAGE, encoding="utf-8") as f:
        page = f.read()
    new = page
    for pattern, body, name in (
        (BLOCK, render(services), "SERVICES"),
        (WORKS_BLOCK, render_works(works), "WORKS"),
    ):
        m = pattern.search(new)
        if not m:
            sys.exit("render.py: в index.html нет блока %s:START … %s:END" % (name, name))
        new = new[: m.start("body")] + body + new[m.start("tail"):]
    if "--check" in sys.argv:
        sys.exit(0 if new == page else 1)
    if new != page:
        with io.open(PAGE, "w", encoding="utf-8", newline="\n") as f:
            f.write(new)
        print("index.html обновлён")
    else:
        print("index.html уже актуален")


if __name__ == "__main__":
    main()
