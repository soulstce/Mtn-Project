"""Write the library + web app out as a self-contained static site.

Host the output folder anywhere that serves HTTPS (GitHub Pages, Netlify,
Vercel, Cloudflare Pages...) and open it on a phone: it installs as an app
and each area can be saved for offline use.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from . import __version__
from .store import Store

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def _write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))


def export_static(store: Store, out_dir: str | Path, area_ids: list[int] | None = None) -> dict:
    """Export the whole library (or only the given root areas) to ``out_dir``."""
    out = Path(out_dir)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(WEB_DIR, out)

    library = store.library()
    if area_ids:
        library = [a for a in library if a["id"] in area_ids]
    keep: list[int] = []
    for root in library:
        keep += [i for i in store.descendant_ids(root["id"]) if i not in keep]

    api = out / "api"
    _write(api / "status.json", {"mode": "static", "version": __version__})
    _write(api / "library.json", {"areas": library})

    index = store.search_index()
    keep_set = set(keep)
    index["areas"] = [a for a in index["areas"] if a["id"] in keep_set]
    index["routes"] = [r for r in index["routes"] if r["area_id"] in keep_set]
    _write(api / "index.json", index)

    for area_id in keep:
        _write(api / "areas" / f"{area_id}.json", store.get_area(area_id))
        _write(api / "areas" / str(area_id) / "routes.json",
               {"area_id": area_id, "routes": store.area_routes(area_id)})
        _write(api / "offline" / f"{area_id}.json",
               {"area_id": area_id, "urls": store.offline_urls(area_id)})

    route_ids = store.all_route_ids(keep)
    for route_id in route_ids:
        _write(api / "routes" / f"{route_id}.json", store.get_route(route_id))

    photos = out / "photos"
    photos.mkdir(exist_ok=True)
    copied = 0
    for pid in store.photo_ids_for(keep):
        for thumb in (True, False):
            src = store.photo_path(pid, thumb)
            if src.exists():
                shutil.copy2(src, photos / src.name)
                copied += 1

    return {"areas": len(keep), "routes": len(route_ids), "photos": copied, "out": str(out)}
