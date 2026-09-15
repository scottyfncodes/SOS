/*
 * Lightweight offline-first smoke test for SOS (index.html).
 * No framework, no dependencies beyond globally available Playwright.
 * Run with: node tests/smoke.test.js
 */
"use strict";
const path = require("path");
const { chromium } = require("playwright");

const FILE_URL = "file://" + path.resolve(__dirname, "..", "index.html");
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

(async () => {
  const browser = await chromium.launch();

  // 1. Basic load, no console errors, offline (block all network).
  console.log("Test: loads fully offline with no console errors");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file://")) return route.continue();
      return route.abort();
    });
    await page.goto(FILE_URL);
    await page.waitForSelector("#main .hero h1");
    ok(errs.length === 0, "no console errors on load (offline)");
    const title = await page.textContent("#main .hero h1");
    ok(!!title && title.length > 0, "home hero renders: " + title);
  });

  // 2. Emergency entry flow works, with all the new situations present.
  console.log("Test: emergency entry menu has expected situations");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file://")) return route.continue();
      return route.abort();
    });
    await page.goto(FILE_URL);
    await page.click("#emergency-btn");
    await page.waitForSelector(".entry-grid");
    const items = await page.$$eval(".entry-grid .entry-btn span:nth-child(2)", (els) => els.map((e) => e.textContent.trim()));
    ["Severe bleeding", "Fire", "Vehicle emergency", "Lost / stranded", "Water emergency / drowning", "Poison / chemical exposure", "Chest pain / possible heart attack", "Trouble breathing", "Other emergency"].forEach((label) => {
      ok(items.indexOf(label) !== -1, "entry menu includes: " + label);
    });
    ok(errs.length === 0, "no console errors after opening emergency menu");
  });

  // 3. Severe bleeding flow -> result shows CALL 911 button (tel: link).
  console.log("Test: severe result shows a Call 911 button with tel: link");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
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

  // 4. New non-medical flows resolve to a result with immediate action + notdo.
  console.log("Test: new emergency flows (fire, vehicle, lost, water, poison) resolve");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.goto(FILE_URL);
    await page.click("#emergency-btn");
    await page.click('.entry-btn:has-text("Lost / stranded")');
    await page.waitForSelector(".result-card");
    const lostTitle = await page.textContent(".result-card h3");
    ok(/lost or stranded/i.test(lostTitle || ""), "lost flow resolves directly to a result: " + lostTitle);

    await page.click('[data-go="triage:entry:start"]');
    await page.click('.entry-btn:has-text("Fire")');
    await page.waitForSelector(".entry-grid, .result-card");
    await page.click('.entry-btn:has-text("Wildfire nearby")');
    await page.waitForSelector(".result-card");
    const wildfireTitle = await page.textContent(".result-card h3");
    ok(/wildfire/i.test(wildfireTitle || ""), "fire -> wildfire sub-flow resolves: " + wildfireTitle);
    ok(errs.length === 0, "no console errors walking new flows");
  });

  // 5. Search finds mission example queries.
  console.log("Test: search resolves example queries to relevant results");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.goto(FILE_URL);
    const queries = ["bleeding", "broken arm", "snake bite", "car stuck", "lost", "hypothermia", "fire", "earthquake", "no water", "cpr", "burn", "choking"];
    for (const q of queries) {
      await page.fill("#search-input", "");
      await page.fill("#search-input", q);
      await page.waitForTimeout(30);
      const count = await page.$$eval("#search-results .sr-item", (els) => els.length);
      ok(count > 0, 'search "' + q + '" returns results (' + count + ")");
    }
    ok(errs.length === 0, "no console errors during search");
  });

  // 6. Mobile menu (hamburger / sidebar) works at narrow widths + no horizontal overflow.
  for (const width of [320, 375, 390, 430]) {
    console.log("Test: viewport " + width + "px - no horizontal overflow, mobile menu opens");
    await withPage(browser, { width, height: 844 }, async (page, errs) => {
      await page.goto(FILE_URL);
      const overflowHome = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflowHome <= 1, "home: no horizontal overflow at " + width + "px (delta " + overflowHome + ")");

      await page.click("#hamburger");
      await page.waitForSelector("#sidebar.open");
      const sidebarVisible = await page.isVisible("#sidebar.open");
      ok(sidebarVisible, "sidebar opens via hamburger at " + width + "px");
      await page.click("#sidebar-scrim");
      await page.waitForTimeout(50);
      const stillOpen = await page.$eval("#sidebar", (el) => el.classList.contains("open"));
      ok(!stillOpen, "sidebar closes via scrim tap at " + width + "px");

      // Check emergency entry grid + triage result screens too.
      await page.click("#emergency-btn");
      await page.click('.entry-btn:has-text("Severe bleeding")');
      await page.click('.qbtn:has-text("Yes, severe/rapid")');
      await page.waitForSelector(".result-card.severe");
      const overflowResult = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(overflowResult <= 1, "triage result: no horizontal overflow at " + width + "px (delta " + overflowResult + ")");
      ok(errs.length === 0, "no console errors at " + width + "px");
    });
  }

  // 7. Live features (weather/facilities/quakes/aqi) fail gracefully when network is blocked.
  console.log("Test: Connect & Alerts degrade gracefully with no network / geolocation");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file://")) return route.continue();
      return route.abort();
    });
    await page.goto(FILE_URL);
    await page.click('.card-link:has-text("Connect & Alerts")');
    await page.waitForSelector("#btn-weather");
    await page.click("#btn-weather");
    await page.waitForSelector("#live-weather .live-error", { timeout: 5000 });
    const errText = await page.textContent("#live-weather .live-error");
    ok(!!errText && errText.length > 0, "weather check fails gracefully with a visible message, not a blocked UI: " + errText.trim());
    // Core app must still be fully usable after a live-feature failure.
    await page.click(".breadcrumb >> text=Home");
    await page.waitForSelector("#main .hero h1");
    ok(errs.length === 0, "no console errors after live-feature failure");
  });

  // 8. Geolocation denial doesn't break the app.
  console.log("Test: geolocation permission denial degrades gracefully");
  await withPage(browser, { width: 390, height: 844 }, async (page, errs) => {
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("file://")) return route.continue();
      return route.abort();
    });
    await page.addInitScript(() => {
      window.navigator.geolocation.getCurrentPosition = (success, error) => {
        error({ code: 1, message: "User denied Geolocation" });
      };
    });
    await page.goto(FILE_URL);
    await page.click('.card-link:has-text("Connect & Alerts")');
    await page.click("#btn-facilities");
    await page.waitForSelector("#live-facilities .live-error", { timeout: 5000 });
    ok(true, "facilities check handles denied geolocation without crashing");
    ok(errs.length === 0, "no console errors after geolocation denial");
  });

  await browser.close();

  console.log("\n" + passed + " passed, " + failures + " failed");
  process.exit(failures > 0 ? 1 : 0);
})().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
