"""Crawl an area (and everything under it) into the local library."""

from __future__ import annotations

import itertools
import queue
import threading
import time
import traceback
from collections import deque
from dataclasses import asdict, dataclass, field, fields

from .http import FetchError, MPClient
from .parse import parse_area, parse_route
from .store import Store


@dataclass
class DownloadOptions:
    photos: bool = True
    route_details: bool = True
    max_depth: int | None = None       # None = the whole tree
    max_photos: int = 12               # per area / route page
    photo_size: str = "medium"         # "medium" (~100KB) or "large" (~400KB)
    refresh_days: float | None = None  # re-fetch route pages older than this


@dataclass
class Job:
    id: int
    target_id: int
    kind: str = "area"                 # "area" or "route"
    options: DownloadOptions = field(default_factory=DownloadOptions)
    name: str | None = None
    status: str = "queued"             # queued | running | done | error | cancelled
    created: float = field(default_factory=time.time)
    started: float | None = None
    finished: float | None = None
    root_area_id: int | None = None
    areas_done: int = 0
    areas_total: int = 0
    routes_done: int = 0
    routes_total: int = 0
    photos_done: int = 0
    photos_total: int = 0
    current: str | None = None
    errors: list[str] = field(default_factory=list)
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)

    def to_dict(self) -> dict:
        # asdict() would try to deep-copy the Event's lock, so go field by field.
        data = {f.name: getattr(self, f.name) for f in fields(self) if f.name != "cancel_event"}
        data["options"] = asdict(self.options)
        data["errors"] = self.errors[-20:]
        data["error_count"] = len(self.errors)
        return data


class Cancelled(Exception):
    pass


class Downloader:
    """Runs download jobs one at a time on a background thread.

    Jobs are serialised on purpose: they share one polite rate limit.
    """

    def __init__(self, store: Store, client: MPClient | None = None) -> None:
        self.store = store
        self.client = client or MPClient()
        self.jobs: dict[int, Job] = {}
        self._ids = itertools.count(1)
        self._queue: queue.Queue[Job] = queue.Queue()
        self._worker: threading.Thread | None = None
        self._lock = threading.Lock()

    # ----------------------------------------------------------- job control

    def submit(self, target_id: int, kind: str = "area",
               options: DownloadOptions | None = None, name: str | None = None) -> Job:
        job = Job(id=next(self._ids), target_id=target_id, kind=kind,
                  options=options or DownloadOptions(), name=name)
        self.jobs[job.id] = job
        self._queue.put(job)
        with self._lock:
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._loop, daemon=True)
                self._worker.start()
        return job

    def cancel(self, job_id: int) -> Job | None:
        job = self.jobs.get(job_id)
        if job and job.status in ("queued", "running"):
            job.cancel_event.set()
            if job.status == "queued":
                job.status = "cancelled"
                job.finished = time.time()
        return job

    def active(self) -> bool:
        return any(j.status in ("queued", "running") for j in self.jobs.values())

    def _loop(self) -> None:
        while True:
            try:
                job = self._queue.get(timeout=5)
            except queue.Empty:
                return
            if job.status == "queued":
                self.run(job)

    # ------------------------------------------------------------- crawling

    def run(self, job: Job) -> Job:
        job.status = "running"
        job.started = time.time()
        try:
            root_id = job.target_id
            if job.kind == "route":
                route = parse_route(self.client.route_html(job.target_id), job.target_id)
                if not route.get("area_id"):
                    raise FetchError("Could not find the area for this route")
                root_id = route["area_id"]
                job.options.max_depth = 0
            job.root_area_id = root_id
            self._crawl(job, root_id)
        except Cancelled:
            job.status = "cancelled"
        except Exception as exc:  # noqa: BLE001 - surface anything to the UI
            job.errors.append(f"{type(exc).__name__}: {exc}")
            job.status = "error"
            traceback.print_exc()
        else:
            job.status = "done"
        job.current = None
        job.finished = time.time()
        return job

    def _check(self, job: Job) -> None:
        if job.cancel_event.is_set():
            raise Cancelled()

    def _crawl(self, job: Job, root_id: int) -> None:
        opts = job.options
        pending: deque[tuple[int, int]] = deque([(root_id, 0)])
        job.areas_total = 1
        while pending:
            self._check(job)
            area_id, depth = pending.popleft()
            job.current = f"Area {area_id}"
            try:
                area = parse_area(self.client.area_html(area_id), area_id)
            except FetchError as exc:
                job.errors.append(f"Area {area_id}: {exc}")
                job.areas_done += 1
                if area_id == root_id:
                    raise
                continue
            if area_id == root_id and not job.name:
                job.name = area["name"]
            job.current = area["name"]
            self.store.upsert_area(area, is_root=(area_id == root_id))

            for route in area["routes"]:
                self.store.upsert_route_summary(area_id, route)
            photos = area["photos"][: opts.max_photos]
            self.store.set_photos("area", area_id, photos)
            self._download_photos(job, photos)

            if opts.max_depth is None or depth < opts.max_depth:
                for child in area["children"]:
                    pending.append((child["id"], depth + 1))
                    job.areas_total += 1

            if opts.route_details:
                self._fetch_routes(job, area)
            else:
                job.routes_total += len(area["routes"])
                job.routes_done += len(area["routes"])
            job.areas_done += 1

    def _fetch_routes(self, job: Job, area: dict) -> None:
        opts = job.options
        max_age = opts.refresh_days * 86400 if opts.refresh_days is not None else None
        job.routes_total += len(area["routes"])
        for summary in area["routes"]:
            self._check(job)
            if not self.store.route_needs_detail(summary["id"], max_age):
                job.routes_done += 1
                continue
            job.current = f"{area['name']} › {summary['name']}"
            try:
                route = parse_route(self.client.route_html(summary["id"]), summary["id"])
            except FetchError as exc:
                job.errors.append(f"Route {summary['name']}: {exc}")
                job.routes_done += 1
                continue
            if not route.get("grade"):
                route["grade"] = summary.get("grade")
                route["grade_key"] = summary.get("grade_key")
            if not route.get("types"):
                route["types"] = summary.get("types")
            self.store.upsert_route_detail(route, area["id"], summary.get("order"))
            photos = route["photos"][: opts.max_photos]
            self.store.set_photos("route", route["id"], photos)
            self._download_photos(job, photos)
            job.routes_done += 1

    def _download_photos(self, job: Job, photos: list[dict]) -> None:
        if not job.options.photos:
            return
        full_key = "large" if job.options.photo_size == "large" else "medium"
        job.photos_total += len(photos)
        for photo in photos:
            self._check(job)
            for thumb, url in ((True, photo.get("thumb")), (False, photo.get(full_key))):
                if not url or self.store.has_photo_file(photo["id"], thumb):
                    continue
                try:
                    self.store.save_photo_file(photo["id"], thumb, self.client.get_bytes(url))
                except FetchError as exc:
                    if not thumb and full_key == "large" and photo.get("medium"):
                        # Older photos sometimes have no large rendition.
                        try:
                            self.store.save_photo_file(
                                photo["id"], False, self.client.get_bytes(photo["medium"])
                            )
                            continue
                        except FetchError:
                            pass
                    job.errors.append(f"Photo {photo['id']}: {exc}")
            job.photos_done += 1
