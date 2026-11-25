#!/usr/bin/env python3
"""Подставляет содержимое разделов из data/*.json в index.html.

Блоки между ИМЯ:START/END и тексты с data-c / data-c-href в index.html — сгенерированные:
править их руками бесполезно, следующий запуск перезапишет. Цены и услуги
меняются в data/services.json, блоки с фото — в data/works.json,
акции и объявления — в data/news.json, остальное — masters, training, reviews
и contacts.json там же
(или через админку /admin/).

    python3 render.py          # перезаписывает блок в index.html
    python3 render.py --check  # ничего не пишет; код 1, если index.html отстаёт от данных
"""

import html
import io
import json
import os
import re
import struct
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data", "services.json")
WORKS = os.path.join(ROOT, "data", "works.json")
NEWS = os.path.join(ROOT, "data", "news.json")


def data_file(name):
    return os.path.join(ROOT, "data", name + ".json")


PAGE = os.path.join(ROOT, "index.html")

BLOCK = re.compile(
    r"(?P<head>[ \t]*<!-- SERVICES:START[^\n]*-->\n)(?P<body>.*?)(?P<tail>[ \t]*<!-- SERVICES:END -->)",
    re.S,
)
WORKS_BLOCK = re.compile(
    r"(?P<head>[ \t]*<!-- WORKS:START[^\n]*-->\n)(?P<body>.*?)(?P<tail>[ \t]*<!-- WORKS:END -->)",
    re.S,
)


def marker(name):
    return re.compile(
        r"(?P<head>[ \t]*<!-- %s:START[^\n]*-->\n)(?P<body>.*?)(?P<tail>[ \t]*<!-- %s:END -->)" % (name, name),
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


def image_size(src):
    """(ширина, высота) фото из файла в репозитории или None. Читаем заголовок JPEG/PNG сами — без Pillow."""
    path = os.path.normpath(os.path.join(ROOT, src))
    if not path.startswith(ROOT + os.sep):
        return None
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
                i += 2 if marker != 0xFF else 1
                continue
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return (w, h) if w and h else None
            i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    return None


def work(block):
    """Карточка с каруселью: фото листаются свайпом (CSS scroll-snap), script.js рисует индикатор.

    Лента (.work-track) всегда одного размера — по самому высокому фото, поэтому при свайпе
    она не пересчитывается и не перебивает жест. Меняется только рамка-окно (.work-media):
    script.js подгоняет её высоту под фото, а фото в ленте стоят по центру. Место под самое
    высокое фото зарезервировано в карточке (--r), поэтому остальная страница не прыгает."""
    title = block["title"].strip()
    photos = block["photos"]
    many = len(photos) > 1
    sizes = [image_size(src) for src in photos]
    first = sizes[0]
    ratio = ' style="aspect-ratio: %d / %d"' % first if first else ""
    tallest = max((h / float(w) for w, h in sizes if w and h), default=None)
    var = ' style="--r: %.4f"' % tallest if tallest else ""
    out = [
        '<article class="work"%s>' % var,
        '  <div class="work-live">',
        '    <div class="work-media"%s>' % ratio,
        '      <div class="work-track" tabindex="0" role="group" aria-roledescription="carousel" aria-label="%s">'
        % attr(title),
    ]
    for i, src in enumerate(photos):
        alt = "%s, фото %d из %d" % (title, i + 1, len(photos)) if many else title
        # width/height нужны script.js: по ним рамка меняет высоту при свайпе
        wh = ' width="%d" height="%d"' % sizes[i] if sizes[i] else ""
        out.append(
            '        <img class="work-slide" src="%s" alt="%s"%s loading="lazy" decoding="async" draggable="false">'
            % (attr(src), attr(alt), wh)
        )
    out.append("      </div>")
    if many:
        out.append(
            '      <button type="button" class="work-nav prev" aria-label="Предыдущее фото" disabled>%s</button>'
            % (CHEVRON % "M15 5l-7 7 7 7")
        )
        out.append(
            '      <button type="button" class="work-nav next" aria-label="Следующее фото">%s</button>'
            % (CHEVRON % "M9 5l7 7-7 7")
        )
    out.append("    </div>")
    out.append('    <div class="work-cap">')
    out.append('      <h3 class="work-title">%s</h3>' % esc(title))
    if many:
        out.append('      <div class="work-bars" aria-hidden="true">%s</div>' % "".join(
            '<i class="on"></i>' if i == 0 else "<i></i>" for i in range(len(photos))
        ))
    out.append("    </div>")
    out.append("  </div>")
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


NEWS_TYPES = {"promo": "Акция", "greet": "Поздравление", "info": "Важно"}


def money(text):
    """«17500» → «17 500 ₸»; остальное — как ввели."""
    return "{:,} ₸".format(int(text)).replace(",", " ") if re.match(r"[0-9]+$", text) else text


def news_item(item, wa):
    """Запись со сроком отдаём скрытой (hidden): в нужный день её открывает script.js."""
    title = item["title"].strip()
    kind = item.get("type") if item.get("type") in NEWS_TYPES else "info"
    start, end = item.get("from") or "", item.get("to") or ""
    dates = "".join(
        ' data-%s="%s"' % (k, attr(v)) for k, v in (("from", start), ("to", end)) if v
    )
    out = ['<article class="news-card is-%s"%s%s>' % (kind, dates, " hidden" if dates else "")]
    photo = item.get("photo")
    if photo:
        size = image_size(photo)
        wh = ' width="%d" height="%d"' % size if size else ""
        out.append('  <img class="news-photo" src="%s" alt=""%s loading="lazy" decoding="async">' % (attr(photo), wh))
    out.append('  <div class="news-body">')
    out.append('    <p class="news-tag">%s<span class="news-term"></span></p>' % NEWS_TYPES[kind])
    out.append("    <h3>%s</h3>" % esc(title))
    lines = [l.strip() for l in (item.get("text") or "").split("\n") if l.strip()]
    if lines:
        out.append('    <p class="news-text">%s</p>' % "<br>".join(esc(l) for l in lines))
    price, old = money(get(item, "price")), money(get(item, "old"))
    if kind == "promo" and price:
        was = ' <s aria-label="Старая цена">%s</s>' % esc(old) if old else ""
        out.append('    <p class="news-price"><b>%s</b>%s</p>' % (esc(price), was))
    if kind == "promo":
        msg = urllib.parse.quote("Здравствуйте! Хочу записаться по акции «%s»" % title)
        out.append(
            '    <a class="btn btn-primary" href="%s?text=%s" target="_blank" rel="noopener">Записаться</a>'
            % (attr(wa), msg)
        )
    out.append("  </div>")
    out.append("</article>")
    return out


def render_news(data, wa):
    """Секция скрыта, пока script.js не найдёт в ней хотя бы одну действующую запись."""
    shown = [i for i in data.get("items", []) if not i.get("hidden") and i.get("title", "").strip()]
    if not shown:
        return ""
    out = [
        '<section id="news" class="news" hidden>',
        '  <div class="wrap">',
        '    <div class="sec-head reveal">',
        "      <div>",
        '        <p class="eyebrow">Важное</p>',
        "        <h2>Акции и новости</h2>",
        "      </div>",
        "    </div>",
        '    <div class="news-grid reveal">',
    ]
    for i in shown:
        out += ["      " + line for line in news_item(i, wa)]
    out += ["    </div>", "  </div>", "</section>"]
    return "\n".join("  " + l for l in out) + "\n"


def get(d, key):
    return (d.get(key) or "").strip()


def visible(data):
    return [i for i in data.get("items", []) if not i.get("hidden")]


def text_lines(text):
    return [l.strip() for l in (text or "").split("\n") if l.strip()]


def indent(lines, n):
    return "".join((" " * n + l if l else "") + "\n" for l in lines)


# ---------- Мастера ----------

def render_masters(data):
    """Данные для карусели: карточки собирает script.js."""
    items = [
        {
            "name": get(m, "name"),
            "photo": get(m, "photo"),
            "role": [x.strip() for x in get(m, "role").split(",") if x.strip()],
            "exp": get(m, "exp"),
            "about": get(m, "about"),
        }
        for m in visible(data) if get(m, "name")
    ]
    js = json.dumps(items, ensure_ascii=False).replace("<", "\\u003c")
    return '    <script type="application/json" id="masters-data">%s</script>\n' % js


# ---------- Обучение ----------

def plan(p, wa):
    style = p.get("style") if p.get("style") in ("hot", "max") else ""
    pid = "more-" + re.sub(r"[^\w-]", "", p.get("id", ""))
    code, badge = get(p, "code"), get(p, "badge")
    msg = urllib.parse.quote("Здравствуйте! Хочу записаться на обучение " + (code or get(p, "name")).upper())
    out = ['<article class="plan%s reveal">' % (" plan-" + style if style else ""), '  <div class="plan-top">']
    out.append('    <p class="plan-code">%s</p>' % esc(code))
    if badge:
        out.append('    <span class="plan-badge">%s</span>' % esc(badge))
    out.append("  </div>")
    out.append('  <h3 class="plan-name">%s</h3>' % esc(get(p, "name")))
    out.append(
        '  <a class="btn %s plan-btn" href="%s?text=%s" target="_blank" rel="noopener">Записаться</a>'
        % ("btn-primary" if style == "hot" else "btn-ghost", attr(wa), msg)
    )
    if get(p, "price"):
        note = "<small>/ %s</small>" % esc(get(p, "priceNote")) if get(p, "priceNote") else ""
        out.append('  <p class="plan-price"><b>%s</b>%s</p>' % (esc(get(p, "price")), note))
    if get(p, "solo"):
        out.append('  <p class="plan-solo">Индивидуально — <b>%s</b></p>' % esc(get(p, "solo")))
    facts = [("time", get(p, "time")), ("practice", get(p, "practice"))]
    facts += [("check", l) for l in text_lines(p.get("incl"))]
    facts = [f for f in facts if f[1]]
    if facts:
        out.append('  <ul class="plan-facts">')
        out += ['    <li class="ic-%s"><i aria-hidden="true"></i><span>%s</span></li>' % (k, esc(t)) for k, t in facts]
        out.append("  </ul>")
    program, note = text_lines(p.get("program")), get(p, "note")
    if program or note:
        out += [
            '  <div class="plan-more">',
            '    <div class="plan-more-wrap" id="%s">' % attr(pid),
            '      <div class="plan-more-inner">',
        ]
        opened = False
        for l in program:
            if l.startswith("#"):
                if opened:
                    out.append("        </ul>")
                    opened = False
                out.append('        <p class="plan-h">%s</p>' % esc(l.lstrip("# ")))
            else:
                if not opened:
                    out.append('        <ul class="plan-list">')
                    opened = True
                out.append("          <li>%s</li>" % esc(l))
        if opened:
            out.append("        </ul>")
        if note:
            out.append('        <p class="plan-note">%s</p>' % esc(note))
        out += [
            "      </div>",
            "    </div>",
            '    <button class="plan-toggle" type="button" aria-expanded="false" aria-controls="%s">' % attr(pid),
            '      <i aria-hidden="true"></i><span>Программа обучения</span>',
            "    </button>",
            "  </div>",
        ]
    out.append("</article>")
    return out


def render_training(data, wa):
    out = [
        '<div class="sec-head reveal">',
        "  <div>",
        '    <p class="eyebrow">Обучение</p>',
        "    <h2>%s</h2>" % esc(get(data, "title")),
        "  </div>",
        '  <p class="lead">%s</p>' % esc(get(data, "lead")),
        "</div>",
        "",
        '<div class="plans">',
    ]
    for p in visible(data):
        if get(p, "name"):
            out += ["  " + l for l in plan(p, wa)]
    out += [
        "</div>",
        "",
        '<p class="plans-foot reveal">',
        "  Не знаете, какая программа подойдёт? Напишите нам «ОБУЧЕНИЕ» —",
        '  <a href="%s?text=%s" target="_blank" rel="noopener">поможем подобрать под ваш опыт и цель</a>.'
        % (attr(wa), urllib.parse.quote("ОБУЧЕНИЕ")),
        "</p>",
    ]
    return indent(out, 6)


# ---------- Отзывы ----------

MIN_RATING = 4.5
MAX_REVIEWS = 9
MONTHS = "января февраля марта апреля мая июня июля августа сентября октября ноября декабря".split()


def number(text):
    try:
        return float(str(text).replace(",", "."))
    except ValueError:
        return 0.0


def ru_date(iso):
    m = re.match(r"(\d{4})-(\d\d)-(\d\d)$", iso)
    if not m or not 1 <= int(m.group(2)) <= 12:
        return ""
    return "%d %s %s" % (int(m.group(3)), MONTHS[int(m.group(2)) - 1], m.group(1))


def render_reviews(data):
    """Только оценки от 4,5, свежие первыми."""
    shown = [
        r for r in visible(data)
        if get(r, "name") and get(r, "text") and number(r.get("rating", "")) >= MIN_RATING
    ]
    shown.sort(key=lambda r: get(r, "date"), reverse=True)
    if not shown:
        return ""
    out = ['<div class="reviews reveal">']
    for r in shown[:MAX_REVIEWS]:
        text = get(r, "text").strip("«»\"")
        kk = ' lang="kk"' if re.search("[әғқңөұүһі]", text.lower()) else ""
        rate = number(r["rating"])
        stars = "★★★★★" if rate >= 5 else "★★★★½"
        tail = ", ".join(x for x in (ru_date(get(r, "date")), "2ГИС") if x)
        if get(r, "service"):
            tail = get(r, "service") + " · " + tail
        out += [
            '  <figure class="review">',
            "    <blockquote%s>«%s»</blockquote>" % (kk, "<br>".join(esc(l) for l in text_lines(text))),
            '    <figcaption><span class="stars" role="img" aria-label="%s из 5">%s</span><b>%s</b>%s</figcaption>'
            % (("%g" % rate).replace(".", ","), stars, esc(get(r, "name")), esc(tail)),
            "  </figure>",
        ]
    out.append("</div>")
    return indent(out, 6)


# ---------- Контакты ----------

def render_faq(data):
    out = []
    for f in visible(data):
        if get(f, "q") and get(f, "a"):
            out += ["<details>", "  <summary>%s</summary>" % esc(get(f, "q")),
                    "  <p>%s</p>" % "<br>".join(esc(l) for l in text_lines(f["a"])), "</details>"]
    return indent(out, 12)


def digits(phone):
    d = re.sub(r"\D", "", phone)
    return "7" + d[1:] if len(d) == 11 and d[0] == "8" else d


def https(url):
    return url if re.match(r"https?://", url) else ""


def plural(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        return one
    return few if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else many


def contact_values(c, reviews):
    """Все подстановки data-c / data-c-href. Контакты и рейтинг вводятся в админке один раз."""
    days, opens, close = get(c, "days"), get(c, "open"), get(c, "close")
    hours = "%s — %s" % (opens, close)
    city, street, place = get(c, "city"), get(c, "street"), get(c, "place")
    rating = get(reviews, "rating")
    n = int(re.sub(r"\D", "", str(reviews.get("count", ""))) or 0)
    count = "%d %s" % (n, plural(n, "отзыв", "отзыва", "отзывов"))
    low = days[:1].lower() + days[1:]
    handle = re.search(r"instagram\.com/([\w.]+)", get(c, "instagram"))
    v = {
        "wa": "https://wa.me/" + digits(get(c, "whatsapp")),
        "tel": "tel:+" + digits(get(c, "phone")),
        "tel2": "tel:+" + digits(get(c, "phone2")),
        "phone": get(c, "phone"),
        "phone2": get(c, "phone2"),
        "street": street,
        "hours": hours,
        "work_days": "Работаем " + low,
        "address": "%s, ул. %s" % (city, street),
        "address_more": " · ".join(x for x in (place, get(c, "district")) if x),
        "days_hours": "%s, %s" % (days, hours),
        "footer_line": "%s. %s с %s до %s." % (", ".join(x for x in (city, street, place) if x), days, opens, close),
        "copy_line": "Работаем по записи · %s %s" % (low, hours),
        "handle": "@" + handle.group(1) if handle else "",
        "rating": rating,
        "rating_dot": rating.replace(",", "."),
        "rating_of": rating + " из 5",
        "rating_2gis": rating + " из 5 в 2ГИС",
        "rating_fact": "рейтинг в 2ГИС, " + count,
        "rating_line": "Рейтинг %s · %s" % (rating, count),
        "count": count,
        "count_by": "по %d %s" % (n, plural(n, "отзыву", "отзывам", "отзывам")),
    }
    for k in ("instagram", "tiktok", "gis", "gisReviews", "booking"):
        v[k] = https(get(c, k))
    return v


def fill_contacts(page, v):
    def tag(m):
        t = m.group(0)
        href = re.search(r'\sdata-c-href="(\w+)"', t)
        if href:
            t = re.sub(r'\shref="[^"]*"', lambda _: ' href="%s"' % attr(v[href.group(1)]), t)
        cond = re.search(r'\sdata-c-if="(\w+)"', t)
        if cond:
            t = re.sub(r"\shidden(?=[\s>])", "", t)
            if not v[cond.group(1)]:
                t = t[:-1] + " hidden>"
        return t

    page = re.sub(r'<\w+[^<>]*\sdata-c-(?:href|if)="[^<>]*>', tag, page)
    return re.sub(
        r'(<(\w+)[^<>]*\sdata-c="(\w+)"[^<>]*>)(.*?)(</\2>)',
        lambda m: m.group(1) + esc(v[m.group(3)]) + m.group(5),
        page,
        flags=re.S,
    )


def read_json(path, default=None):
    if default is not None and not os.path.exists(path):
        return default
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    services = read_json(DATA)
    works = read_json(WORKS, {"blocks": []})
    news = read_json(NEWS, {"items": []})
    masters, training = read_json(data_file("masters")), read_json(data_file("training"))
    reviews, contacts = read_json(data_file("reviews")), read_json(data_file("contacts"))
    values = contact_values(contacts, reviews)
    wa = values["wa"]
    with io.open(PAGE, encoding="utf-8") as f:
        page = f.read()
    new = page
    for pattern, body, name in (
        (BLOCK, render(services), "SERVICES"),
        (WORKS_BLOCK, render_works(works), "WORKS"),
        (marker("NEWS"), render_news(news, wa), "NEWS"),
        (marker("TRAINING"), render_training(training, wa), "TRAINING"),
        (marker("MASTERS"), render_masters(masters), "MASTERS"),
        (marker("REVIEWS"), render_reviews(reviews), "REVIEWS"),
        (marker("FAQ"), render_faq(contacts), "FAQ"),
    ):
        m = pattern.search(new)
        if not m:
            sys.exit("render.py: в index.html нет блока %s:START … %s:END" % (name, name))
        new = new[: m.start("body")] + body + new[m.start("tail"):]
    new = fill_contacts(new, values)
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
