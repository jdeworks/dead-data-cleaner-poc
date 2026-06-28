# scripts/capture_screenshots — drive the real UI, capture the gallery

Read-only Playwright script that drives the **real product's UI** (headless Chromium over
`http://localhost:PORT`) and writes PNGs + `index.json` into `public/demo/screenshots/`, used by
the Roadmap page's "Product surfaces" gallery. (Pattern: `anvil-poc/scripts/capture_screenshots.py`.)

Sketch:

```python
from playwright.sync_api import sync_playwright

BASE = "http://localhost:PORT"
OUT = ".../public/demo/screenshots"

# (file, path, caption, group, clicks, full_page)
SHOTS = [
    ("view-a.png", "/route-a", "Caption for view A", "Built today", [], False),
    ("view-b.png", "/route-b", "Caption for view B", "Built today", ["Some Tab"], True),
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    # ctx.add_init_script(...) to seed theme/identity before app scripts run
    page = ctx.new_page()
    written = []
    for file, path, caption, group, clicks, full in SHOTS:
        page.goto(f"{BASE}{path}", wait_until="networkidle", timeout=30_000)
        page.wait_for_timeout(2500)
        for label in clicks:
            page.get_by_text(label, exact=False).first.click(timeout=5_000)
            page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT}/{file}", full_page=full)
        written.append({"file": file, "caption": caption, "group": group})
    browser.close()
# write OUT/index.json from `written`
```

Requires the real frontend running locally + Playwright with Chromium. Seed a 2× device scale
factor for crisp shots. Group shots ("Built today" vs. future surfaces) via the `group` field.
