// Shared helpers: a test-only copy of the built extension, a Chromium with it
// loaded, and small waits. The shipped build in dist/chrome is never changed.
import { chromium } from 'playwright';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

export const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..', '..');

export const TEST_HOSTS = [
  'example.test', 'www.example.test', 'blog.example.test', 'metrics.example.test', 'other.test',
  'app.example.test', 'cdn.example.test', 'shop.example.test',
  'myshop.example', 'www.myshop.example', 'blog.myshop.example', 'docs.acme.example', 'acme.example', 'mybakery.example', 'travelblog.example'
];

/**
 * Copies dist/chrome to .build/chrome-test and grants the test hosts up front
 * (host_permissions), because the optional-permission prompt cannot be
 * clicked in automation. Only manifest.json differs from the shipped build.
 */
export function prepareTestExtension() {
  const shipped = join(root, 'dist', 'chrome');
  if (!existsSync(join(shipped, 'manifest.json'))) throw new Error('Run `node scripts/build.mjs` first');
  const out = join(here, '.build', 'chrome-test');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(shipped, out, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  // Same shape as the popup and options page request: the domain + its subdomains.
  manifest.host_permissions = TEST_HOSTS.flatMap((h) => [`*://${h}/*`, `*://*.${h}/*`]);
  // The popup reads getMatchedRules, which Chrome allows through activeTab
  // when a person clicks the toolbar button. A popup opened by a script gets
  // no activeTab grant, so the test copy has the feedback permission instead.
  manifest.permissions = manifest.permissions.concat('declarativeNetRequestFeedback');
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return out;
}

export function newProfileDir(name = 'profile') {
  const dir = join(tmpdir(), `pa-ext-e2e-${name}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  return dir;
}

let nextDebugPort = 9300 + (process.pid % 500);

export async function launch(extDir, profileDir, { headless = process.env.HEADED !== '1', viewport = { width: 1280, height: 800 }, colorScheme = 'light' } = {}) {
  // The toolbar popup is a separate browser target that Playwright's
  // persistent context does not list; a second CDP connection does.
  const debugPort = nextDebugPort++;
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium', // the full Chromium build in "new" headless mode, which can load extensions
    headless,
    viewport,
    colorScheme,
    // --enable-automation sets navigator.webdriver, and pa.js skips automated
    // browsers. Dropping it makes this look like a person's browser to pa.js.
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      `--remote-debugging-port=${debugPort}`,
      `--host-resolver-rules=${TEST_HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(', ')}`,
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
      '--disable-blink-features=AutomationControlled'
    ]
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  let cdp = null;
  /** A fresh CDP connection (one made earlier does not see later popups). */
  async function cdpBrowser() {
    if (cdp) await cdp.close().catch(() => {});
    cdp = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    return cdp;
  }
  // Extension API calls from the tests run in an extension page of their own,
  // not the service worker, so they still work while the worker is stopped.
  let helper = null;
  async function ext(fn, arg, tries = 20) {
    try {
      if (!helper || helper.isClosed()) {
        helper = await context.newPage();
        await helper.goto(`chrome-extension://${id}/options/options.html#test-helper`);
      }
      return await helper.evaluate(fn, arg);
    } catch (e) {
      // The extension was reloaded under the page: open a fresh one.
      if (tries <= 1) throw e;
      if (helper) await helper.close().catch(() => {});
      helper = null;
      await sleep(250);
      return ext(fn, arg, tries - 1);
    }
  }
  /** Opens the real toolbar popup for `page`'s tab and returns it. */
  async function openPopup(page) {
    await ext(() => null); // make sure the helper exists before the page is fronted
    await page.bringToFront();
    const err = await ext(() => chrome.action.openPopup().then(() => null, (e) => String(e)));
    if (err) throw new Error('openPopup failed: ' + err);
    const popupUrl = `chrome-extension://${id}/popup/popup.html`;
    const popup = await waitFor(async () => (await cdpBrowser()).contexts().flatMap((c) => c.pages()).find((p) => p.url() === popupUrl),
      { message: 'the toolbar popup', interval: 300 });
    await popup.waitForLoadState('domcontentloaded');
    return popup;
  }
  async function closePopups() {
    const b = await cdpBrowser();
    for (const p of b.contexts().flatMap((c) => c.pages())) {
      if (p.url().endsWith('/popup/popup.html')) await p.close().catch(() => {});
    }
  }
  async function close() {
    if (cdp) await cdp.close().catch(() => {});
    await context.close();
  }
  return { context, worker, id, ext, openPopup, closePopups, cdpBrowser, close };
}

/** The current service worker (it can be restarted under us). */
export async function serviceWorker(context) {
  const [w] = context.serviceWorkers();
  return w || context.waitForEvent('serviceworker');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 5000, interval = 100, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
}
