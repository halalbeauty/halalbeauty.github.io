#!/usr/bin/env python3
"""Подставляет прайс из data/services.json в index.html.

Блок между SERVICES:START и SERVICES:END в index.html — сгенерированный:
править его руками бесполезно, следующий запуск перезапишет. Цены и услуги
меняются в data/services.json (или через админку /admin/).

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
PAGE = os.path.join(ROOT, "index.html")

BLOCK = re.compile(
    r"(?P<head>[ \t]*<!-- SERVICES:START[^\n]*-->\n)(?P<body>.*?)(?P<tail>[ \t]*<!-- SERVICES:END -->)",
    re.S,
)


def esc(text):
    return html.escape(text, quote=False)


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


def main():
    with io.open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    with io.open(PAGE, encoding="utf-8") as f:
        page = f.read()
    m = BLOCK.search(page)
    if not m:
        sys.exit("render.py: в index.html нет блока SERVICES:START … SERVICES:END")
    new = page[: m.start("body")] + render(data) + page[m.start("tail"):]
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
