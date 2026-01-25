# AI Scientist Static Demo (/projects/demo)

This folder hosts a fully static, sanitized showcase of the autonomous first-principles workflow. All assets are local (HTML/CSS/JS/font/data) so it can be opened directly or served by GitHub Pages.

## What is included

# AI Scientist Static Demo (/projects/demo)

This folder hosts a fully static, sanitized demonstration of an autonomous
computational research workflow. All assets are local (HTML/CSS/JS/font/data)
so the demo can be opened directly or served by GitHub Pages without any
connection to external services.

## What is included

- A top-to-bottom narrative: topic input → idea tree → selected direction → high-level
  planning → technician-style workflow → orchestrated execution → summarized outcomes.
- A horizontal idea tree built from `projects/demo/demo_data/sanitized_tree.json`
  (topic root on the left, spotlighted nodes clickable) that shows structure
  without exposing internal scoring details.
- A journey timeline plus an interaction timeline derived from sanitized logs
  in `projects/demo/demo_data/fpilot_interactions.json`, illustrating how the
  orchestrator progresses through tasks.
- High-level professor and technician plans with no paths, job scripts,
  usernames, infrastructure identifiers, or unpublished numerical results.

## Regenerate sanitized data

If you have access to the original internal logs, you can regenerate the
sanitized demo data with a small helper script (not included here). The
script should:

1. Load the original topic, idea tree, and interaction logs from your private
   environment.
2. Remove or anonymize any sensitive content (paths, usernames, infrastructure
   names, exact timestamps, identifiers, numerical results, etc.).
3. Write updated JSON / JS bundles under `projects/demo/demo_data/` in the same schema
   as the existing `sanitized_*.json` files.

For public distribution, only the already-sanitized artifacts in
`projects/demo/demo_data/` are needed.

## Preview locally

- Open `projects/demo/index.html` directly in a browser (all data is loaded from
  `demo_data/sanitized_data.js`).
- Or run a local server: `cd projects/demo && python -m http.server 8000` and visit
  http://localhost:8000.

## Deploy to GitHub Pages

One option is to serve this folder as a static sub-site:

1. Commit the `projects/demo/` folder to your main branch.
2. Configure GitHub Pages to either:
   - serve the repository root (and access the demo at `/projects/demo/`), or
   - serve from the `/projects/demo` folder on the main branch.
3. Push; the demo will be available at an appropriate URL such as
   `https://<username>.github.io/projects/demo/` or
   `https://<username>.github.io/<repo>/`.

## Security notes

- Sanitization removes paths, usernames, machine or cluster names, queue
  details, and similar operational metadata.
- Only high-level prompts, summaries, and coarse aggregate metrics are
  exposed; raw logs, job scripts, configuration files, and unpublished
  numerical results remain outside the published demo.
- All external dependencies (D3.js, fonts, etc.) are vendored locally to
  avoid network calls at runtime.
