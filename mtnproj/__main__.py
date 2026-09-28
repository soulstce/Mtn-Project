"""Command line interface.

    python -m mtnproj serve                     # run the app at http://localhost:8000
    python -m mtnproj download <area/route URL> # crawl an area into ./data
    python -m mtnproj list                      # what's in the library
    python -m mtnproj export site/              # static, installable offline copy
"""

from __future__ import annotations

import argparse
import sys
import threading
import time

from .downloader import Downloader, DownloadOptions, Job
from .http import MPClient
from .parse import AREA_RE, ROUTE_RE
from .store import Store


def _target(value: str) -> tuple[str, int]:
    if m := ROUTE_RE.search(value):
        return "route", int(m.group(1))
    if m := AREA_RE.search(value):
        return "area", int(m.group(1))
    if value.isdigit():
        return "area", int(value)
    raise SystemExit(f"Not a Mountain Project area/route URL or id: {value}")


def cmd_download(args: argparse.Namespace) -> int:
    store = Store(args.data)
    downloader = Downloader(store, MPClient(delay=args.delay))
    kind, target = _target(args.target)
    options = DownloadOptions(
        photos=not args.no_photos,
        route_details=not args.quick,
        max_depth=args.depth,
        max_photos=args.max_photos,
        photo_size=args.photo_size,
        refresh_days=args.refresh_days,
    )
    job = Job(id=1, target_id=target, kind=kind, options=options)
    # Crawl on a thread so the main thread can print progress and catch Ctrl-C.
    worker = threading.Thread(target=downloader.run, args=(job,), daemon=True)
    try:
        worker.start()
        while worker.is_alive():
            _progress(job)
            worker.join(1.0)
    except KeyboardInterrupt:
        job.cancel_event.set()
        print("\nCancelling…")
        worker.join()
    _progress(job, final=True)
    for err in job.errors[-10:]:
        print("  !", err)
    return 0 if job.status == "done" else 1


def _progress(job, final: bool = False) -> None:
    line = (
        f"[{job.status}] {job.name or job.target_id}: "
        f"areas {job.areas_done}/{job.areas_total}  "
        f"routes {job.routes_done}/{job.routes_total}  "
        f"photos {job.photos_done}/{job.photos_total}"
    )
    if job.current and not final:
        line += f"  · {job.current[:40]}"
    sys.stdout.write("\r" + line.ljust(130)[:130])
    if final:
        sys.stdout.write("\n")
    sys.stdout.flush()


def cmd_list(args: argparse.Namespace) -> int:
    store = Store(args.data)
    library = store.library()
    if not library:
        print("Library is empty. Try: python -m mtnproj download <area URL>")
    for area in library:
        s = area["stats"]
        where = " › ".join(c["name"] for c in area["breadcrumbs"])
        print(f"{area['id']:>10}  {area['name']}  ({where})")
        print(f"            {s['areas']} areas · {s['routes']} routes "
              f"({s['detailed']} with details) · {s['photos']} photos")
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    store = Store(args.data)
    _, area_id = _target(args.target)
    print(f"Deleted {store.delete_area(area_id)} areas")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    from .export import export_static

    store = Store(args.data)
    ids = [_target(t)[1] for t in args.areas] if args.areas else None
    started = time.time()
    result = export_static(store, args.out, ids)
    print(f"Exported {result['areas']} areas, {result['routes']} routes, "
          f"{result['photos']} photo files to {result['out']} "
          f"in {time.time() - started:.1f}s")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .server import create_app

    app = create_app(args.data, MPClient(delay=args.delay))
    print(f"Mtn Project Offline running at http://localhost:{args.port}")
    if args.host == "0.0.0.0":
        print("Reachable from other devices on your network at http://<this-computer-ip>:"
              f"{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mtnproj", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", default="data", help="library folder (default: ./data)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("serve", help="run the web app")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--delay", type=float, default=1.0, help="seconds between page requests")
    p.set_defaults(fn=cmd_serve)

    p = sub.add_parser("download", help="download an area (or a route's crag)")
    p.add_argument("target", help="Mountain Project URL or area id")
    p.add_argument("--depth", type=int, default=None, help="how many sub-area levels (default: all)")
    p.add_argument("--quick", action="store_true",
                   help="skip individual route pages (names/grades/stars only)")
    p.add_argument("--no-photos", action="store_true")
    p.add_argument("--max-photos", type=int, default=12, help="photos per page (default 12)")
    p.add_argument("--photo-size", choices=["medium", "large"], default="medium")
    p.add_argument("--refresh-days", type=float, default=None,
                   help="re-download route pages older than this many days")
    p.add_argument("--delay", type=float, default=1.0, help="seconds between page requests")
    p.set_defaults(fn=cmd_download)

    p = sub.add_parser("list", help="show downloaded areas")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("delete", help="remove an area and its photos")
    p.add_argument("target")
    p.set_defaults(fn=cmd_delete)

    p = sub.add_parser("export", help="write a static offline site")
    p.add_argument("out", help="output folder")
    p.add_argument("areas", nargs="*", help="only these root areas (default: everything)")
    p.set_defaults(fn=cmd_export)

    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
