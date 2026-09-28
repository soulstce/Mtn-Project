# Crag Offline — a better, offline Mountain Project

Your own climbing guidebook app, built from [Mountain Project](https://www.mountainproject.com).
Pick any area and download it: every sub-area, route, description, protection note and photo.
Then browse it in a clean, fast app that keeps working with **zero signal** at the crag.

```
┌──────────────────────┐   polite scraper     ┌──────────────────────┐
│  mountainproject.com │ ───────────────────▶ │  your library        │
└──────────────────────┘   (1 page / sec)     │  data/mtnproj.db     │
                                              │  data/photos/*.jpg   │
                                              └─────────┬────────────┘
                                                        │
                     ┌──────────────────────────────────┴───────────────┐
                     ▼                                                  ▼
          python -m mtnproj serve                         python -m mtnproj export site/
          (desktop / home Wi-Fi: browse                   (static copy → any HTTPS host →
           MP live, download, update)                     phone “Add to Home Screen” →
                                                          fully offline)
```

## What's better than the Mountain Project app

- **Routes in wall order, grouped by crag.** Walk the cliff left → right; each route page has
  *‹ Left / Right ›* neighbours ("3 of 12 at The Oasis").
- **Real filtering.** Tap bars on the grade histogram to filter by grade (tap several).
  You can also filter by type (Sport/Trad/TR/Boulder/Ice…), minimum stars, and to-do /
  ticked / not-ticked, with instant text search.
- **Sort any list** by wall order, grade ↑/↓, stars or name. Works across a whole region,
  e.g. "every 3★ 5.10 sport route in the Red".
- **Area dashboards.** Route count, number of 3★+ classics, average stars, a type-mix bar,
  and a grade spread for every area.
- **Colour-coded grade badges** in the grade system you prefer: YDS, French, UIAA, Ewbanks,
  British or ZA for rock, and V or Font for boulders.
- **Photos everywhere.** Area covers, a thumbnail on each route row, a swipeable strip and a
  full-screen lightbox on every route.
- **Ticks & to-dos** with date, style and notes, a grade pyramid, and CSV export. All of it
  stays on your device.
- **Offline first.** "Save to device" copies an area (and everything under it) into the
  browser's storage, so it works in airplane mode.
- Dark mode, mobile bottom tabs, desktop sidebar, installable as an app (PWA).

## Quick start

```bash
pip install -r requirements.txt
python -m mtnproj serve            # → http://localhost:8000
```

In the app, open **Discover**, then search for a crag or browse by state and tap **Download**.
The **Downloads** tab shows live progress, and the area appears in your **Library** as it
fills in.

Or from the command line:

```bash
python -m mtnproj download https://www.mountainproject.com/area/105841134/red-river-gorge
python -m mtnproj download <url> --quick         # names/grades/stars only, very fast
python -m mtnproj download <url> --depth 1       # only one level of sub-areas
python -m mtnproj download <url> --no-photos
python -m mtnproj download <route url>           # downloads the crag that route is on
python -m mtnproj list
python -m mtnproj delete <area url or id>
```

Useful download options (the same ones appear in the app):

| Option | Default | Notes |
| --- | --- | --- |
| `--quick` | off | Skip route pages. Roughly 50× faster, but no descriptions or route photos. |
| `--max-photos N` | 12 | Photos saved per area / route page. |
| `--photo-size large` | medium | Medium is about 100 KB per photo; large is about 400 KB. |
| `--depth N` | everything | How many levels of sub-areas to include. |
| `--refresh-days N` | never | Re-download route pages older than N days. By default, re-running a download reuses pages you already have. |
| `--delay S` | 1.0 | Seconds between page requests. Please keep it polite. |

Big areas take time on purpose. Full details for the Red River Gorge (~3,800 routes) take
roughly an hour or more at one page per second. Start with a single crag, or use `--quick`
for a whole region and then fetch details for the crags you actually visit.

## Getting it on your phone

**At home (same Wi-Fi):**

```bash
python -m mtnproj serve --host 0.0.0.0
```

Then open `http://<your-computer's-IP>:8000` on your phone.

**At the crag (no signal):** browsers only allow offline storage on HTTPS sites, so export a
static copy and host it anywhere that serves HTTPS:

```bash
python -m mtnproj export site/              # everything
python -m mtnproj export site/ 105841134     # or just some root areas
```

Upload `site/` to GitHub Pages, Netlify, Vercel, Cloudflare Pages, or similar. Open it on
your phone and choose **Add to Home Screen**. Then open each area you want and tap
**Save to device**. Keep the site private (for example, an unlisted URL or a password-protected
host). It contains other people's Mountain Project content, meant for your own use.

## Run it on a cloud VM (recommended)

A VM gives you one always-on HTTPS address. Downloads run there, and your phone installs the
app from it and saves areas for offline use. You don't need a static export.

> ⚠️ Never expose `mtnproj serve` directly to the internet. It has no login of its own, and
> anyone could start downloads or delete your library. Always put it behind Caddy as below.

On an Ubuntu/Debian VM, you need a domain (or sslip.io) pointing at the VM, with ports 80
and 443 open:

```bash
# 1. App + dependencies
sudo apt update && sudo apt install -y git python3-venv caddy
sudo useradd --system --no-create-home --shell /usr/sbin/nologin mtnproj
sudo git clone https://github.com/soulstce/Mtn-Project.git /opt/mtn-project
sudo chown -R mtnproj: /opt/mtn-project
sudo -u mtnproj python3 -m venv /opt/mtn-project/.venv
sudo -u mtnproj /opt/mtn-project/.venv/bin/pip install -r /opt/mtn-project/requirements.txt

# 2. Keep it running (listens on 127.0.0.1:8000 only)
sudo cp /opt/mtn-project/deploy/mtnproj.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now mtnproj
curl -s http://127.0.0.1:8000/api/status.json    # → {"mode":"server",...}

# 3. HTTPS + password in front of it
caddy hash-password --plaintext 'choose-a-password'   # copy the hash it prints
sudo cp /opt/mtn-project/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile      # set your domain + paste the hash
sudo systemctl reload caddy
```

Open `https://your-domain` and log in as `climber` with your password. Then:

- **Get a crag:** use **Discover** to download it.
- **Install on your phone:** open the same URL and choose **Add to Home Screen**.
- **Take it offline:** tap **Save to device** on each area you'll climb.

To update later:

```bash
cd /opt/mtn-project && sudo -u mtnproj git pull \
  && sudo -u mtnproj .venv/bin/pip install -r requirements.txt \
  && sudo systemctl restart mtnproj
```

Your library lives in `/opt/mtn-project/data`. Back up that folder if you care about it.

## Project layout

```
mtnproj/
  http.py        polite, rate-limited client (retries + backoff)
  parse.py       HTML → dicts for area, route, route-guide and search pages
  grades.py      grade strings → sortable keys (YDS, V, WI, M, A/C)
  store.py       SQLite library + photo files
  downloader.py  background crawl jobs with progress + cancel
  server.py      FastAPI: library JSON, live MP browsing, downloads, static web app
  export.py      static-site export (same JSON paths as the server)
web/             the app: vanilla JS modules, no build step
  sw.js          service worker (offline shell, saved areas, photos)
tests/           pytest suite with synthetic fixture pages
```

Library URLs such as `api/areas/<id>.json` are the same whether the server generates them or
the export writes them as files. That's why one front end runs in both modes.

Run the tests with:

```bash
pip install pytest httpx && python -m pytest
```

## Notes

- This scrapes public pages of mountainproject.com. It is meant for **personal, offline use**.
  It is rate-limited and caches everything, so each page is fetched once. Please respect
  Mountain Project's terms and support the site and its contributors.
- Mountain Project changes its HTML occasionally. If a download comes back with empty fields,
  the parsers in `mtnproj/parse.py` (and their tests) are the place to look.
