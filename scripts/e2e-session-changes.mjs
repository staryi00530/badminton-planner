#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against an existing dev server; no external network or network-idle waits.
const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:5173/badminton-planner/';
const browser = await chromium.launch({ headless: true });
const deadline = setTimeout(() => { void browser.close(); }, 45000);
try {
  for (const width of [1280, 390]) {
    for (const courts of [2, 3, 4, 5]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      await context.route('**/*', route => new URL(route.request().url()).origin === new URL(baseUrl).origin ? route.continue() : route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(4000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(courtCount => {
        const players = Array.from({ length: 24 }, (_, i) => ({ name: `P${i + 1}`, gender: 'M', availFrom: i === 23 ? 4 : 0, availTo: 5 }));
        const schedule = Array.from({ length: 6 }, (_, i) => ({
          slot: i + 1,
          courts: Array.from({ length: courtCount }, (_, c) => ({ court: c + 1, teamA: players.slice(c * 4, c * 4 + 2), teamB: players.slice(c * 4 + 2, c * 4 + 4) })),
          sitting: players.slice(courtCount * 4), repeatedCourts: [], playerState: [],
        }));
        localStorage.clear();
        sessionStorage.clear();
        for (const [key, value] of Object.entries({
          players, result: { schedule, gamesPlayed: players.map(() => 6) }, numCourts: courtCount,
          totalMinutes: 90, gameMinutes: 15, staggerMode: 'custom',
          'is-confirmed': true, scores: { s1c0: { a: '21', b: '18', applied: true, teamA: ['P1', 'P2'], teamB: ['P3', 'P4'] } },
        })) localStorage.setItem(`bp-${key}`, JSON.stringify(value));
      }, courts);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
      const lane = n => page.getByRole('region', { name: `Court ${n}`, exact: true });
      for (let n = 1; n <= courts; n++) await lane(n).getByRole('button', { name: 'Start game' }).click();
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('bp-result')));
      const lineups = await Promise.all(Array.from({ length: courts }, (_, i) => lane(i + 1).textContent()));
      const capacity = courts === 5 ? 4 : courts + 1;
      const change = page.getByRole('button', { name: courts === 5 ? 'Remove court' : 'Add court', exact: true });
      await change.click();
      const dialog = page.getByRole('dialog', { name: 'Update upcoming games?' });
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('bp-result'))), before);
      await change.click();
      await dialog.getByRole('button', { name: 'Update upcoming games', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('bp-courtOverrides'))), { 2: capacity });
      for (let n = 1; n <= courts; n++) assert.equal(await lane(n).textContent(), lineups[n - 1]);
      const next = page.getByRole('heading', { name: 'Next game', exact: true }).locator('..');
      assert.equal(await next.locator('.schedule-grid > div').count(), capacity);
      const availability = name => page.getByRole('group', { name: `Availability for ${name}`, exact: true });
      await availability('P24').getByRole('button', { name: 'Here now' }).click();
      await availability('P1').getByRole('button', { name: 'Leaving' }).click();
      const departed = await page.evaluate(() => JSON.parse(localStorage.getItem('bp-result')));
      assert.deepEqual(departed.schedule[0], before.schedule[0]);
      assert.ok(departed.schedule.slice(1).every(slot => slot.courts.every(court => [...court.teamA, ...court.teamB].every(player => player.name !== 'P1'))));
      await availability('P1').getByRole('button', { name: 'Restore P1 to session' }).click();
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('bp-scores')).s1c0.a), '21');
      await page.getByRole('button', { name: 'Setup', exact: true }).click();
      await page.getByRole('button', { name: 'Remove court', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('bp-courtOverrides'))), { 2: capacity - 1 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Setup overflows viewport');
      await page.getByRole('button', { name: 'Live session', exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Live overflows viewport');
      await page.screenshot({ path: `/tmp/task4-${width}-${courts}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS: ${courts} courts at ${width}px; confirmation, arrival/departure, Setup, snapshots and scores`);
    }
  }
} finally {
  clearTimeout(deadline);
  await browser.close();
}
