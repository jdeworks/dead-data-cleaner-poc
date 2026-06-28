# dead-data-cleaner-poc

Public, **self-contained** static demo of dead-data-cleaner. **No backend, no keys.** A Vite + React
SPA served by GitHub Pages that renders the real, pre-computed product output baked into
static JSON under `public/demo/`.

This is the starter scaffold from the **Promo POC Playbook**. Search the tree for `CHANGEME`
and `dead-data-cleaner` to find every spot to fill in. Read `../PLAYBOOK.md` (recipe) and, for the
dead-data-cleaner instance, `../APPLY-DDC.md`.

## Develop

```bash
npm install
npm run dev        # http://localhost:4173/dead-data-cleaner-poc/
npm run build      # -> docs/ (committed; Pages serves this)
npm run preview
```

## Bake the demo data

```bash
python3 scripts/extract_fixtures.py        # real output -> public/demo/*.json
python3 scripts/capture_screenshots.py     # UI shots    -> public/demo/screenshots/
```

See `scripts/*.md` for what each does (and the safety rules).

## Deploy

See `../DEPLOY.md`. In short: `npm run build`, commit `docs/`, enable
Settings → Pages → Deploy from a branch → `<branch>` → `/docs`.

## Structure

```
public/demo/        baked fixtures (committed, served raw)
src/stores/         view-store (no router) + theme-store
src/lib/demo.ts     base-path-aware fixture loader
src/components/     Sidebar, ui kit, SurveyPage (Google Form)
src/views/          Landing, Why, HowItWorks, Demo, Roadmap, Investors
scripts/            extract_fixtures, capture_screenshots, pre-commit.sample
```
