"""SQLite-backed library of downloaded areas, routes and photos.

Layout on disk (default ``./data``)::

    data/mtnproj.db        areas / routes / photos tables
    data/photos/<id>_t.jpg thumbnails
    data/photos/<id>.jpg   full size (medium or large)
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS areas (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER,
    name        TEXT NOT NULL,
    lat         REAL,
    lng         REAL,
    is_root     INTEGER NOT NULL DEFAULT 0,
    data        TEXT NOT NULL,
    fetched_at  REAL
);
CREATE INDEX IF NOT EXISTS areas_parent ON areas(parent_id);

CREATE TABLE IF NOT EXISTS routes (
    id          INTEGER PRIMARY KEY,
    area_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    grade       TEXT,
    grade_key   INTEGER,
    types       TEXT,
    stars       REAL,
    votes       INTEGER,
    pitches     INTEGER,
    length_ft   INTEGER,
    sort_order  INTEGER,
    has_detail  INTEGER NOT NULL DEFAULT 0,
    data        TEXT NOT NULL,
    fetched_at  REAL
);
CREATE INDEX IF NOT EXISTS routes_area ON routes(area_id);

CREATE TABLE IF NOT EXISTS photos (
    owner_kind    TEXT NOT NULL,
    owner_id      INTEGER NOT NULL,
    id            INTEGER NOT NULL,
    position      INTEGER NOT NULL,
    title         TEXT,
    stars         REAL,
    remote_thumb  TEXT,
    remote_medium TEXT,
    remote_large  TEXT,
    PRIMARY KEY (owner_kind, owner_id, id)
);
CREATE INDEX IF NOT EXISTS photos_id ON photos(id);
"""

# Prefix for queries over an area's whole subtree; binds the root area id.
SUBTREE = """
WITH RECURSIVE sub(id) AS (
    SELECT ? UNION SELECT a.id FROM areas a JOIN sub ON a.parent_id = sub.id
)
"""

ROUTE_SUMMARY_COLS = (
    "id, area_id, name, grade, grade_key, types, stars, votes, pitches, "
    "length_ft, sort_order, has_detail, json_extract(data, '$.grades') AS grades"
)

CHUNK = 500


def _chunks(items: list, size: int = CHUNK) -> Iterable[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


def _marks(items: list) -> str:
    return ",".join("?" * len(items))


def _route_summary(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "area_id": row["area_id"],
        "name": row["name"],
        "grade": row["grade"],
        "grade_key": row["grade_key"],
        "types": json.loads(row["types"] or "[]"),
        "stars": row["stars"],
        "votes": row["votes"],
        "pitches": row["pitches"],
        "length_ft": row["length_ft"],
        "order": row["sort_order"],
        "has_detail": bool(row["has_detail"]),
        "grades": json.loads(row["grades"] or "{}") if "grades" in row.keys() else {},
    }


class Store:
    def __init__(self, data_dir: str | Path = "data") -> None:
        self.data_dir = Path(data_dir)
        self.photo_dir = self.data_dir / "photos"
        self.photo_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "mtnproj.db"
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            try:
                yield self._conn
                self._conn.commit()
            except Exception:
                self._conn.rollback()
                raise

    def _query(self, sql: str, params: Iterable = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, tuple(params)).fetchall()

    def close(self) -> None:
        self._conn.close()

    # ------------------------------------------------------------------ writes

    def upsert_area(self, area: dict, is_root: bool = False) -> None:
        data = {k: v for k, v in area.items() if k not in ("routes", "photos")}
        with self._tx() as db:
            db.execute(
                """
                INSERT INTO areas (id, parent_id, name, lat, lng, is_root, data, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    parent_id = excluded.parent_id, name = excluded.name,
                    lat = excluded.lat, lng = excluded.lng,
                    is_root = MAX(areas.is_root, excluded.is_root),
                    data = excluded.data, fetched_at = excluded.fetched_at
                """,
                (
                    area["id"], area.get("parent_id"), area["name"], area.get("lat"),
                    area.get("lng"), int(is_root), json.dumps(data), time.time(),
                ),
            )

    def upsert_route_summary(self, area_id: int, route: dict) -> None:
        """Insert/refresh the left-nav summary without clobbering detail data."""
        with self._tx() as db:
            db.execute(
                """
                INSERT INTO routes (id, area_id, name, grade, grade_key, types, stars,
                                    sort_order, data, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    area_id = excluded.area_id, name = excluded.name,
                    sort_order = excluded.sort_order,
                    grade = CASE WHEN routes.has_detail THEN routes.grade ELSE excluded.grade END,
                    grade_key = CASE WHEN routes.has_detail THEN routes.grade_key
                                     ELSE excluded.grade_key END,
                    types = CASE WHEN routes.has_detail THEN routes.types ELSE excluded.types END,
                    stars = CASE WHEN routes.has_detail THEN routes.stars ELSE excluded.stars END,
                    data = CASE WHEN routes.has_detail THEN routes.data ELSE excluded.data END
                """,
                (
                    route["id"], area_id, route["name"], route.get("grade"),
                    route.get("grade_key"), json.dumps(route.get("types") or []),
                    route.get("stars"), route.get("order"),
                    json.dumps({**route, "area_id": area_id}), time.time(),
                ),
            )

    def upsert_route_detail(self, route: dict, area_id: int | None = None,
                            order: int | None = None) -> None:
        area_id = area_id or route.get("area_id")
        data = {k: v for k, v in route.items() if k != "photos"}
        data["area_id"] = area_id
        with self._tx() as db:
            db.execute(
                """
                INSERT INTO routes (id, area_id, name, grade, grade_key, types, stars, votes,
                                    pitches, length_ft, sort_order, has_detail, data, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    area_id = excluded.area_id, name = excluded.name,
                    grade = excluded.grade, grade_key = excluded.grade_key,
                    types = excluded.types, stars = excluded.stars, votes = excluded.votes,
                    pitches = excluded.pitches, length_ft = excluded.length_ft,
                    sort_order = COALESCE(excluded.sort_order, routes.sort_order),
                    has_detail = 1, data = excluded.data, fetched_at = excluded.fetched_at
                """,
                (
                    route["id"], area_id, route["name"], route.get("grade"),
                    route.get("grade_key"), json.dumps(route.get("types") or []),
                    route.get("stars"), route.get("votes"), route.get("pitches"),
                    route.get("length_ft"), order, json.dumps(data), time.time(),
                ),
            )

    def set_photos(self, owner_kind: str, owner_id: int, photos: list[dict]) -> None:
        with self._tx() as db:
            db.execute(
                "DELETE FROM photos WHERE owner_kind = ? AND owner_id = ?",
                (owner_kind, owner_id),
            )
            db.executemany(
                """
                INSERT OR IGNORE INTO photos (owner_kind, owner_id, id, position, title, stars,
                                              remote_thumb, remote_medium, remote_large)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (owner_kind, owner_id, p["id"], i, p.get("title"), p.get("stars"),
                     p.get("thumb"), p.get("medium"), p.get("large"))
                    for i, p in enumerate(photos)
                ],
            )

    # -------------------------------------------------------------- photo files

    def photo_path(self, photo_id: int, thumb: bool) -> Path:
        return self.photo_dir / (f"{photo_id}_t.jpg" if thumb else f"{photo_id}.jpg")

    def has_photo_file(self, photo_id: int, thumb: bool) -> bool:
        return self.photo_path(photo_id, thumb).exists()

    def save_photo_file(self, photo_id: int, thumb: bool, content: bytes) -> None:
        path = self.photo_path(photo_id, thumb)
        tmp = path.with_suffix(".part")
        tmp.write_bytes(content)
        tmp.replace(path)

    def _photo_dict(self, row: sqlite3.Row) -> dict:
        pid = row["id"]
        has_thumb = self.has_photo_file(pid, True)
        has_full = self.has_photo_file(pid, False)
        return {
            "id": pid,
            "title": row["title"],
            "stars": row["stars"],
            "thumb": f"photos/{pid}_t.jpg" if has_thumb else row["remote_thumb"],
            "full": f"photos/{pid}.jpg" if has_full else row["remote_medium"],
            "offline": has_thumb and has_full,
        }

    # ------------------------------------------------------------------- reads

    def photos(self, owner_kind: str, owner_id: int) -> list[dict]:
        rows = self._query(
            "SELECT * FROM photos WHERE owner_kind = ? AND owner_id = ? ORDER BY position",
            (owner_kind, owner_id),
        )
        return [self._photo_dict(r) for r in rows]

    def descendant_ids(self, area_id: int) -> list[int]:
        """The area and everything below it, depth-first in guidebook order."""
        rows = self._query(
            f"{SUBTREE} SELECT a.id, a.data FROM areas a JOIN sub ON a.id = sub.id",
            (area_id,),
        )
        if not rows:
            return []
        order = {
            r["id"]: [c["id"] for c in json.loads(r["data"]).get("children", [])]
            for r in rows
        }
        out: list[int] = []
        seen: set[int] = set()
        stack = [area_id]
        while stack:
            current = stack.pop()
            if current not in order or current in seen:
                continue
            seen.add(current)
            out.append(current)
            stack.extend(reversed(order[current]))
        return out

    def area_exists(self, area_id: int) -> bool:
        return bool(self._query("SELECT 1 FROM areas WHERE id = ?", (area_id,)))

    def route_needs_detail(self, route_id: int, max_age: float | None) -> bool:
        rows = self._query(
            "SELECT has_detail, fetched_at FROM routes WHERE id = ?", (route_id,)
        )
        if not rows or not rows[0]["has_detail"]:
            return True
        return max_age is not None and time.time() - (rows[0]["fetched_at"] or 0) > max_age

    def get_area(self, area_id: int) -> dict | None:
        rows = self._query("SELECT * FROM areas WHERE id = ?", (area_id,))
        if not rows:
            return None
        row = rows[0]
        area = json.loads(row["data"])
        area["is_root"] = bool(row["is_root"])
        area["fetched_at"] = row["fetched_at"]

        local_children = {
            r["id"] for r in self._query("SELECT id FROM areas WHERE parent_id = ?", (area_id,))
        }
        children = []
        for child in area.get("children", []):
            downloaded = child["id"] in local_children
            children.append({
                **child,
                "downloaded": downloaded,
                "stats": self._subtree_stats(child["id"]) if downloaded else None,
                "cover": self._cover(child["id"]) if downloaded else None,
            })
        area["children"] = children
        area["photos"] = self.photos("area", area_id)
        area["stats"] = self._subtree_stats(area_id)
        area["cover"] = self._cover(area_id)
        return area

    def _subtree_stats(self, area_id: int) -> dict:
        row = self._query(
            f"""
            {SUBTREE}
            SELECT COUNT(*) AS routes, SUM(has_detail) AS detailed
            FROM routes WHERE area_id IN (SELECT id FROM sub)
            """,
            (area_id,),
        )[0]
        areas = self._query(f"{SUBTREE} SELECT COUNT(*) AS n FROM sub", (area_id,))[0]["n"]
        photos = self._query(
            f"""
            {SUBTREE}
            SELECT COUNT(DISTINCT id) AS n FROM photos
            WHERE (owner_kind = 'area' AND owner_id IN (SELECT id FROM sub))
               OR (owner_kind = 'route' AND owner_id IN (
                    SELECT id FROM routes WHERE area_id IN (SELECT id FROM sub)))
            """,
            (area_id,),
        )[0]["n"]
        return {
            "areas": areas,
            "routes": row["routes"] or 0,
            "detailed": row["detailed"] or 0,
            "photos": photos or 0,
        }

    def _cover(self, area_id: int) -> str | None:
        """A representative image for an area: its own photo, else its best route's."""
        queries = (
            ("SELECT * FROM photos WHERE owner_kind = 'area' AND owner_id = ? "
             "ORDER BY position LIMIT 1"),
            f"""
            {SUBTREE}
            SELECT p.* FROM photos p JOIN routes r ON r.id = p.owner_id
            WHERE p.owner_kind = 'route' AND r.area_id IN (SELECT id FROM sub)
            ORDER BY COALESCE(r.stars, 0) DESC, p.position LIMIT 1
            """,
            f"""
            {SUBTREE}
            SELECT * FROM photos WHERE owner_kind = 'area'
            AND owner_id IN (SELECT id FROM sub) ORDER BY position LIMIT 1
            """,
        )
        for sql in queries:
            rows = self._query(sql, (area_id,))
            if rows:
                return self._photo_dict(rows[0])["full"]
        return None

    def area_routes(self, area_id: int) -> list[dict]:
        """Every route under an area (recursively), crag by crag in wall order."""
        ids = self.descendant_ids(area_id)
        names = {
            r["id"]: r["name"]
            for r in self._query(
                f"{SUBTREE} SELECT id, name FROM areas WHERE id IN (SELECT id FROM sub)",
                (area_id,),
            )
        }
        rows = self._query(
            f"""
            {SUBTREE}
            SELECT {ROUTE_SUMMARY_COLS} FROM routes WHERE area_id IN (SELECT id FROM sub)
            """,
            (area_id,),
        )
        thumbs = self._route_thumbs([r["id"] for r in rows])
        routes = []
        for r in rows:
            item = _route_summary(r)
            item["area_name"] = names.get(r["area_id"])
            item["thumb"] = thumbs.get(r["id"])
            routes.append(item)
        order = {aid: i for i, aid in enumerate(ids)}
        routes.sort(key=lambda r: (order.get(r["area_id"], 0), r["order"] or 0))
        return routes

    def _route_thumbs(self, route_ids: list[int]) -> dict[int, str]:
        thumbs: dict[int, str] = {}
        for chunk in _chunks(route_ids):
            for row in self._query(
                f"""
                SELECT * FROM photos WHERE owner_kind = 'route' AND position = 0
                AND owner_id IN ({_marks(chunk)})
                """,
                chunk,
            ):
                thumbs[row["owner_id"]] = self._photo_dict(row)["thumb"]
        return thumbs

    def get_route(self, route_id: int) -> dict | None:
        rows = self._query("SELECT * FROM routes WHERE id = ?", (route_id,))
        if not rows:
            return None
        row = rows[0]
        route = json.loads(row["data"])
        route.update(_route_summary(row))
        route["photos"] = self.photos("route", route_id)
        area_rows = self._query("SELECT data FROM areas WHERE id = ?", (row["area_id"],))
        if area_rows:
            area = json.loads(area_rows[0]["data"])
            if not route.get("breadcrumbs"):
                route["breadcrumbs"] = area.get("breadcrumbs", []) + [
                    {"id": area["id"], "name": area["name"]}
                ]
            route["area_name"] = area["name"]
        siblings = [
            {"id": r["id"], "name": r["name"], "grade": r["grade"]}
            for r in self._query(
                "SELECT id, name, grade FROM routes WHERE area_id = ? ORDER BY sort_order, id",
                (row["area_id"],),
            )
        ]
        idx = next((i for i, s in enumerate(siblings) if s["id"] == route_id), None)
        route["prev"] = siblings[idx - 1] if idx else None
        route["next"] = siblings[idx + 1] if idx is not None and idx + 1 < len(siblings) else None
        route["position"] = {"index": (idx or 0) + 1, "of": len(siblings)}
        return route

    def library(self) -> list[dict]:
        out = []
        for r in self._query(
            "SELECT id, name, data, fetched_at FROM areas WHERE is_root = 1 ORDER BY name"
        ):
            data = json.loads(r["data"])
            out.append({
                "id": r["id"],
                "name": r["name"],
                "breadcrumbs": data.get("breadcrumbs", []),
                "fetched_at": r["fetched_at"],
                "stats": self._subtree_stats(r["id"]),
                "cover": self._cover(r["id"]),
            })
        return out

    def search_index(self) -> dict:
        areas = [
            {"id": r["id"], "name": r["name"], "parent_id": r["parent_id"]}
            for r in self._query("SELECT id, name, parent_id FROM areas")
        ]
        area_names = {a["id"]: a["name"] for a in areas}
        routes = [
            {
                "id": r["id"], "name": r["name"], "grade": r["grade"],
                "grade_key": r["grade_key"], "types": json.loads(r["types"] or "[]"),
                "stars": r["stars"], "area_id": r["area_id"],
                "area_name": area_names.get(r["area_id"]),
                "grades": json.loads(r["grades"] or "{}"),
            }
            for r in self._query(
                "SELECT id, name, grade, grade_key, types, stars, area_id, "
                "json_extract(data, '$.grades') AS grades FROM routes"
            )
        ]
        return {"areas": areas, "routes": routes}

    def all_area_ids(self) -> list[int]:
        return [r["id"] for r in self._query("SELECT id FROM areas")]

    def all_route_ids(self, area_ids: list[int] | None = None) -> list[int]:
        if area_ids is None:
            return [r["id"] for r in self._query("SELECT id FROM routes")]
        ids: list[int] = []
        for chunk in _chunks(area_ids):
            ids.extend(
                r["id"] for r in self._query(
                    f"SELECT id FROM routes WHERE area_id IN ({_marks(chunk)})", chunk
                )
            )
        return ids

    def photo_ids_for(self, area_ids: list[int]) -> list[int]:
        route_ids = self.all_route_ids(area_ids)
        ids: set[int] = set()
        for kind, owners in (("area", area_ids), ("route", route_ids)):
            for chunk in _chunks(owners):
                ids.update(
                    r["id"] for r in self._query(
                        f"SELECT id FROM photos WHERE owner_kind = ? "
                        f"AND owner_id IN ({_marks(chunk)})",
                        [kind, *chunk],
                    )
                )
        return sorted(ids)

    def offline_urls(self, area_id: int) -> list[str]:
        """Every app URL needed to show an area subtree with no network."""
        ids = self.descendant_ids(area_id)
        urls = ["api/library.json", "api/index.json"]
        for aid in ids:
            urls += [f"api/areas/{aid}.json", f"api/areas/{aid}/routes.json"]
        urls += [f"api/routes/{rid}.json" for rid in self.all_route_ids(ids)]
        for pid in self.photo_ids_for(ids):
            for thumb in (True, False):
                if self.has_photo_file(pid, thumb):
                    urls.append(f"photos/{self.photo_path(pid, thumb).name}")
        return urls

    # ------------------------------------------------------------------ delete

    def delete_area(self, area_id: int) -> int:
        """Remove an area subtree and any photo files no longer referenced."""
        ids = [r["id"] for r in self._query(f"{SUBTREE} SELECT id FROM sub", (area_id,))]
        ids = [i for i in ids if self.area_exists(i)]
        route_ids = self.all_route_ids(ids)
        photo_ids = set(self.photo_ids_for(ids))
        with self._tx() as db:
            for kind, owners in (("area", ids), ("route", route_ids)):
                for chunk in _chunks(owners):
                    db.execute(
                        f"DELETE FROM photos WHERE owner_kind = ? AND owner_id IN ({_marks(chunk)})",
                        [kind, *chunk],
                    )
            for table, owners in (("routes", route_ids), ("areas", ids)):
                for chunk in _chunks(owners):
                    db.execute(f"DELETE FROM {table} WHERE id IN ({_marks(chunk)})", chunk)
        still_used = {r["id"] for r in self._query("SELECT DISTINCT id FROM photos")}
        for pid in photo_ids - still_used:
            for thumb in (True, False):
                self.photo_path(pid, thumb).unlink(missing_ok=True)
        return len(ids)
