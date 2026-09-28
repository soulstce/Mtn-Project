import json
import time

import pytest
from fastapi.testclient import TestClient

from mtnproj.export import export_static
from mtnproj.server import create_app


@pytest.fixture
def app(tmp_path, client):
    return create_app(tmp_path / "data", client)


@pytest.fixture
def http(app):
    with TestClient(app) as c:
        yield c


def wait_for_jobs(http, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        jobs = http.get("/api/downloads").json()["jobs"]
        if jobs and all(j["status"] not in ("queued", "running") for j in jobs):
            return jobs
        time.sleep(0.05)
    raise AssertionError("download did not finish")


def test_download_then_browse(http):
    assert http.get("/api/status.json").json()["mode"] == "server"
    assert http.get("/api/library.json").json() == {"areas": []}

    res = http.post("/api/downloads", json={"url": "https://www.mountainproject.com/area/100/x"})
    assert res.status_code == 200
    jobs = wait_for_jobs(http)
    assert jobs[0]["status"] == "done"

    lib = http.get("/api/library.json").json()["areas"]
    assert lib[0]["id"] == 100

    area = http.get("/api/areas/100.json").json()
    assert area["name"] == "Test Gorge"
    routes = http.get("/api/areas/100/routes.json").json()["routes"]
    assert len(routes) == 3
    route = http.get("/api/routes/1001.json").json()
    assert route["fa"] == "A. Climber 1998"
    assert http.get("/photos/9101_t.jpg").status_code == 200
    assert http.get("/api/areas/999.json").status_code == 404

    offline = http.get("/api/offline/100.json").json()["urls"]
    assert "api/routes/1001.json" in offline

    assert http.delete("/api/areas/100").json() == {"deleted_areas": 2}
    assert http.get("/api/library.json").json() == {"areas": []}


def test_download_rejects_bad_target(http):
    assert http.post("/api/downloads", json={"url": "https://example.com"}).status_code == 400


def test_remote_endpoints(http):
    results = http.get("/api/remote/search", params={"q": "sun"}).json()["results"]
    assert results[1]["name"] == "Sun Dance"
    area = http.get("/api/remote/area/200").json()
    assert area["downloaded"] is False
    assert len(area["routes"]) == 3
    assert http.get("/api/remote/area/300").status_code == 502
    assert http.get("/api/remote/guide").json()["areas"][0]["name"] == "Alabama"


def test_serves_web_app(http):
    res = http.get("/")
    assert res.status_code == 200
    assert "Crag Offline" in res.text
    assert http.get("/sw.js").headers["content-type"].startswith("text/javascript")


def test_static_export(app, http, tmp_path):
    http.post("/api/downloads", json={"id": 100})
    wait_for_jobs(http)
    out = tmp_path / "site"
    result = export_static(app.state.store, out)
    assert result["routes"] == 3
    assert json.loads((out / "api/status.json").read_text())["mode"] == "static"
    assert (out / "index.html").exists()
    assert (out / "api/areas/200/routes.json").exists()
    assert json.loads((out / "api/routes/1002.json").read_text())["name"] == "Moon Shadow"
    assert (out / "photos/9001.jpg").exists()
