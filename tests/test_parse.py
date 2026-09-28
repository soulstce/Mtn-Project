from mtnproj.parse import (
    parse_area,
    parse_route,
    parse_route_guide,
    parse_route_type,
    parse_search,
    photo_urls,
)

from .conftest import FakeClient, fixture


def test_parent_area():
    area = parse_area(fixture("area_parent.html"))
    assert area["id"] == 100  # from the canonical link
    assert area["name"] == "Test Gorge"
    assert area["breadcrumbs"] == [{"id": 1, "name": "Kentucky"}]
    assert area["parent_id"] == 1
    assert (area["lat"], area["lng"]) == (37.67745, -83.68217)
    assert area["elevation"] == "1,142 ft"
    assert area["total_climbs"] == 4
    assert area["routes"] == []
    assert [c["name"] for c in area["children"]] == ["Sunny Wall", "Boulder Field"]
    assert area["children"][0]["total"] == 3
    assert area["children"][0]["type_counts"]["Sport"] == 2


def test_area_sections_are_sanitised():
    area = parse_area(fixture("area_parent.html"), 100)
    titles = [s["title"] for s in area["sections"]]
    assert titles == ["Description", "Getting There"]
    desc = area["sections"][0]["html"]
    assert "<strong>sandstone</strong>" in desc
    assert 'href="https://www.mountainproject.com/area/200/sunny-wall"' in desc  # absolutised
    assert "script" not in desc and "<img" not in desc
    getting_there = area["sections"][1]["html"]
    assert "javascript:" not in getting_there
    assert "onclick" not in getting_there


def test_area_photos():
    photos = parse_area(fixture("area_parent.html"), 100)["photos"]
    assert len(photos) == 1  # duplicate photo-card anchors collapse
    p = photos[0]
    assert p["id"] == 9001
    assert p["title"] == "Sunrise over the gorge"
    assert p["stars"] == 2.5
    assert p["thumb"].endswith("9001_smallMed_1494156095.jpg")
    assert p["medium"].endswith("9001_medium_1494156095.jpg")
    assert "?" not in p["large"]


def test_leaf_area_routes_in_wall_order():
    area = parse_area(fixture("area_leaf.html"), 200)
    assert area["parent_id"] == 100
    assert [r["name"] for r in area["routes"]] == ["Sun Dance", "Moon Shadow", "Crack Attack"]
    sun, moon, crack = area["routes"]
    assert sun["grade"] == "5.11b"
    assert sun["grades"]["french"] == "6c"
    assert sun["types"] == ["Sport"]
    assert sun["stars"] == 3.5
    assert moon["stars"] == 0  # bomb
    assert crack["types"] == ["Trad"]
    assert crack["grade_key"] < sun["grade_key"] < moon["grade_key"]


def test_route_page():
    route = parse_route(fixture("route.html"), 1001)
    assert route["name"] == "Sun Dance"
    assert route["area_id"] == 200
    assert [c["name"] for c in route["breadcrumbs"]] == ["Kentucky", "Test Gorge", "Sunny Wall"]
    assert route["grades"] == {"yds": "5.11b", "french": "6c", "uiaa": "VIII-"}
    assert route["grade"] == "5.11b PG13"
    assert route["grade_extra"] == "PG13"
    assert route["types"] == ["Sport"]
    assert route["pitches"] == 2
    assert route["length_ft"] == 160
    assert route["commitment"] == "II"
    assert route["stars"] == 3.4
    assert route["votes"] == 1234
    assert route["fa"] == "A. Climber 1998"
    assert [s["title"] for s in route["sections"]] == ["Description", "Location", "Protection"]
    assert "<li>P1: 5.10</li>" in route["sections"][0]["html"]
    assert [p["id"] for p in route["photos"]] == [9101, 9102]


def test_route_type_parsing():
    assert parse_route_type("Trad, Aid, 3000 ft (909 m), 31 pitches, Grade VI") == {
        "types": ["Trad", "Aid"], "length_ft": 3000, "pitches": 31, "commitment": "VI",
    }
    assert parse_route_type("Boulder")["types"] == ["Boulder"]
    assert parse_route_type("")["types"] == []


def test_photo_urls_any_size():
    urls = photo_urls("https://mountainproject.com/assets/photos/climb/1_large_2.jpg?cache=3")
    assert urls["thumb"].endswith("1_smallMed_2.jpg")
    assert urls["medium"].endswith("1_medium_2.jpg")


def test_route_guide():
    regions = parse_route_guide(fixture("route_guide.html"))
    assert regions == [
        {"id": 105905173, "name": "Alabama", "total": 2423},
        {"id": 105907743, "name": "International", "total": 76961},
    ]


def test_search_suggestions():
    results = parse_search(FakeClient().search_suggestions("x"))
    assert results[0] == {"kind": "area", "id": 100, "name": "Test Gorge",
                          "location": "Kentucky", "grade": None}
    assert results[1]["kind"] == "route"
    assert results[1]["grade"] == "5.11b"
