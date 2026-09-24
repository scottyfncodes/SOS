# Offline Survival Guide

A single-file, offline-first survival reference: first aid (with step-through
guides for pressure bandaging and splinting), water & food, shelter, fire,
navigation, signaling (including a screen-strobe SOS flashlight), weather,
wildlife, vehicle emergencies, long-term survival, dedicated sections for
natural disasters, home survival, pandemics, civil unrest, and power outages,
and **Rebuild From Zero**: public health, staple crops, soap/lime/charcoal,
pottery, metalworking, power, and preserving knowledge when help isn't coming
back.

**Print Full Guide** renders every section (including every triage flow,
flattened) on one page for printing or saving as a PDF - a paper copy outlives
the device's battery.

Connect & Alerts is opt-in: everything else works with no network at all;
turning it on fetches live weather alerts, nearby points of interest, and
earthquake data.

## Run it

No build step. Open `index.html` directly in a browser, or serve the repo
root with any static file server:

```bash
python3 -m http.server 8080
```

## Install for offline use

Served over http(s), the app registers a service worker (`sw.js`) and a web
manifest, so after one visit it reloads with no network and can be installed
via **Add to Home Screen** / **Install**. Bump `VERSION` in `sw.js` whenever a
cached file changes. Opened directly as a file, it is already local and needs
no service worker.

## Deploy

Static HTML, zero dependencies, zero backend. `.github/workflows/deploy-pages.yml`
publishes the repo root to GitHub Pages on push to the default branch.

## Test

A lightweight Playwright smoke test (`tests/smoke.test.js`) checks that the
app loads offline with no console errors, that the emergency decision flow
and search work, that mobile layouts don't overflow at 320/375/390/430px,
and that Connect & Alerts / geolocation failures degrade gracefully without
breaking the core app. It has no other dependencies - run it with:

```bash
npm install -g playwright   # if not already available
node tests/smoke.test.js
# if the global install isn't found:
NODE_PATH="$(npm root -g)" node tests/smoke.test.js
```
