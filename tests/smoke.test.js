/*
 * Lightweight offline-first smoke test for SOS (index.html).
 * No framework, no dependencies beyond globally available Playwright.
 * Run with: node tests/smoke.test.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const INDEX_PATH = path.resolve(__dirname, "..", "index.html");
const FILE_URL = "file://" + INDEX_PATH;
let failures = 0;
let passed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log("  ok - " + label); }
  else { failures++; console.error("  FAIL - " + label); }
}

async function withPage(browser, viewport, fn) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  await fn(page, consoleErrors);
  await context.close();
}

function extractSource() {
  const html = fs.readFileSync(INDEX_PATH, "utf8");
  return html.match(/<script>([\s\S]*)<\/script>/)[1];
}
function grabArray(src, name) {
  const m = src.match(new RegExp("var " + name + " = (\\[[\\s\\S]*?\\n\\];)"));
  return m ? eval("(" + m[1].slice(0, -1) + ")") : [];
}

// ---- Test 0: pure structural checks on the flow graph + search index (no browser needed) ----
function structuralChecks() {
  console.log("Test: flow graph integrity (no dead ends, no broken references)");
  const src = extractSource();
  const flowM = src.match(/var TRIAGE_FLOWS = (\{[\s\S]*?\n\};)/);
  const TRIAGE_FLOWS = eval("(" + flowM[1].slice(0, -1) + ")");
  const catM = src.match(/var CATEGORIES = (\[[\s\S]*?\n\];)/);
  const CATEGORIES = eval("(" + catM[1].slice(0, -1) + ")");
  const catIds = new Set(CATEGORIES.map((c) => c.id));

  let errors = [];
  const flowIds = Object.keys(TRIAGE_FLOWS);
  flowIds.forEach((fid) => {
    const flow = TRIAGE_FLOWS[fid];
    Object.keys(flow).forEach((nid) => {
      const node = flow[nid];
      if (node.type === "q") {
        if (!node.options || !node.options.length) errors.push(fid + ":" + nid + " - q node with no options");
        (node.options || []).forEach((opt) => {
          const targetFlow = opt.flow || fid;
          if (!TRIAGE_FLOWS[targetFlow] || !TRIAGE_FLOWS[targetFlow][opt.next]) {
            errors.push(fid + ":" + nid + " -> " + targetFlow + ":" + opt.next + " MISSING");
          }
        });
      } else if (node.type === "menu") {
        if (!node.items || !node.items.length) errors.push(fid + ":" + nid + " - menu node with no items");
        (node.items || []).forEach((it) => {
          const parts = it.go.split(":");
          if (!TRIAGE_FLOWS[parts[0]] || !TRIAGE_FLOWS[parts[0]][parts[1]]) errors.push(fid + ":" + nid + " -> " + it.go + " MISSING");
        });
      } else if (node.type === "result") {
        if (!node.title) errors.push(fid + ":" + nid + " - result with no title");
        if (!node.steps || !node.steps.length) errors.push(fid + ":" + nid + " - result with NO STEPS (dead end)");
        if (!node.severity) errors.push(fid + ":" + nid + " - result with no severity");
      } else {
        errors.push(fid + ":" + nid + " - unknown node type: " + node.type);
      }
    });
  });
  TRIAGE_FLOWS.entry.start.items.forEach((it) => {
    const parts = it.go.split(":");
    if (!TRIAGE_FLOWS[parts[0]] || !TRIAGE_FLOWS[parts[0]][parts[1]]) errors.push('entry menu item "' + it.label + '" -> ' + it.go + " MISSING");
  });
  ok(errors.length === 0, "every triage node/edge resolves to a real destination (" + flowIds.length + " flows, " + TRIAGE_FLOWS.entry.start.items.length + " entry situations)");
  if (errors.length) errors.forEach((e) => console.error("    " + e));

  console.log("Test: search index has no broken destinations");
  function grab(name) { return grabArray(src, name); }
  let SEARCH_INDEX = [];
  function idx(cat, title, kw, go) { SEARCH_INDEX.push({ cat: cat, title: title, kw: (title + " " + kw).toLowerCase(), go: go }); }
  function catBlurb() { return ""; }
  const fnM = src.match(/function buildSearchIndex\(\)\{([\s\S]*?)\n\}\n/);
  let body = fnM[1].replace("SEARCH_INDEX.length = 0;", "");
  const QUICK_REF = grab("QUICK_REF"), FIRE_METHODS = grab("FIRE_METHODS"), GROUND_SIGNALS = grab("GROUND_SIGNALS"),
    EMERGENCY_NUMBERS = grab("EMERGENCY_NUMBERS"), EMERGENCY_ORGS = grab("EMERGENCY_ORGS");
  eval(body);
  let searchErrors = [];
  SEARCH_INDEX.forEach((item, i) => {
    const go = item.go;
    if (!go || !go.view) { searchErrors.push("#" + i + " " + item.title + " - no go/view"); return; }
    if (go.view === "category" && !catIds.has(go.cat)) searchErrors.push("#" + i + " " + item.title + ' -> unknown category "' + go.cat + '"');
    if (go.view === "triage" && (!TRIAGE_FLOWS[go.flow] || (go.node && !TRIAGE_FLOWS[go.flow][go.node]))) {
      searchErrors.push("#" + i + " " + item.title + " -> " + go.flow + ":" + go.node + " MISSING");
    }
  });
  ok(searchErrors.length === 0, "all " + SEARCH_INDEX.length + " search index entries point to real destinations");
  if (searchErrors.length) searchErrors.forEach((e) => console.error("    " + e));

  console.log("Test: search resolves realistic human queries (mission query list)");
  function search(qRaw) {
    const q = qRaw.trim().toLowerCase().replace(/['’]/g, "");
    if (!q) return [];
    const words = q.split(/\s+/).filter(Boolean);
    return SEARCH_INDEX.filter((item) => words.every((w) => item.kw.indexOf(w) !== -1));
  }
  const realQueries = [
    "bleeding", "blood", "cut", "bad cut", "bleeding badly", "broken arm", "broken leg", "fracture",
    "snake", "snake bite", "bitten by snake", "car stuck", "stuck car", "stranded", "lost", "lost hiking",
    "can't breathe", "cant breathe", "trouble breathing", "heart", "heart attack", "chest pain", "choking",
    "burn", "burned", "burns", "freezing", "hypothermia", "heat", "heat stroke", "dehydration", "no water",
    "fire", "wildfire", "smoke", "gas", "poison", "chemical", "earthquake", "tornado", "lightning", "drowning",
    "water", "cpr", "seizure", "electrocuted", "frostbite", "concussion", "head injury",
  ];
  let zero = [];
  realQueries.forEach((q) => { if (search(q).length === 0) zero.push(q); });
  ok(zero.length === 0, "every realistic query returns at least one result (" + realQueries.length + " queries tested)");
  if (zero.length) console.error("    zero-result queries: " + zero.map((q) => JSON.stringify(q)).join(", "));

  const nonsense = search("asdkjfhaskjdfh");
  ok(nonsense.length === 0, "nonsense query returns zero results (not a crash, not a broken state)");
}

(async () => {
  structuralChecks();

  const browser = await chromium.launch();

  console.log("Test: loads fully offline with no console errors");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : route.abort()));
    await page.goto(FILE_URL);
    await page.waitForSelector("#main .hero h1");
    ok(errs.length === 0, "no console errors on load (offline)");
    const title = await page.textContent("#main .hero h1");
    ok(!!title && title.length > 0, "home hero renders: " + title);
  });

  console.log("Test: emergency entry menu has expected situations (old + newly added)");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : route.abort()));
    await page.goto(FILE_URL);
    await page.click("#emergency-btn");
    await page.waitForSelector(".entry-grid");
    const items = await page.$$eval(".entry-grid .entry-btn span:nth-child(2)", (els) => els.map((e) => e.textContent.trim()));
    [
      "Severe bleeding", "Fire", "Vehicle emergency", "Lost / stranded", "Water emergency / drowning",
      "Poison / chemical exposure", "Chest pain / possible heart attack", "Trouble breathing", "Other emergency",
      "Seizure", "Electrical injury", "Frostbite", "Head or spinal injury",
    ].forEach((label) => ok(items.indexOf(label) !== -1, "entry menu includes: " + label));
    ok(errs.length === 0, "no console errors after opening emergency menu");
  });

  console.log("Test: severe result shows a Call 911 button with tel: link");
  await withPage(browser, { width: 390, height: 844 }, async (page) => {
    await page.goto(FILE_URL);
    await page.click("#emergency-btn");
    await page.click('.entry-btn:has-text("Severe bleeding")');
    await page.click('.qbtn:has-text("Yes, severe/rapid")');
    await page.waitForSelector(".result-card.severe");
    const href = await page.getAttribute(".call-now .call-btn", "href");
    ok(href === "tel:911", "call button links to tel:911, got: " + href);
    const title = await page.textContent(".result-card h3");
    ok(/severe bleeding/i.test(title || ""), "reached severe bleeding result: " + title);
  });

  console.log("Test: not breathing -> CPR flow resolves with correct escalation");
  await withPage(browser, { width: 390, height: 844 }, async (page) => {
    await page.goto(FILE_URL);
    await page.click("#emergency-btn");
    await page.click('.entry-btn:has-text("Not breathing / unresponsive")');
    await page.click('.qbtn:has-text("No response")');
    await page.click('.qbtn:has-text("No, not breathing or gasping")');
    await page.waitForSelector(".result-card.severe");
    const title = await page.textContent(".result-card h3");
    ok(/begin cpr/i.test(title || ""), "reaches CPR result: " + title);
    const href = await page.getAttribute(".call-now .call-btn", "href");
    ok(href === "tel:911", "CPR result shows call 911 button");
  });

  console.log("Test: chest pain (cardiac) flow resolves and cross-links to CPR when unresponsive");
  await withPage(browser, { width: 390, height: 844 }, async (page) => {
    await page.goto(FILE_URL);
    await page.click("#emergency-btn");
    await page.click('.entry-btn:has-text("Chest pain")');
    await page.click('.qbtn:has-text("No - awake and breathing")');
    await page.waitForSelector(".result-card.severe");
    const title = await page.textContent(".result-card h3");
    ok(/heart attack/i.test(title || ""), "conscious chest pain resolves: " + title);

    await page.click('[data-go="triage:entry:start"]');
    await page.click('.entry-btn:has-text("Chest pain")');
    await page.click('.qbtn:has-text("Yes - unresponsive or not breathing")');
    await page.waitForSelector(".result-card.severe");
    const title2 = await page.textContent(".result-card h3");
    ok(/begin cpr/i.test(title2 || ""), "unresponsive chest pain redirects into the shared CPR flow: " + title2);
  });

  console.log("Test: new/expanded flows (fire, vehicle, lost, water, poison, seizure, electrical, frostbite, head/spinal, other) all resolve");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.goto(FILE_URL);

    async function walkToResult(label, subLabel) {
      await page.click('[data-go="triage:entry:start"]');
      await page.click('.entry-btn:has-text("' + label + '")');
      if (subLabel) {
        await page.waitForSelector(".entry-grid");
        await page.click('.entry-btn:has-text("' + subLabel + '")');
      }
      await page.waitForSelector(".result-card, .qbtn-list");
    }

    await walkToResult("Lost / stranded");
    ok(/lost or stranded/i.test((await page.textContent(".result-card h3")) || ""), "lost/stranded resolves directly");

    await walkToResult("Fire", "Wildfire nearby");
    ok(/wildfire/i.test((await page.textContent(".result-card h3")) || ""), "fire -> wildfire resolves");

    await walkToResult("Vehicle emergency", "Stuck (mud, sand, snow)");
    const stuckSteps = (await page.textContent(".result-card")) || "";
    ok(/stuck in mud/i.test(stuckSteps), "vehicle -> stuck resolves");
    ok(/cracking a window/i.test(stuckSteps), "stuck-in-snow guidance mentions cracking a window for ventilation (CO safety, matches the reference page)");

    await walkToResult("Poison / chemical exposure", "Swallowed");
    ok(/swallowed a poison/i.test((await page.textContent(".result-card h3")) || ""), "poison -> swallowed resolves");

    await walkToResult("Water emergency / drowning", "Someone is struggling in the water now");
    ok(/reach or throw/i.test((await page.textContent(".result-card h3")) || ""), "water emergency -> active rescue resolves");

    await walkToResult("Seizure");
    await page.click('.qbtn:has-text("No - a single episode")');
    ok(/seizure/i.test((await page.textContent(".result-card h3")) || ""), "seizure (typical) resolves");

    await walkToResult("Electrical injury");
    await page.click('.qbtn:has-text("No - the power is off")');
    ok(/electrical injury/i.test((await page.textContent(".result-card h3")) || ""), "electrical injury (safe to approach) resolves");

    await walkToResult("Frostbite");
    await page.click('.qbtn:has-text("Yes - hard, white/waxy, numb")');
    ok(/frostbite/i.test((await page.textContent(".result-card h3")) || ""), "frostbite (severe) resolves with real treatment steps");

    await walkToResult("Head or spinal injury");
    ok(/head or spinal/i.test((await page.textContent(".result-card h3")) || ""), "head/spinal injury resolves directly");

    await walkToResult("Other emergency");
    ok(/not sure what to call it/i.test((await page.textContent(".result-card h3")) || ""), "other emergency resolves with a safe fallback");
    const otherCallHref = await page.getAttribute(".call-now .call-btn", "href");
    ok(otherCallHref === "tel:911", "other-emergency fallback still surfaces a call action");

    ok(errs.length === 0, "no console errors walking every new/expanded flow");
  });

  console.log("Test: Universal Edibility Test has been removed from Long-Term Survival");
  await withPage(browser, { width: 390, height: 844 }, async (page) => {
    await page.goto(FILE_URL);
    await page.click('.card-link:has-text("Long-Term Survival")');
    const bodyText = await page.textContent("#main");
    ok(!/universal edibility test/i.test(bodyText || ""), "no self-poison-testing protocol is presented to the user");
    ok(/don't eat it/i.test(bodyText || ""), "replaced with conservative can't-identify-it-don't-eat-it guidance");
  });

  console.log("Test: search resolves realistic queries in the live UI too");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.goto(FILE_URL);
    const queries = ["blood", "bad cut", "bitten by snake", "lost hiking", "can't breathe", "burned", "freezing", "car stuck", "seizure", "electrocuted", "frostbite"];
    for (const q of queries) {
      await page.fill("#search-input", "");
      await page.fill("#search-input", q);
      await page.waitForTimeout(30);
      const count = await page.$$eval("#search-results .sr-item", (els) => els.length);
      ok(count > 0, 'search "' + q + '" returns results in the live UI (' + count + ")");
    }
    await page.fill("#search-input", "");
    await page.fill("#search-input", "asdkjfhaskjdfh");
    await page.waitForTimeout(30);
    const emptyText = await page.textContent("#search-results");
    ok(/no results/i.test(emptyText || ""), "nonsense query shows a clean empty state, not a broken UI");
    ok(errs.length === 0, "no console errors during search");
  });

  console.log("Test: favorites persist across a reload (localStorage)");
  await withPage(browser, { width: 390, height: 844 }, async (page) => {
    await page.goto(FILE_URL);
    await page.waitForSelector(".fav-btn");
    await page.click(".fav-btn >> nth=0");
    const starred = await page.getAttribute(".fav-btn >> nth=0", "class");
    ok(/active/.test(starred || ""), "star toggles active state");
    const stored = await page.evaluate(() => window.localStorage.getItem("sos-favorites"));
    ok(!!stored && stored !== "[]", "favorite is written to localStorage: " + stored);
    await page.reload();
    await page.waitForSelector(".fav-btn");
    const starredAfterReload = await page.getAttribute(".fav-btn >> nth=0", "class");
    ok(/active/.test(starredAfterReload || ""), "favorite survives a full page reload via localStorage");
  });

  for (const width of [320, 375, 390, 430]) {
    console.log("Test: viewport " + width + "px - no horizontal overflow, mobile menu opens");
    await withPage(browser, { width, height: 844 }, async (page, errs) => {
      await page.goto(FILE_URL);
      const overflowHome = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflowHome <= 1, "home: no horizontal overflow at " + width + "px (delta " + overflowHome + ")");

      await page.click("#hamburger");
      await page.waitForSelector("#sidebar.open");
      ok(await page.isVisible("#sidebar.open"), "sidebar opens via hamburger at " + width + "px");
      await page.click("#sidebar-scrim");
      await page.waitForTimeout(50);
      ok(!(await page.$eval("#sidebar", (el) => el.classList.contains("open"))), "sidebar closes via scrim tap at " + width + "px");

      // Emergency entry grid now has 23 items - check it doesn't overflow either.
      await page.click("#emergency-btn");
      await page.waitForSelector(".entry-grid");
      const overflowEntry = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflowEntry <= 1, "23-item emergency entry grid: no horizontal overflow at " + width + "px (delta " + overflowEntry + ")");

      await page.click('.entry-btn:has-text("Severe bleeding")');
      await page.click('.qbtn:has-text("Yes, severe/rapid")');
      await page.waitForSelector(".result-card.severe");
      const overflowResult = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflowResult <= 1, "triage result: no horizontal overflow at " + width + "px (delta " + overflowResult + ")");
      ok(errs.length === 0, "no console errors at " + width + "px");
    });
  }

  console.log("Test: Connect & Alerts degrade gracefully with no network / geolocation");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : route.abort()));
    await page.goto(FILE_URL);
    await page.click('.card-link:has-text("Connect & Alerts")');
    await page.waitForSelector("#btn-weather");
    await page.click("#btn-weather");
    await page.waitForSelector("#live-weather .live-error", { timeout: 5000 });
    const errText = await page.textContent("#live-weather .live-error");
    ok(!!errText && errText.length > 0, "weather check fails gracefully with a visible message, not a blocked UI: " + errText.trim());
    await page.click(".breadcrumb >> text=Home");
    await page.waitForSelector("#main .hero h1");
    ok(errs.length === 0, "no console errors after live-feature failure");
  });

  console.log("Test: geolocation permission denial degrades gracefully");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : route.abort()));
    await page.addInitScript(() => {
      window.navigator.geolocation.getCurrentPosition = (success, error) => error({ code: 1, message: "User denied Geolocation" });
    });
    await page.goto(FILE_URL);
    await page.click('.card-link:has-text("Connect & Alerts")');
    await page.click("#btn-facilities");
    await page.waitForSelector("#live-facilities .live-error", { timeout: 5000 });
    ok(true, "facilities check handles denied geolocation without crashing");
    ok(errs.length === 0, "no console errors after geolocation denial");
  });

  console.log("Test: browser with no geolocation API at all still works");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : route.abort()));
    await page.addInitScript(() => { delete window.navigator.__proto__.geolocation; Object.defineProperty(window.navigator, "geolocation", { value: undefined }); });
    await page.goto(FILE_URL);
    await page.click('.card-link:has-text("Connect & Alerts")');
    await page.click("#btn-facilities");
    await page.waitForSelector("#live-facilities .live-error", { timeout: 5000 });
    const txt = await page.textContent("#live-facilities .live-error");
    ok(/location/i.test(txt || ""), "missing geolocation API reports a clear message instead of crashing: " + (txt || "").trim());
    ok(errs.length === 0, "no console errors when geolocation API is entirely absent");
  });

  await browser.close();

  console.log("\n" + passed + " passed, " + failures + " failed");
  process.exit(failures > 0 ? 1 : 0);
})().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
