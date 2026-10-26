// Smoke test of the shipped build in dist/chrome, unchanged (no extra host
// permissions). With the opt-out flag mode off nothing asks for site access,
// so request blocking can be checked end to end without a permission prompt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startSite } from './server.mjs';
import { root, launch, newProfileDir, sleep, waitFor } from './harness.mjs';

let site, browser;

before(async () => {
  site = await startSite();
  browser = await launch(join(root, 'dist', 'chrome'), newProfileDir('shipped'));
});

after(async () => {
  if (browser) await browser.close();
  if (site) await site.close();
});

async function hitsFor(host) {
  const path = `/shipped-${Date.now()}`;
  const page = await browser.context.newPage();
  await page.goto(`http://${host}:${site.port}${path}`);
  await sleep(1200);
  await page.close();
  // Pageviews only: closing the tab can also send an engagement hit.
  return site.events.filter((e) => e.body && e.body.t === 'pageview' && String(e.body.u).includes(path)).length;
}

test('shipped build: no host access at install, Mode B blocks a listed site', async () => {
  const granted = await browser.ext(() => chrome.permissions.getAll());
  assert.deepEqual(granted.origins, [], 'no site access until the user grants it');
  assert.equal(await hitsFor('example.test'), 1, 'counted before listing');

  const options = await browser.context.newPage();
  const errors = [];
  options.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  options.on('pageerror', (e) => errors.push(e.message));
  await options.goto(`chrome-extension://${browser.id}/options/options.html`);
  // load() fills the form from storage; wait for it so it does not undo our clicks.
  await waitFor(async () => (await options.inputValue('#patterns')) !== '', { message: 'options loaded' });
  await options.locator('#modeLocalStorage').uncheck();
  await options.fill('#add-input', 'example.test');
  await options.click('#add-form button[type=submit]');
  await options.waitForSelector('#domains .domain');
  await waitFor(async () => (await browser.ext(() => chrome.declarativeNetRequest.getDynamicRules())).length === 1, { message: 'rule' });
  const scripts = await browser.ext(() => chrome.scripting.getRegisteredContentScripts());
  assert.deepEqual(scripts, [], 'no content script without site access');

  assert.equal(await hitsFor('www.example.test'), 0, 'blocked');
  assert.equal(await hitsFor('other.test'), 1, 'other sites still counted');

  // Turning the flag mode back on offers the access button for the site.
  await options.locator('#modeLocalStorage').check();
  await options.getByRole('button', { name: 'Allow opt-out flag' }).waitFor();
  assert.deepEqual(errors, []);
});
