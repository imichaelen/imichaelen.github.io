# Git Tutor (Standalone Interactive Git Tutorial)

`Git Tutor` is a single-page, offline-friendly tutorial website that teaches Git through hands-on practice:

- Terminal-like command runner with history (↑/↓) and autocomplete (Tab)
- Simulated file system with staged/unstaged indicators
- Live SVG Git graph (commits, branches, merges)
- 6 guided lessons + quizzes + achievement badges
- Session-based progress saving (resets when the tab is closed) + export/import of your simulated state

## Project structure

- `index.html` — app shell + UI panels
- `style.css` — all styling (dark “code editor” theme)
- `script.js` — simulator + lessons + rendering logic (vanilla JS)
- `assets/` — icons (SVG)
- `lessons/` — optional lesson files (this project embeds lesson content in `script.js` so it works via `file://`)

## Run it

### Option A: open directly (quickest)

Open `index.html` in your browser.

### Option B: run a tiny local server (recommended)

Some browsers apply extra restrictions when opening local files. Running a local server avoids that.

```bash
python3 -m http.server 8000
```

Then open:

`http://localhost:8000`

## Tips

- Use the lesson sidebar to switch lessons (each lesson keeps its own saved state).
- Use **Reset lesson** to start over, or **Reset repo** to go back to the start of the current step.
- Use **Reset all** to clear all lessons + achievements.
- Use **Export** / **Import** to move progress between browsers or share a saved scenario.
