from pathlib import Path

import pytest

from mtnproj.http import FetchError
from mtnproj.store import Store

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


class FakeClient:
    """Stands in for MPClient: serves fixture pages, never touches the network."""

    def __init__(self) -> None:
        self.areas = {
            100: fixture("area_parent.html"),
            200: fixture("area_leaf.html"),
            # 300 (Boulder Field) is deliberately missing -> FetchError
        }
        route = fixture("route.html")
        self.routes = {
            1001: route,
            1002: route.replace("Sun Dance", "Moon Shadow"),
            1003: route.replace("Sun Dance", "Crack Attack"),
        }
        self.requests: list[str] = []

    def area_html(self, area_id: int) -> str:
        self.requests.append(f"area/{area_id}")
        if area_id not in self.areas:
            raise FetchError(f"Not found: /area/{area_id}")
        return self.areas[area_id]

    def route_html(self, route_id: int) -> str:
        self.requests.append(f"route/{route_id}")
        if route_id not in self.routes:
            raise FetchError(f"Not found: /route/{route_id}")
        return self.routes[route_id]

    def get_bytes(self, url: str) -> bytes:
        self.requests.append(url)
        return b"\xff\xd8fake-jpeg"

    def route_guide_html(self) -> str:
        return fixture("route_guide.html")

    def search_suggestions(self, query: str) -> dict:
        return {
            "html": (
                '<a class="suggestion" href="https://www.mountainproject.com/area/100/test-gorge'
                '?search=1">Test Gorge <div class="right-text">Kentucky</div></a>'
                '<a class="suggestion route" href="https://www.mountainproject.com/route/1001/'
                'sun-dance">Sun Dance <div class="route-difficulty">5.11b</div>'
                '<div class="right-text">Kentucky</div></a>'
            )
        }


@pytest.fixture
def client() -> FakeClient:
    return FakeClient()


@pytest.fixture
def store(tmp_path) -> Store:
    s = Store(tmp_path / "data")
    yield s
    s.close()
