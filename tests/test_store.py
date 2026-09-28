from mtnproj.downloader import Downloader, DownloadOptions, Job


def populate(store, client):
    Downloader(store, client).run(Job(id=1, target_id=100, options=DownloadOptions()))


def test_get_area_marks_downloaded_children(store, client):
    populate(store, client)
    area = store.get_area(100)
    children = {c["name"]: c for c in area["children"]}
    assert children["Sunny Wall"]["downloaded"] is True
    assert children["Sunny Wall"]["stats"]["routes"] == 3
    assert children["Boulder Field"]["downloaded"] is False
    assert area["cover"] == "photos/9001.jpg"
    assert area["photos"][0]["offline"] is True


def test_route_neighbours_follow_wall_order(store, client):
    populate(store, client)
    middle = store.get_route(1002)
    assert middle["prev"]["name"] == "Sun Dance"
    assert middle["next"]["name"] == "Crack Attack"
    assert middle["position"] == {"index": 2, "of": 3}
    first = store.get_route(1001)
    assert first["prev"] is None


def test_summary_does_not_clobber_details(store, client):
    populate(store, client)
    store.upsert_route_summary(200, {"id": 1001, "name": "Sun Dance", "grade": "5.8",
                                     "grade_key": 1800, "types": ["Trad"], "stars": 1, "order": 0})
    route = store.get_route(1001)
    assert route["grade"] == "5.11b PG13"
    assert route["types"] == ["Sport"]
    assert route["sections"]


def test_search_index(store, client):
    populate(store, client)
    index = store.search_index()
    assert {a["name"] for a in index["areas"]} == {"Test Gorge", "Sunny Wall"}
    sun = next(r for r in index["routes"] if r["id"] == 1001)
    assert sun["area_name"] == "Sunny Wall"
    assert sun["grades"]["french"] == "6c"


def test_offline_urls(store, client):
    populate(store, client)
    urls = store.offline_urls(100)
    assert "api/areas/200/routes.json" in urls
    assert "api/routes/1003.json" in urls
    assert "photos/9101_t.jpg" in urls


def test_delete_removes_subtree_and_photos(store, client):
    populate(store, client)
    assert store.delete_area(100) == 2
    assert store.library() == []
    assert store.get_route(1001) is None
    assert not store.has_photo_file(9001, thumb=True)
