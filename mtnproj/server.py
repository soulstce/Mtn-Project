"""FastAPI app: serves the web app, the local library, and download jobs.

Library endpoints end in ``.json`` on purpose: ``mtnproj export`` writes the
exact same paths as static files, so the front end runs unchanged from a
plain static host (and therefore installs as an offline PWA on a phone).
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .downloader import Downloader, DownloadOptions
from .http import FetchError, MPClient
from .parse import AREA_RE, ROUTE_RE, parse_area, parse_route, parse_route_guide, parse_search
from .store import Store

WEB_DIR = Path(__file__).resolve().parent.parent / "web"


class DownloadRequest(BaseModel):
    url: str | None = None
    id: int | None = None
    kind: str = "area"
    photos: bool = True
    route_details: bool = True
    max_depth: int | None = None
    max_photos: int = 12
    photo_size: str = "medium"
    refresh_days: float | None = None


class _TTLCache:
    def __init__(self, ttl: float = 3600, size: int = 256) -> None:
        self.ttl, self.size = ttl, size
        self._data: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            hit = self._data.get(key)
            if hit and time.time() - hit[0] < self.ttl:
                return hit[1]
            return None

    def put(self, key: str, value) -> None:
        with self._lock:
            if len(self._data) >= self.size:
                oldest = min(self._data, key=lambda k: self._data[k][0])
                del self._data[oldest]
            self._data[key] = (time.time(), value)


def create_app(data_dir: str | Path = "data", client: MPClient | None = None) -> FastAPI:
    store = Store(data_dir)
    downloader = Downloader(store, client or MPClient())
    browse_client = client or MPClient(delay=0.5)
    cache = _TTLCache()

    app = FastAPI(title="Mtn Project Offline", version=__version__)
    app.state.store = store
    app.state.downloader = downloader

    def not_found(what: str):
        raise HTTPException(status_code=404, detail=f"{what} not downloaded")

    # ---------------------------------------------------------------- library

    @app.get("/api/status.json")
    def status():
        return {"mode": "server", "version": __version__, "downloading": downloader.active()}

    @app.get("/api/library.json")
    def library():
        return {"areas": store.library()}

    @app.get("/api/index.json")
    def index():
        return store.search_index()

    @app.get("/api/areas/{area_id:int}.json")
    def area(area_id: int):
        return store.get_area(area_id) or not_found("Area")

    @app.get("/api/areas/{area_id:int}/routes.json")
    def area_routes(area_id: int):
        if not store.area_exists(area_id):
            not_found("Area")
        return {"area_id": area_id, "routes": store.area_routes(area_id)}

    @app.get("/api/routes/{route_id:int}.json")
    def route(route_id: int):
        return store.get_route(route_id) or not_found("Route")

    @app.get("/api/offline/{area_id:int}.json")
    def offline(area_id: int):
        if not store.area_exists(area_id):
            not_found("Area")
        return {"area_id": area_id, "urls": store.offline_urls(area_id)}

    @app.delete("/api/areas/{area_id:int}")
    def delete_area(area_id: int):
        if not store.area_exists(area_id):
            not_found("Area")
        return {"deleted_areas": store.delete_area(area_id)}

    # ---------------------------------------------------- live Mountain Project

    def remote(key: str, fn):
        hit = cache.get(key)
        if hit is not None:
            return hit
        try:
            value = fn()
        except FetchError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        cache.put(key, value)
        return value

    @app.get("/api/remote/search")
    def remote_search(q: str):
        q = q.strip()
        if len(q) < 2:
            return {"results": []}
        return {"results": remote(
            f"search:{q.lower()}",
            lambda: parse_search(browse_client.search_suggestions(q)),
        )}

    @app.get("/api/remote/guide")
    def remote_guide():
        return {"areas": remote(
            "guide", lambda: parse_route_guide(browse_client.route_guide_html())
        )}

    @app.get("/api/remote/area/{area_id:int}")
    def remote_area(area_id: int):
        data = remote(f"area:{area_id}",
                      lambda: parse_area(browse_client.area_html(area_id), area_id))
        return {**data, "downloaded": store.area_exists(area_id)}

    @app.get("/api/remote/route/{route_id:int}")
    def remote_route(route_id: int):
        return remote(f"route:{route_id}",
                      lambda: parse_route(browse_client.route_html(route_id), route_id))

    # -------------------------------------------------------------- downloads

    @app.get("/api/downloads")
    def list_downloads():
        jobs = sorted(downloader.jobs.values(), key=lambda j: j.created, reverse=True)
        return {"jobs": [j.to_dict() for j in jobs]}

    @app.post("/api/downloads")
    def start_download(req: DownloadRequest):
        kind, target = req.kind, req.id
        if req.url:
            if m := ROUTE_RE.search(req.url):
                kind, target = "route", int(m.group(1))
            elif m := AREA_RE.search(req.url):
                kind, target = "area", int(m.group(1))
        if not target or kind not in ("area", "route"):
            raise HTTPException(400, "Give a Mountain Project area/route URL or id")
        options = DownloadOptions(
            photos=req.photos,
            route_details=req.route_details,
            max_depth=req.max_depth,
            max_photos=max(0, min(req.max_photos, 50)),
            photo_size="large" if req.photo_size == "large" else "medium",
            refresh_days=req.refresh_days,
        )
        return downloader.submit(target, kind, options).to_dict()

    @app.post("/api/downloads/{job_id:int}/cancel")
    def cancel_download(job_id: int):
        job = downloader.cancel(job_id)
        if not job:
            raise HTTPException(404, "No such job")
        return job.to_dict()

    # ----------------------------------------------------------------- static

    app.mount("/photos", StaticFiles(directory=store.photo_dir), name="photos")

    @app.get("/sw.js")
    def service_worker():
        # Served from the root so its scope covers the whole app.
        return FileResponse(WEB_DIR / "sw.js", media_type="text/javascript",
                            headers={"Cache-Control": "no-cache"})

    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
    return app
