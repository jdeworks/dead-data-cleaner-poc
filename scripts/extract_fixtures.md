# scripts/extract_fixtures — bake real product output into public/demo/

A one-way, **read-only** extractor that pulls output from a LOCAL instance of the real
product and writes static JSON into `public/demo/`. The committed output is all the
deployed site serves — there is no backend. (Pattern: `anvil-poc/scripts/extract_fixtures.py`.)

Implement as a small Python/Node script. Responsibilities:

1. **Source the data locally.** Either hit the product's local API (`http://localhost:PORT`)
   or run its CLI in JSON mode (e.g. `<tool> <path> --json`) and read the result.
2. **Pick 3 hero examples** that show breadth without bloat. Bake each as `<item>/<id>.json`.
3. **Strip internal fields.** Drop raw source text, absolute file paths, provenance, secrets,
   machine-specific data. Keep only DERIVED output safe to serve publicly. For any third-party
   content, keep licensing-safe excerpts only.
4. **Write the index files:**
   - `manifest.json` — `{ id, title, description, generatedAt, stats, heroes, … }`
   - `stats.json` — the headline numbers for the landing cards
   - `catalog.json` — the roster (hero rows + locked rows; mark `hero: true/false`)
   - `<item>/<id>.json` — full per-hero bundles
5. **Run:** `python3 scripts/extract_fixtures.py [--api http://localhost:PORT]`, then `npm run build`.

Safety rule: this script must never import or modify the private product source — it only reads
*output*. Re-run it whenever the demo data should be refreshed.
