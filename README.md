# Offline Survival Guide

A single-file, offline-first survival reference: first aid (with step-through
guides for pressure bandaging and splinting), water & food, shelter, fire,
navigation, signaling (including a screen-strobe SOS flashlight), weather,
wildlife, vehicle emergencies, long-term survival, and dedicated sections for
natural disasters, home survival, pandemics, civil unrest, and power outages.

Connect & Alerts is opt-in: everything else works with no network at all;
turning it on fetches live weather alerts, nearby points of interest, and
earthquake data.

## Run it

No build step. Open `index.html` directly in a browser, or serve the repo
root with any static file server:

```bash
python3 -m http.server 8080
```

## Deploy

Static HTML, zero dependencies, zero backend. `.github/workflows/deploy-pages.yml`
publishes the repo root to GitHub Pages on push to the default branch.
