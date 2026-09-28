"""A small, polite HTTP client for mountainproject.com.

Every request goes through one throttle so a big download never hammers the
site: by default at most one page request per second, with retries and
exponential backoff on 429 / 5xx responses.
"""

from __future__ import annotations

import threading
import time

import requests

BASE_URL = "https://www.mountainproject.com"
USER_AGENT = (
    "Mozilla/5.0 (compatible; MtnProjectOffline/0.1; personal offline guidebook)"
)


class FetchError(RuntimeError):
    pass


class MPClient:
    def __init__(
        self,
        delay: float = 1.0,
        photo_delay: float = 0.2,
        timeout: float = 30.0,
        retries: int = 3,
        session: requests.Session | None = None,
    ) -> None:
        self.delay = delay
        self.photo_delay = photo_delay
        self.timeout = timeout
        self.retries = retries
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", USER_AGENT)
        self._lock = threading.Lock()
        self._last = 0.0

    def _throttle(self, delay: float) -> None:
        with self._lock:
            wait = self._last + delay - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()

    def _request(self, url: str, delay: float, **kwargs) -> requests.Response:
        if url.startswith("/"):
            url = BASE_URL + url
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            self._throttle(delay)
            try:
                resp = self.session.get(url, timeout=self.timeout, **kwargs)
            except requests.RequestException as exc:
                last_error = exc
            else:
                if resp.status_code == 200:
                    return resp
                if resp.status_code == 404:
                    raise FetchError(f"Not found: {url}")
                last_error = FetchError(f"HTTP {resp.status_code} for {url}")
                if resp.status_code not in (429, 500, 502, 503, 504):
                    break
            time.sleep(min(2 ** (attempt + 1), 30))
        raise FetchError(str(last_error))

    def get_html(self, url: str) -> str:
        return self._request(url, self.delay).text

    def get_json(self, url: str, params: dict | None = None) -> dict:
        resp = self._request(
            url,
            self.delay,
            params=params,
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        return resp.json()

    def get_bytes(self, url: str) -> bytes:
        return self._request(url, self.photo_delay).content

    # Convenience wrappers --------------------------------------------------

    def area_html(self, area_id: int) -> str:
        return self.get_html(f"/area/{area_id}")

    def route_html(self, route_id: int) -> str:
        return self.get_html(f"/route/{route_id}")

    def route_guide_html(self) -> str:
        return self.get_html("/route-guide")

    def search_suggestions(self, query: str) -> dict:
        return self.get_json("/ajax/public/search/suggestions", {"q": query})
