from mtnproj.downloader import Downloader, DownloadOptions, Job


def run(store, client, target=100, kind="area", **opts):
    job = Job(id=1, target_id=target, kind=kind, options=DownloadOptions(**opts))
    return Downloader(store, client).run(job)


def test_full_download(store, client):
    job = run(store, client)
    assert job.status == "done"
    assert job.name == "Test Gorge"
    # Boulder Field 404s: recorded, but the rest of the tree still downloads.
    assert job.areas_done == job.areas_total == 3
    assert any("Area 300" in e for e in job.errors)
    assert job.routes_done == job.routes_total == 3

    lib = store.library()
    assert [a["name"] for a in lib] == ["Test Gorge"]
    assert lib[0]["stats"]["routes"] == 3
    assert lib[0]["stats"]["detailed"] == 3

    routes = store.area_routes(100)
    assert [r["name"] for r in routes] == ["Sun Dance", "Moon Shadow", "Crack Attack"]
    assert routes[0]["pitches"] == 2
    assert routes[0]["area_name"] == "Sunny Wall"

    # Photo files: area photo + two route photos, thumb and full each.
    assert store.has_photo_file(9001, thumb=True)
    assert store.has_photo_file(9101, thumb=False)
    assert routes[0]["thumb"] == "photos/9101_t.jpg"


def test_quick_download_skips_route_pages(store, client):
    job = run(store, client, route_details=False, photos=False)
    assert job.status == "done"
    assert not any(r.startswith("route/") for r in client.requests)
    assert not any(r.startswith("http") for r in client.requests)
    route = store.get_route(1001)
    assert route["has_detail"] is False
    assert route["grade"] == "5.11b"
    assert route["stars"] == 3.5


def test_depth_limit(store, client):
    job = run(store, client, max_depth=0, route_details=False)
    assert job.areas_total == 1
    assert store.area_exists(100)
    assert not store.area_exists(200)


def test_redownload_reuses_cached_route_pages(store, client):
    run(store, client, photos=False)
    client.requests.clear()
    run(store, client, photos=False)
    assert not any(r.startswith("route/") for r in client.requests)
    # ... unless a refresh is requested.
    run(store, client, photos=False, refresh_days=0)
    assert any(r.startswith("route/") for r in client.requests)


def test_route_target_downloads_its_crag(store, client):
    job = run(store, client, target=1001, kind="route")
    assert job.status == "done"
    assert job.root_area_id == 200
    assert store.library()[0]["name"] == "Sunny Wall"


def test_cancel(store, client):
    job = Job(id=1, target_id=100)
    job.cancel_event.set()
    Downloader(store, client).run(job)
    assert job.status == "cancelled"


def test_job_to_dict_is_json_safe(store, client):
    import json

    job = run(store, client, route_details=False)
    data = job.to_dict()
    assert "cancel_event" not in data
    assert data["options"]["route_details"] is False
    json.dumps(data)
