# Learning Tracker

A lightweight personal learning planner built as a Progressive Web App (PWA). It helps you organize what you want to learn, what you're currently learning, and what you've already mastered.

## Features

- Organize learning into sections and subsections
- Track topics with status levels like:
  - Want to learn
  - Learning
  - Learned
- Reorder sections, subsections, and topics
- Add optional links for each topic
- Add topics one-by-one or multiple at once
- Store data locally in the browser using `localStorage`
- Installable as a web app on desktop/mobile

## Project structure

- `index.html` — app shell
- `app.js` — app logic and state management
- `style.css` — styling
- `manifest.json` — PWA manifest
- `sw.js` — service worker for installability/offline support
- `icon-192.png` and `icon-512.png` — app icons

## Run locally

Because this project is a static web app, you can run it in any browser.

### Option 1: Open directly

Open `index.html` in your browser.

### Option 2: Serve locally

From the project folder, run:

```bash
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## Notes

- The app uses browser local storage, so your data persists on the same browser/device.
- It is designed as a simple self-contained personal tracker without a backend or database.

## Author

Made by Lakshay Mahajan.
