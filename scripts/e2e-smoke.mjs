#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const artifacts = process.env.E2E_ARTIFACT_DIR ?? join(tmpdir(), 'badminton-e2e');
await mkdir(artifacts, { recursive: true });
// An available strict port prevents attaching to another checkout's server.
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const baseUrl = `http://127.0.0.1:${port}/badminton-planner/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
let serverError;
server.on('error', error => { serverError = error; });
for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });

async function waitForServer() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (serverError) throw serverError;
    assert.equal(server.exitCode, null, `Vite exited early:\n${serverOutput}`);
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Vite readiness timed out after 10s:\n${serverOutput}`);
}

async function assertLayout(page, step) {
  const problems = await page.evaluate(() => {
    const issues = [];
    if (document.documentElement.scrollWidth > innerWidth) issues.push('horizontal page overflow');
    const board = document.querySelector('[aria-label="Live session board"]');
    if (!board) return ['Live board is missing'];
    const items = [];
    const visible = element => element.checkVisibility({ checkVisibilityCSS: true }) &&
      !Array.from(board.querySelectorAll('details:not([open])')).some(details => details.contains(element) && !details.querySelector('summary')?.contains(element));
    const walker = document.createTreeWalker(board, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim() || !visible(node.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width && rect.height) items.push({ element: node.parentElement, rect, label: node.textContent.trim() });
      }
    }
    for (const element of board.querySelectorAll('button')) {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height && visible(element)) items.push({ element, rect, label: `button ${element.textContent.trim()}` });
    }
    for (const { element, rect, label } of items) {
      if (rect.left < -1 || rect.right > innerWidth + 1) issues.push(`${label} outside viewport`);
      // Text fragments allow wrapped player names, but not text escaping its container.
      for (let parent = element; parent && parent !== document.body; parent = parent.parentElement) {
        const bounds = parent.getBoundingClientRect();
        const style = getComputedStyle(parent);
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) issues.push(`${label} escapes ${parent.tagName}`);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY) && (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)) issues.push(`${label} vertically clipped`);
      }
    }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
      const x = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const y = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (x > 1 && y > 1) issues.push(`${a.label} overlaps ${b.label}`);
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(problems, [], `clipping/overlap at ${step}`);
}

async function verifySessionWorkflows(newContext) {
  for (const width of [1280, 390]) for (const courts of [2, 3, 4, 5]) {
    stage = `${width}px/${courts}-court session workflow`;
    const context = await newContext(width);
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // A persisted fixture makes history and availability checks independent of shuffle.
    await page.addInitScript(courts => {
      const players = Array.from({ length: 24 }, (_, i) => ({ name: i === 0 ? 'Alexandra Montgomery' : i === 23 ? 'Jordan Williamson' : `Session Player ${String(i + 1).padStart(2, '0')}`, gender: 'M', availFrom: i === 23 ? 4 : 0, availTo: 5 }));
      const schedule = Array.from({ length: 6 }, (_, i) => ({ slot: i + 1, courts: Array.from({ length: courts }, (_, c) => ({ court: c + 1, teamA: players.slice(c * 4, c * 4 + 2), teamB: players.slice(c * 4 + 2, c * 4 + 4) })), sitting: players.slice(courts * 4), repeatedCourts: [], playerState: [] }));
      localStorage.clear(); sessionStorage.clear();
      for (const [key, value] of Object.entries({ players, result: { schedule, gamesPlayed: players.map(() => 6) }, numCourts: courts, totalMinutes: 90, gameMinutes: 15, staggerMode: 'custom', 'is-confirmed': true, scores: { s1c0: { a: '21', b: '18', applied: true, teamA: players.slice(0, 2).map(p => p.name), teamB: players.slice(2, 4).map(p => p.name) } } })) localStorage.setItem(`bp-${key}`, JSON.stringify(value));
    }, courts);
    const lane = n => page.getByRole('region', { name: `Court ${n}`, exact: true });
    const next = () => page.getByRole('heading', { name: 'Next game', exact: true }).locator('..');
    const stored = key => page.evaluate(key => JSON.parse(localStorage.getItem(`bp-${key}`)), key);
    const snapshot = () => page.evaluate(() => Object.fromEntries(
      ['result', 'players', 'scores', 'courtOverrides', 'saved-plans', 'is-confirmed'].map(key => [key, JSON.parse(localStorage.getItem(`bp-${key}`))]),
    ));
    const nav = name => page.getByRole('button', { name, exact: true });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await expect(nav('Live session')).toHaveAttribute('aria-current', 'page');
    // The initial persistence effect also normalizes legacy player records.
    await expect.poll(() => stored('courtOverrides')).toEqual({});
    await assertLayout(page, `${stage}/ready`);
    for (let n = 1; n <= courts; n++) await lane(n).getByRole('button', { name: 'Start game', exact: true }).click();
    const original = await snapshot();
    const lineups = [];
    for (let n = 1; n <= courts; n++) {
      await expect(lane(n).getByRole('button', { name: 'Finish game', exact: true })).toBeEnabled();
      lineups.push(await lane(n).textContent());
    }
    async function assertCurrent() {
      for (let n = 1; n <= courts; n++) assert.equal(await lane(n).textContent(), lineups[n - 1], `${stage}: live lane ${n} changed`);
      assert.deepEqual((await stored('result')).schedule[0], original.result.schedule[0]);
      assert.deepEqual(await stored('scores'), original.scores);
    }
    await nav('Setup').click();
    await expect(nav('Setup')).toHaveAttribute('aria-current', 'page');
    await expect(nav('Re-roll')).toBeVisible();
    // Setup retains the board below its editing controls by design.
    await expect(page.getByRole('region', { name: 'Live session board', exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${stage}: Setup overflow`);
    await page.screenshot({ path: join(artifacts, `setup-${width}-${courts}.png`), fullPage: true, timeout: 5000 });
    await nav('Live session').click();
    await expect(nav('Live session')).toHaveAttribute('aria-current', 'page');
    await expect(nav('Re-roll')).toHaveCount(0);
    await assertCurrent();
    const dialog = page.getByRole('dialog', { name: 'Update upcoming games?', exact: true });
    const undo = nav('Undo last action');
    const capacity = courts === 5 ? 4 : courts + 1;
    const change = nav(courts === 5 ? 'Remove court' : 'Add court');
    await change.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await snapshot(), original, 'cancel must not mutate the session');
    await change.click();
    await dialog.getByRole('button', { name: 'Update upcoming games', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    assert.deepEqual(await stored('courtOverrides'), { 2: capacity });
    await expect(next().locator('.schedule-grid > div')).toHaveCount(capacity);
    await assertCurrent();
    await assertLayout(page, `${stage}/capacity`);
    await undo.click();
    assert.deepEqual(await snapshot(), original, 'undo must restore confirmed schedule and archive atomically');
    await expect(undo).toBeDisabled();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await assertCurrent();
    // Commit both directions, including removal while all original courts remain live.
    for (const [command, target] of [['Remove court', courts - 1], ['Add court', courts]]) {
      await nav(command).click();
      if (await dialog.count()) await dialog.getByRole('button', { name: 'Update upcoming games', exact: true }).click();
      await expect(page.getByRole('status', { name: 'Session change', exact: true })).toContainText(`slot 2. ${target} court`);
      assert.deepEqual(await stored('courtOverrides'), { 2: target });
      await expect(next().locator('.schedule-grid > div')).toHaveCount(target);
      await assertCurrent();
    }
    const availability = name => page.getByRole('group', { name: `Availability for ${name}`, exact: true });
    await availability('Jordan Williamson').getByRole('button', { name: 'Here now', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Session change', exact: true })).toContainText('Jordan Williamson here now');
    assert.equal((await stored('players')).find(p => p.name === 'Jordan Williamson').availFrom, 1);
    assert.ok((await stored('result')).schedule.slice(1).some(s => s.courts.some(c => [...c.teamA, ...c.teamB].some(p => p.name === 'Jordan Williamson'))), 'arrival must enter future games');
    await assertCurrent();
    const beforeDeparture = await snapshot();
    await availability('Alexandra Montgomery').getByRole('button', { name: 'Leaving', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Session change', exact: true })).toContainText('Alexandra Montgomery leaving from slot 2');
    assert.ok((await stored('result')).schedule.slice(1).every(s => s.courts.every(c => [...c.teamA, ...c.teamB].every(p => p.name !== 'Alexandra Montgomery'))), 'departure must be absent from future games');
    await assertCurrent();
    await undo.click();
    assert.deepEqual(await snapshot(), beforeDeparture, 'undo departure must retain arrival and capacity');
    await expect(undo).toBeDisabled();
    await assertCurrent();
    await assertLayout(page, `${stage}/availability-undo`);
    await page.screenshot({ path: join(artifacts, `live-${width}-${courts}.png`), fullPage: true, timeout: 5000 });
    assert.deepEqual(errors, [], `uncaught app errors at ${stage}`);
    await context.close();
    console.log(`PASS: ${stage}; Setup return, arrival/departure, add/remove, cancel, undo; no clipping/overlap`);
  }
}

let browser;
let activePage;
let stage = 'startup';
let timedOut = false;
const watchdog = setTimeout(() => {
  timedOut = true;
  console.error(`E2E timed out after 180s during ${stage}`);
  void browser?.close();
  server.kill('SIGTERM');
}, 180000);

try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, timeout: 10000 });
  async function newContext(width) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    // Isolate optional fonts only: local assets and app failures remain visible.
    await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
    return context;
  }
  const context = await newContext(1280);
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Setup', exact: true })).toBeVisible();

  let playerNames = [];
  const current = () => page.getByRole('heading', { name: 'Current game' }).locator('..');
  const next = () => page.getByRole('heading', { name: 'Next game' }).locator('..');

  async function setup(courtCount, playerCount) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Setup', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('button', { name: 'Live session', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /Load defaults/ }).click();
    playerNames = Array.from({ length: playerCount }, (_, i) => i < 12 ? `Player ${String(i + 1).padStart(2, '0')}` : `E2E Player ${i + 1}`);
    for (const name of playerNames.slice(12)) {
      await page.getByPlaceholder('Player name').fill(name);
      await page.getByRole('button', { name: 'ADD', exact: true }).click();
    }
    const courtsControl = page.getByText('Courts', { exact: true }).locator('..');
    await courtsControl.getByRole('button', { name: String(courtCount), exact: true }).click();
    assert.equal(await page.getByText(new RegExp(`${courtCount} courts`)).count(), 1, `E2E setup should select ${courtCount} courts`);
    await page.getByRole('button', { name: /Generate/ }).click();
    await expect(page.getByRole('button', { name: 'Live session', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(current().getByRole('button', { name: 'Finish game', exact: true })).toHaveCount(courtCount);
    await expect(page.getByPlaceholder('Player name')).toHaveCount(0);
  }

  async function assertVisibleCourts(courtCount, step) {
    const sections = [];
    if (await current().count()) sections.push(current());
    if (await next().count()) sections.push(next());
    let totalVisible = 0;
    for (const section of sections) {
      const cards = section.locator('.schedule-grid > div');
      const cardTexts = await cards.allTextContents();
      assert.ok(cardTexts.length <= courtCount, `too many visible courts at step ${step}`);
      const seenBySlot = new Map();
      for (const cardText of cardTexts) {
        const names = playerNames.filter(name => cardText.includes(name));
        assert.equal(names.length, 4, `court should contain exactly four players at step ${step}`);
        assert.equal(new Set(names).size, 4, `court should not duplicate a player at step ${step}`);
        const slot = cardText.match(/SLOT\s+(\d+)/)?.[1] ?? 'unknown';
        const seen = seenBySlot.get(slot) ?? new Set();
        for (const name of names) {
          assert.ok(!seen.has(name), `player ${name} appears on two courts in the same view at step ${step}`);
          seen.add(name);
        }
        seenBySlot.set(slot, seen);
      }
      totalVisible += cardTexts.length;
    }
    assert.ok(totalVisible > 0, `queue should show a non-empty court at step ${step}`);
    const visibleRepeatWarnings = await Promise.all(sections.map(section => section.getByText(/⚠ repeat group/).count()));
    assert.ok(visibleRepeatWarnings.reduce((sum, count) => sum + count, 0) <= Math.max(2, courtCount), `too many repeated groups at step ${step}`);
  }

  let completed = 0;
  let maxLive = 0;
  for (const { courtCount, playerCount } of [{ courtCount: 2, playerCount: 13 }, { courtCount: 3, playerCount: 13 }, { courtCount: 4, playerCount: 16 }, { courtCount: 5, playerCount: 20 }]) {
    stage = `${courtCount}-court generation`;
    await setup(courtCount, playerCount);
    assert.equal(await current().getByText('● LIVE').count(), courtCount, `new schedules should start all ${courtCount} courts`);
    for (let step = 0; step < 10; step++) {
      stage = `${courtCount}-court game ${step + 1}`;
      const liveCount = () => current().getByText('● LIVE').count();
      for (let pass = 0; pass < courtCount + 1 && await liveCount() < courtCount; pass++) {
        for (const section of [current, next]) {
          if (await liveCount() >= courtCount) break;
          const start = section().getByRole('button', { name: 'Start game', exact: true }).first();
          if (await start.count() && await start.isEnabled()) {
            const before = await liveCount();
            await start.click();
            await expect.poll(liveCount).toBe(before + 1);
          }
        }
      }
      const live = await liveCount();
      maxLive = Math.max(maxLive, live);
      assert.ok(live <= courtCount, `live queue exceeded ${courtCount} courts at step ${step}`);
      if (courtCount >= 4) {
        assert.equal(live, courtCount, `all configured courts should remain live at step ${step}`);
      }
      await assertVisibleCourts(courtCount, `${courtCount}-court/${step}`);

      if (step === 3) {
        // Edit a waiting game so active courts remain live while its roster is
        // changed, matching the real substitution workflow.
        const editSection = await next().count() ? next : current;
        const edit = editSection().getByRole('button', { name: /Edit/ }).first();
        await expect(edit).toBeVisible();
        {
          await edit.click();
          const picker = editSection().locator('select').first();
          await expect(picker).toBeVisible();
          {
            const currentValue = await picker.inputValue();
            const replacement = (await picker.locator('option').evaluateAll(options => options.map(option => option.value))).find(value => value !== currentValue);
            assert.ok(replacement, `no replacement at ${stage}`);
            await picker.selectOption(replacement);
            await editSection().getByRole('button', { name: 'This game only' }).first().click();
            await expect(picker).toHaveCount(0);
            await assertVisibleCourts(courtCount, `${courtCount}-court/edit`);
          }
        }
      }

      const done = current().getByRole('button', { name: 'Finish game', exact: true }).first();
      if (await done.count()) {
        // Editing a queued slot can invalidate that slot's old completed references.
        const completedBefore = Number((await page.getByRole('button', { name: /^Past games/ }).textContent()).match(/\((\d+)\)/)?.[1] ?? 0);
        await done.click();
        const past = page.getByRole('button', { name: `Past games (${completedBefore + 1})`, exact: true });
        const useNextPlayable = page.getByRole('button', { name: 'Use next playable game', exact: true });
        const substituteUnavailable = page.getByRole('button', { name: 'Substitute unavailable players', exact: true });
        await expect.poll(async () => await past.count() > 0 || await substituteUnavailable.count() > 0).toBe(true);
        if (await useNextPlayable.count()) await useNextPlayable.click();
        else if (await substituteUnavailable.count()) await substituteUnavailable.click();
        await expect(past).toBeVisible();
        completed++;
      } else {
        throw new Error(`session stalled after ${completed} completed games (${courtCount} courts, step ${step})`);
      }
    }
    console.log(`PASS: 10 games on ${courtCount} courts (desktop)`);
  }

  assert.equal(completed, 40, 'the multi-court flow should complete every game');
  assert.equal(maxLive, 5, 'the smoke test should exercise five courts');
  assert.deepEqual(errors, [], 'uncaught app errors during multi-court flow');
  await context.close();
  // Session-mode workflows are exercised below at desktop and mobile widths.
  await verifySessionWorkflows(newContext);
  assert.equal(timedOut, false, 'E2E deadline exceeded');
  console.log(`E2E smoke passed: ${completed} games, max ${maxLive} live courts; 8 desktop/mobile workflows. Screenshots: ${artifacts}`);
} catch (error) {
  console.error(`E2E failed during ${stage}`);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true, timeout: 3000 }).catch(() => {});
  throw error;
} finally {
  clearTimeout(watchdog);
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    const forceKill = setTimeout(() => server.kill('SIGKILL'), 2000);
    await exited;
    clearTimeout(forceKill);
  }
}
