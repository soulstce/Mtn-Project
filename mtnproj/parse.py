"""Parsers for Mountain Project HTML pages.

All functions take raw HTML and return plain dicts / lists that are JSON
serialisable, so the rest of the app never touches BeautifulSoup.
"""

from __future__ import annotations

import html as htmllib
import re
from urllib.parse import urlparse

from bs4 import BeautifulSoup, Comment, NavigableString, Tag

from .grades import grade_key

AREA_RE = re.compile(r"/area/(\d+)")
ROUTE_RE = re.compile(r"/route/(\d+)")
PHOTO_RE = re.compile(r"/photo/(\d+)")
COORD_RE = re.compile(r"(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)")
NUMBER_RE = re.compile(r"[\d,]+")

ROUTE_TYPES = ["Trad", "Sport", "TR", "Boulder", "Ice", "Aid", "Mixed", "Alpine", "Snow"]
NAV_TYPES = ["Trad", "Sport", "Toprope", "Boulder", "Ice", "Aid", "Mixed", "Alpine"]

# Grade systems MP renders as <span class="rateXXX">.
GRADE_SYSTEMS = {
    "rateYDS": "yds",
    "rateFrench": "french",
    "rateEwbanks": "ewbanks",
    "rateUIAA": "uiaa",
    "rateZA": "za",
    "rateBritish": "british",
    "rateFont": "font",
    "rateHueco": "hueco",
}

_ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a",
    "h3", "h4", "h5", "blockquote", "hr", "table", "tr", "td", "th", "tbody",
}


def _soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


def _text(node: Tag | None) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def _id_from(regex: re.Pattern, href: str | None) -> int | None:
    m = regex.search(href or "")
    return int(m.group(1)) if m else None


def _int(text: str | None) -> int | None:
    m = NUMBER_RE.search(text or "")
    if not m:
        return None
    try:
        return int(m.group(0).replace(",", ""))
    except ValueError:
        return None


def clean_html(node: Tag) -> str:
    """Reduce a user-content block to a small, safe subset of HTML."""
    fragment = _soup(str(node))
    root = fragment.body or fragment
    for bad in root.find_all(["script", "style", "iframe", "img", "form", "button"]):
        bad.decompose()
    for comment in root.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()
    for tag in list(root.find_all(True)):
        if tag.name in ("html", "body"):
            continue
        if tag.name not in _ALLOWED_TAGS:
            tag.unwrap()
            continue
        href = tag.get("href") if tag.name == "a" else None
        tag.attrs = {}
        if href:
            if href.startswith("/"):
                href = "https://www.mountainproject.com" + href
            if urlparse(href).scheme in ("http", "https"):
                tag.attrs = {"href": href, "target": "_blank", "rel": "noopener"}
    inner = root.find("div") if root.name != "div" else root
    out = "".join(str(c) for c in (inner or root).contents)
    return out.strip()


def _stars_from_imgs(container: Tag | None) -> float | None:
    if container is None:
        return None
    total = 0.0
    seen = False
    for img in container.find_all("img"):
        src = img.get("src", "")
        if "star" not in src and "bomb" not in src:
            continue
        seen = True
        if "Half" in src:
            total += 0.5
        elif "bomb" in src or "Empty" in src:
            continue
        else:
            total += 1
    return total if seen else None


def _grades(container: Tag | None) -> dict:
    """Pull every rateXXX span out of a grade container."""
    grades: dict[str, str] = {}
    if container is None:
        return grades
    for span in container.find_all("span", class_=True):
        for cls in span.get("class", []):
            system = GRADE_SYSTEMS.get(cls)
            if system and system not in grades:
                own = "".join(
                    s for s in span.find_all(string=True, recursive=False)
                    if isinstance(s, NavigableString)
                ).strip()
                if own:
                    grades[system] = own
    return grades


def _breadcrumbs(soup: BeautifulSoup) -> list[dict]:
    h1 = soup.find("h1")
    if not h1:
        return []
    crumb_div = None
    for div in h1.find_all_previous("div", class_="text-warm", limit=3):
        if "mb-half" in div.get("class", []):
            crumb_div = div
            break
    crumbs = []
    for a in (crumb_div.find_all("a") if crumb_div else []):
        area_id = _id_from(AREA_RE, a.get("href"))
        if area_id:
            crumbs.append({"id": area_id, "name": _text(a)})
    return crumbs


def _title(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    if not h1:
        return ""
    parts = [
        s.strip() for s in h1.find_all(string=True, recursive=False)
        if isinstance(s, NavigableString) and not isinstance(s, Comment)
    ]
    return re.sub(r"\s+", " ", " ".join(p for p in parts if p)).strip()


def _details_table(soup: BeautifulSoup) -> dict[str, Tag]:
    table = soup.select_one("table.description-details")
    rows: dict[str, Tag] = {}
    if not table:
        return rows
    for tr in table.find_all("tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) >= 2:
            key = _text(tds[0]).rstrip(":").strip().lower()
            rows[key] = tds[1]
    return rows


def _sections(soup: BeautifulSoup) -> list[dict]:
    """Every "<h2>Title</h2><div class=fr-view>" block (Description, Location...)."""
    sections = []
    for view in soup.select("div.fr-view"):
        h2 = view.find_previous("h2")
        if not h2:
            continue
        title = _text(h2)
        if not title or any(s["title"] == title for s in sections):
            continue
        body = clean_html(view)
        if body:
            sections.append({"title": title, "html": body})
    return sections


def photo_urls(src: str) -> dict:
    """Given any MP photo URL, return the thumb / medium / large variants."""
    src = htmllib.unescape(src).split("?")[0]
    m = re.search(r"_(smallMed|medium|large|small|thumb)_", src)
    if not m:
        return {"thumb": src, "medium": src, "large": src}
    size = m.group(1)
    return {
        "thumb": src.replace(f"_{size}_", "_smallMed_"),
        "medium": src.replace(f"_{size}_", "_medium_"),
        "large": src.replace(f"_{size}_", "_large_"),
    }


def _photos(soup: BeautifulSoup) -> list[dict]:
    photos: dict[int, dict] = {}
    for card in soup.select("a.photo-card"):
        photo_id = _id_from(PHOTO_RE, card.get("href"))
        img = card.find("img")
        if not photo_id or photo_id in photos or not img:
            continue
        src = img.get("data-src") or img.get("data-original") or img.get("src")
        if not src or "/assets/photos/" not in src:
            continue
        stars = None
        text_div = card.find_next_sibling("div", class_="card-text")
        if text_div:
            stars = _stars_from_imgs(text_div.find("span", class_="scoreStars"))
        photos[photo_id] = {
            "id": photo_id,
            "title": (img.get("alt") or "").strip(),
            "stars": stars,
            **photo_urls(src),
        }
    if not photos:
        # Fall back to the header carousel, which some pages use exclusively.
        for item in soup.select(".carousel-item"):
            link = item.find("a", class_="photo-link")
            photo_id = _id_from(PHOTO_RE, link.get("href") if link else None)
            src = item.get("data-src")
            if not src:
                m = re.search(r"url\('([^']+)'\)", item.get("style", ""))
                src = m.group(1) if m else None
            if photo_id and src and photo_id not in photos:
                photos[photo_id] = {"id": photo_id, "title": "", "stars": None, **photo_urls(src)}
    return list(photos.values())


def _gps(cell: Tag | None) -> tuple[float | None, float | None]:
    m = COORD_RE.search(_text(cell))
    if not m:
        return None, None
    return float(m.group(1)), float(m.group(2))


def parse_route_type(text: str) -> dict:
    """Parse "Trad, Aid, 3000 ft (909 m), 31 pitches, Grade VI"."""
    out: dict = {"types": [], "length_ft": None, "pitches": None, "commitment": None}
    for part in [p.strip() for p in (text or "").split(",")]:
        if part in ROUTE_TYPES:
            out["types"].append(part)
        elif m := re.match(r"([\d,]+)\s*ft", part):
            out["length_ft"] = int(m.group(1).replace(",", ""))
        elif m := re.match(r"(\d+)\s*pitch", part):
            out["pitches"] = int(m.group(1))
        elif m := re.match(r"Grade\s+([IV]+)", part):
            out["commitment"] = m.group(1)
    return out


def _nav_route_type(span: Tag | None) -> list[str]:
    if span is None:
        return []
    classes = span.get("class", [])
    return [t for t in ROUTE_TYPES if t in classes] or (
        ["TR"] if "Toprope" in classes else []
    )


def parse_area(html: str, area_id: int | None = None) -> dict:
    soup = _soup(html)
    rows = _details_table(soup)
    lat, lng = _gps(rows.get("gps"))
    crumbs = _breadcrumbs(soup)

    if area_id is None:
        link = soup.find("link", rel="canonical")
        area_id = _id_from(AREA_RE, link.get("href") if link else None)

    children = []
    for row in soup.select(".lef-nav-row"):
        a = row.find("a", href=True)
        child_id = _id_from(AREA_RE, a.get("href") if a else None)
        if not child_id:
            continue
        counts = {}
        for t in NAV_TYPES:
            span = row.find("span", class_=f"lef-nav-{t}")
            if span:
                counts[t] = _int(_text(span)) or 0
        total_span = row.select_one("span.text-warm")
        children.append({
            "id": child_id,
            "name": _text(a),
            "total": _int(_text(total_span)) if total_span else None,
            "type_counts": counts,
        })

    routes = []
    for i, tr in enumerate(soup.select("#left-nav-route-table tr")):
        a = tr.find("a", href=ROUTE_RE)
        route_id = _id_from(ROUTE_RE, a.get("href") if a else None)
        if not route_id:
            continue
        type_span = tr.find("span", class_="route-type")
        grades = _grades(type_span)
        types = _nav_route_type(type_span)
        grade = grades.get("yds") or _text(type_span)
        try:
            order = int(tr.get("data-lr", i))
        except ValueError:
            order = i
        routes.append({
            "id": route_id,
            "name": _text(a),
            "grades": grades,
            "grade": grade,
            "grade_key": grade_key(grade, types),
            "types": types,
            "stars": _stars_from_imgs(tr.find("span", class_="scoreStars")),
            "order": order,
        })
    routes.sort(key=lambda r: r["order"])

    total = None
    for h2 in soup.find_all("h2"):
        if "Total Climbs" in _text(h2):
            total = _int(_text(h2))
            break

    # The first value cell is the imperial one ("1,142 ft"); metric follows.
    elevation = _text(rows.get("elevation")) or None

    return {
        "id": area_id,
        "name": _title(soup),
        "breadcrumbs": crumbs,
        "parent_id": crumbs[-1]["id"] if crumbs else None,
        "lat": lat,
        "lng": lng,
        "elevation": elevation,
        "total_climbs": total,
        "sections": _sections(soup),
        "children": children,
        "routes": routes,
        "photos": _photos(soup),
    }


def parse_route(html: str, route_id: int | None = None) -> dict:
    soup = _soup(html)
    rows = _details_table(soup)
    crumbs = _breadcrumbs(soup)

    if route_id is None:
        link = soup.find("link", rel="canonical")
        route_id = _id_from(ROUTE_RE, link.get("href") if link else None)

    h1 = soup.find("h1")
    grade_h2 = h1.find_next("h2") if h1 else None
    grades = _grades(grade_h2)
    extra = ""
    if grade_h2 is not None:
        extra = " ".join(
            s.strip() for s in grade_h2.find_all(string=True, recursive=False)
            if isinstance(s, NavigableString) and not isinstance(s, Comment) and s.strip()
        )
    type_info = parse_route_type(_text(rows.get("type")))
    grade = grades.get("yds") or extra
    if extra and grades.get("yds"):
        grade = f"{grades['yds']} {extra}"

    avg = votes = None
    star_span = soup.select_one("#route-star-avg")
    if star_span:
        m = re.search(r"Avg:\s*([\d.]+)\s*from\s*([\d,]+)", _text(star_span))
        if m:
            avg = float(m.group(1))
            votes = int(m.group(2).replace(",", ""))
        elif (s := _stars_from_imgs(star_span)) is not None:
            avg = s
    lat, lng = _gps(rows.get("gps"))

    return {
        "id": route_id,
        "name": _title(soup),
        "breadcrumbs": crumbs,
        "area_id": crumbs[-1]["id"] if crumbs else None,
        "grades": grades,
        "grade": grade.strip(),
        "grade_extra": extra or None,
        "grade_key": grade_key(grade, type_info["types"]),
        **type_info,
        "stars": avg,
        "votes": votes,
        "fa": _text(rows.get("fa")) or None,
        "lat": lat,
        "lng": lng,
        "sections": _sections(soup),
        "photos": _photos(soup),
    }


def parse_route_guide(html: str) -> list[dict]:
    """Top level regions (US states + International) from /route-guide."""
    soup = _soup(html)
    seen: dict[int, dict] = {}
    for strong in soup.select("strong"):
        a = strong.find("a", href=AREA_RE)
        area_id = _id_from(AREA_RE, a.get("href") if a else None)
        if not area_id or area_id in seen:
            continue
        total = None
        box = a.find_parent("div", class_="clearfix")
        if box and (num := box.find("small", class_="number")):
            total = _int(_text(num))
        seen[area_id] = {"id": area_id, "name": _text(a), "total": total}
    return list(seen.values())


def parse_search(payload: dict) -> list[dict]:
    """Parse the JSON returned by /ajax/public/search/suggestions."""
    soup = _soup(payload.get("html", ""))
    results = []
    for a in soup.select("a.suggestion"):
        href = a.get("href", "")
        area_id = _id_from(AREA_RE, href)
        route_id = _id_from(ROUTE_RE, href)
        if not (area_id or route_id):
            continue
        location = _text(a.find("div", class_="right-text"))
        difficulty = _text(a.find("div", class_="route-difficulty"))
        name = " ".join(
            s.strip() for s in a.find_all(string=True, recursive=False) if s.strip()
        )
        results.append({
            "kind": "route" if route_id else "area",
            "id": route_id or area_id,
            "name": name,
            "location": location,
            "grade": difficulty or None,
        })
    return results
