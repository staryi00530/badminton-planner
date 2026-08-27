#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4174;
const baseUrl = `http://127.0.0.1:${port}/badminton-planner/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Vite did not start in time');
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Load defaults/ }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByRole('button', { name: /Generate/ }).click();
  await page.waitForTimeout(700);

  const current = () => page.getByRole('heading', { name: 'Current game' }).locator('..');
  const next = () => page.getByRole('heading', { name: 'Next game' }).locator('..');
  const liveCount = async () => current().getByText('● LIVE').count();
  const currentGames = async () => current().getByText(/SLOT \d+ · COURT \d+/).allTextContents();
  let completed = 0;
  let departureChecked = false;
  let maxLive = 0;

  for (let step = 0; step < 80; step++) {
    for (let pass = 0; pass < 4 && await liveCount() < 2; pass++) {
      for (const section of [current, next]) {
        if (await liveCount() >= 2) break;
        const start = section().getByRole('button', { name: 'Start', exact: true }).first();
        if (await start.count() && await start.isEnabled()) {
          await start.click();
          await page.waitForTimeout(100);
        }
      }
    }

    const live = await liveCount();
    maxLive = Math.max(maxLive, live);
    assert.ok(live <= 2, `live queue exceeded two courts at step ${step}`);

    if (!departureChecked && completed === 3) {
      const before = await currentGames();
      const leave = page.getByTitle('Player is done for today').first();
      assert.ok(await leave.count(), 'departure control should be available');
      await leave.click();
      await page.waitForTimeout(150);
      assert.deepEqual(await currentGames(), before, 'departure must not rewrite active courts');
      departureChecked = true;
      continue;
    }

    const done = current().getByRole('button', { name: '✓ Done', exact: true }).first();
    if (await done.count()) {
      await done.click();
      await page.waitForTimeout(150);
      completed++;
      continue;
    }
    if (await page.getByText('Session Status · complete · 12 done').count()) break;
    throw new Error(`session stalled after ${completed} completed games`);
  }

  assert.equal(completed, 24, 'two courts over twelve slots should complete 24 games');
  assert.equal(maxLive, 2, 'the smoke test should exercise both courts');
  assert.equal(departureChecked, true, 'the departure path should be exercised');
  assert.ok(await page.getByText('Session Status · complete · 12 done').count(), 'session should finish');
  await browser.close();
  console.log(`E2E smoke passed: ${completed} games, max ${maxLive} live courts`);
} finally {
  server.kill('SIGTERM');
}
