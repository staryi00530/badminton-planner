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

  const playerNames = Array.from({ length: 12 }, (_, i) => `Player ${String(i + 1).padStart(2, '0')}`).concat('E2E Player 13');
  const current = () => page.getByRole('heading', { name: 'Current game' }).locator('..');
  const next = () => page.getByRole('heading', { name: 'Next game' }).locator('..');

  async function setup(courtCount) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Load defaults/ }).click();
    await page.getByPlaceholder('Player name').fill('E2E Player 13');
    await page.getByRole('button', { name: 'ADD', exact: true }).click();
    const courtsControl = page.getByText('Courts', { exact: true }).locator('..');
    await courtsControl.getByRole('button', { name: String(courtCount), exact: true }).click();
    assert.equal(await page.getByText(new RegExp(`${courtCount} courts`)).count(), 1, `E2E setup should select ${courtCount} courts`);
    await page.getByRole('button', { name: /Generate/ }).click();
    await page.waitForTimeout(500);
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
      const seen = new Set();
      for (const cardText of cardTexts) {
        const names = playerNames.filter(name => cardText.includes(name));
        assert.equal(names.length, 4, `court should contain exactly four players at step ${step}`);
        assert.equal(new Set(names).size, 4, `court should not duplicate a player at step ${step}`);
        for (const name of names) {
          assert.ok(!seen.has(name), `player ${name} appears on two courts in the same view at step ${step}`);
          seen.add(name);
        }
      }
      totalVisible += cardTexts.length;
    }
    assert.ok(totalVisible > 0, `queue should show a non-empty court at step ${step}`);
    assert.ok(await page.getByText(/⚠ repeat group/).count() <= 2, `too many repeated groups at step ${step}`);
  }

  let completed = 0;
  let maxLive = 0;
  for (const courtCount of [2, 3]) {
    await setup(courtCount);
    for (let step = 0; step < 10; step++) {
      const liveCount = () => current().getByText('● LIVE').count();
      for (let pass = 0; pass < 4 && await liveCount() < courtCount; pass++) {
        for (const section of [current, next]) {
          if (await liveCount() >= courtCount) break;
          const start = section().getByRole('button', { name: 'Start', exact: true }).first();
          if (await start.count() && await start.isEnabled()) {
            await start.click();
            await page.waitForTimeout(80);
          }
        }
      }
      const live = await liveCount();
      maxLive = Math.max(maxLive, live);
      assert.ok(live <= courtCount, `live queue exceeded ${courtCount} courts at step ${step}`);
      await assertVisibleCourts(courtCount, `${courtCount}-court/${step}`);

      if (step === 3) {
        // Edit a waiting game so active courts remain live while its roster is
        // changed, matching the real substitution workflow.
        const editSection = await next().count() ? next : current;
        const edit = editSection().getByRole('button', { name: /Edit/ }).first();
        if (await edit.count()) {
          await edit.click();
          const picker = editSection().locator('select').first();
          if (await picker.count()) {
            const currentValue = await picker.inputValue();
            const replacement = (await picker.locator('option').evaluateAll(options => options.map(option => option.value))).find(value => value !== currentValue);
            if (replacement) await picker.selectOption(replacement);
            await editSection().getByRole('button', { name: 'This game only' }).first().click();
            await page.waitForTimeout(120);
            await assertVisibleCourts(courtCount, `${courtCount}-court/edit`);
          }
        }
      }

      const done = current().getByRole('button', { name: '✓ Done', exact: true }).first();
      if (await done.count()) {
        await done.click();
        await page.waitForTimeout(120);
        completed++;
      } else {
        throw new Error(`session stalled after ${completed} completed games (${courtCount} courts, step ${step})`);
      }
    }
  }

  assert.ok(completed >= 10, 'the multi-court flow should complete games');
  assert.equal(maxLive, 3, 'the smoke test should exercise three courts');
  await browser.close();
  console.log(`E2E smoke passed: ${completed} games across 2 and 3 courts, max ${maxLive} live courts`);
} finally {
  server.kill('SIGTERM');
}
