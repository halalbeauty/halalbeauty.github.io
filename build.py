#!/usr/bin/env python3
"""Собирает index.html + styles.css + script.js + логотипы в один файл для публикации артефактом.

Артефакт — это одна страница без <head>, поэтому берём кусок между BUILD:START и
BUILD:END, а стили, скрипт и логотипы вшиваем внутрь. Логотип в шапке и подвале
берётся из logo-128.png, крупный на первом экране — из logo-256.png.

    python3 build.py        # → dist/halal-beauty.html
"""

import base64
import io
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "dist", "halal-beauty.html")
TITLE = "Halal Beauty Almaty"

LOGOS = {"brand-mark": "logo-128.png", "hero-logo": "logo-256.png"}

HEAD = """<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700;800;900&display=swap">
<script>document.documentElement.classList.add("js");</script>
<style>
{css}
</style>
"""


def read(name):
    return io.open(os.path.join(ROOT, name), encoding="utf-8").read()


def data_uri(name):
    mime = "image/jpeg" if name.lower().endswith((".jpg", ".jpeg")) else "image/png"
    with open(os.path.join(ROOT, name), "rb") as f:
        return "data:%s;base64," % mime + base64.b64encode(f.read()).decode()


def inline_css_images(css):
    """Фоновые картинки в CSS вшиваем в data-URI — артефакт не видит соседние файлы."""

    def sub(m):
        name = m.group(1)
        if not os.path.exists(os.path.join(ROOT, name)):
            return "none"  # файла нет — остаётся градиент под ним
        return 'url("%s")' % data_uri(name)

    return re.sub(r"url\(\"([\w.-]+\.(?:png|jpe?g))\"\)", sub, css)


def inline_logos(html):
    def sub(m):
        tag = m.group(0)
        for cls, png in LOGOS.items():
            if 'class="%s"' % cls in tag:
                return tag.replace('src="logo.png"', 'src="%s"' % data_uri(png))
        return tag

    return re.sub(r"<img[^>]*src=\"logo\.png\"[^>]*>", sub, html)


def main():
    html = read("index.html")
    body = html.split("<!-- BUILD:START -->")[1].split("<!-- BUILD:END -->")[0]

    page = (
        HEAD.format(title=TITLE, css=inline_css_images(read("styles.css")))
        + inline_logos(body)
        + "<script>\n"
        + read("script.js")
        + "\n</script>\n"
    )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(page)
    print("%s — %.0f КБ" % (OUT, len(page.encode()) / 1024))


if __name__ == "__main__":
    main()
