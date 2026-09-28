"""Turn climbing grade strings into sortable numbers.

Each discipline lives in its own numeric band so a single sort key can order
a mixed list sensibly (all rock routes, then boulders, then ice, ...):

    rock (YDS)   1000 - 2599
    boulder (V)  20000+
    ice (WI/AI)  30000+
    mixed (M)    50000+
    aid (A/C)    70000+
    snow         80000+
"""

from __future__ import annotations

import re

ROCK, BOULDER, ICE, MIXED, AID, SNOW = 1000, 20000, 30000, 50000, 70000, 80000

_YDS = re.compile(r"5\.(\d{1,2})([abcd](?:/[abcd])?)?([+-])?")
_V = re.compile(r"\bV\s*(B|-?easy|\d{1,2})\s*(?:-(\d{1,2}))?\s*([+-])?", re.I)
_ICE = re.compile(r"\b[WA]I\s*(\d)\s*([+-])?", re.I)
_MIXED = re.compile(r"\bM\s*(\d{1,2})\s*([+-])?", re.I)
_AID = re.compile(r"\b([AC])\s*(\d)\s*([+-])?", re.I)
_CLASS = re.compile(r"\b(3rd|4th|easy 5th)\b", re.I)

_LETTER = {"a": 0, "b": 25, "c": 50, "d": 75}


def _plus_minus(sign: str | None, step: int) -> int:
    if sign == "+":
        return step
    if sign == "-":
        return -step
    return 0


def yds_key(grade: str) -> int | None:
    m = _YDS.search(grade or "")
    if m:
        num, letters, sign = int(m.group(1)), (m.group(2) or "").lower(), m.group(3)
        key = ROCK + num * 100
        if letters:
            parts = [_LETTER[c] for c in letters.split("/")]
            key += sum(parts) // len(parts)
        elif num >= 10:
            # "5.10-" ~ a/b, "5.10" ~ b/c, "5.10+" ~ c/d
            key += 37 + _plus_minus(sign, 25)
        else:
            key += _plus_minus(sign, 30)
        return key
    m = _CLASS.search(grade or "")
    if m:
        return {"3rd": ROCK - 300, "4th": ROCK - 200, "easy 5th": ROCK - 100}[m.group(1).lower()]
    return None


def boulder_key(grade: str) -> int | None:
    m = _V.search(grade or "")
    if not m:
        return None
    raw = m.group(1).lower()
    low = -1 if raw in ("b", "easy", "-easy") else int(raw)
    key = BOULDER + low * 100
    if m.group(2):  # range such as V4-5
        key += 50
    return key + _plus_minus(m.group(3), 25)


def _simple(regex: re.Pattern, base: int, grade: str, group: int = 1) -> int | None:
    m = regex.search(grade or "")
    if not m:
        return None
    return base + int(m.group(group)) * 100 + _plus_minus(m.groups()[-1], 25)


def grade_key(grade: str | None, types: list[str] | None = None) -> int | None:
    """Best-effort sort key for a grade string, or None if unrecognised."""
    if not grade:
        return None
    types = [t.lower() for t in (types or [])]
    if "boulder" in types:
        return boulder_key(grade) or yds_key(grade)
    for fn in (
        yds_key,
        boulder_key,
        lambda g: _simple(_ICE, ICE, g),
        lambda g: _simple(_MIXED, MIXED, g),
        lambda g: _simple(_AID, AID, g, 2),
    ):
        key = fn(grade)
        if key is not None:
            return key
    if "snow" in types or "easy snow" in grade.lower():
        return SNOW
    return None


def discipline(key: int | None) -> str | None:
    if key is None:
        return None
    if key < BOULDER:
        return "rock"
    if key < ICE:
        return "boulder"
    if key < MIXED:
        return "ice"
    if key < AID:
        return "mixed"
    if key < SNOW:
        return "aid"
    return "snow"
