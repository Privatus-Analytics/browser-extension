// End-to-end tests: the built extension in a real Chromium, the real pa.js
// tracker, a local test site, and the real options page and toolbar popup.
//
//   node scripts/build.mjs && cd test/e2e && npm install && npm test
//
// HEADED=1 shows the browser.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startSite } from './server.mjs';
import { prepareTestExtension, launch, newProfileDir, sleep, waitFor } from './harness.mjs';

let site, ext, profile, browser; // browser = { context, id, openPopup, close }
const extensionErrors = [];
let visitNo = 0;

function watchExtensionErrors(b) {
  const prefix = `chrome-extension://${b.id}/`;
  const onConsole = (where) => (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') extensionErrors.push(`${where} ${msg.type()}: ${msg.text()}`);
  };
  b.context.on('page', (p) => {
    p.on('console', (msg) => { if (p.url().startsWith(prefix)) onConsole(p.url())(msg); });
    p.on('pageerror', (e) => { if (p.url().startsWith(prefix)) extensionErrors.push(`${p.url()} pageerror: ${e.message}`); });
  });
  const watchWorker = (w) => { if (w.url().startsWith(prefix)) w.on('console', onConsole('service worker')); };
  b.context.serviceWorkers().forEach(watchWorker);
  b.context.on('serviceworker', watchWorker);
}

async function start() {
  browser = await launch(ext, profile);
  watchExtensionErrors(browser);
}

/** What the background has actually set up in the browser. */
async function extensionState() {
  return browser.ext(async () => ({
    rules: await chrome.declarativeNetRequest.getDynamicRules(),
    scripts: await chrome.scripting.getRegisteredContentScripts(),
    storage: await chrome.storage.local.get(null)
  }));
}

let optionsPage = null;
async function options() {
  const url = `chrome-extension://${browser.id}/options/options.html`;
  if (!optionsPage || optionsPage.isClosed()) {
    optionsPage = await browser.context.newPage();
    await optionsPage.goto(url);
  } else {
    await optionsPage.bringToFront();
    await optionsPage.reload();
  }
  await optionsPage.waitForLoadState('load');
  // load() fills the form from storage; wait for it so it does not undo our clicks.
  await waitFor(async () => (await optionsPage.inputValue('#patterns')) !== '', { message: 'options loaded' });
  return optionsPage;
}

async function addSite(input) {
  const p = await options();
  await p.fill('#add-input', input);
  await p.click('#add-form button[type=submit]');
  await waitFor(async () => (await p.locator('#add-input').inputValue()) === '', { message: `add ${input}` });
}

async function removeSite(domain) {
  const p = await options();
  await p.locator('#domains li', { has: p.locator('.domain', { hasText: new RegExp(`^${domain.replace(/\./g, '\\.')}$`) }) })
    .getByRole('button', { name: 'Remove' }).click();
  await waitFor(async () => !(await p.locator('#domains .domain').allTextContents()).includes(domain), { message: `remove ${domain}` });
}

async function setMode(id, on) {
  const p = await options();
  const box = p.locator('#' + id);
  if ((await box.isChecked()) !== on) await box.click();
  await waitFor(async () => (await extensionState()).storage[id] === on, { message: `${id}=${on}` });
}

async function setPatterns(text) {
  const p = await options();
  await p.fill('#patterns', text);
  await p.click('#save-patterns');
  await waitFor(async () => (await p.textContent('#patterns-status')) === 'Saved.', { message: 'patterns saved' });
}

/** Waits until the DNR rules and content script match the stored settings. */
async function synced({ rules, scriptMatches }) {
  return waitFor(async () => {
    const s = await extensionState();
    const n = s.rules.length;
    const optout = s.scripts.find((c) => c.id === 'privatus-optout');
    const matches = (optout && optout.matches) || [];
    const okRules = rules === undefined || n === rules;
    const okScripts = scriptMatches === undefined || scriptMatches.every((m) => matches.includes(m)) && (scriptMatches.length || !matches.length);
    return okRules && okScripts && s;
  }, { message: `sync (rules=${rules}, scripts=${scriptMatches})` });
}

/** Loads a page of the test site and reports what reached the server. */
async function visit(host, { path, api, load, keepOpen = false, wait = 1200 } = {}) {
  const p = path || `/visit-${++visitNo}`;
  const q = new URLSearchParams();
  if (api) q.set('api', api);
  if (load) q.set('load', load);
  const url = `http://${host}:${site.port}${p}${q.size ? '?' + q : ''}`;
  const page = await browser.context.newPage();
  await page.goto(url);
  await page.waitForLoadState('load');
  await sleep(wait);
  const flag = await page.evaluate(() => localStorage.getItem('privatus_optout'));
  const urlPrefix = `http://${host}:${site.port}${p}`;
  const hits = site.events.filter((e) => e.body && typeof e.body.u === 'string' && e.body.u.startsWith(urlPrefix));
  const pageviews = hits.filter((e) => e.body.t === 'pageview');
  if (!keepOpen) await page.close();
  return { page, flag, hits, pageviews, url };
}

before(async () => {
  site = await startSite();
  ext = prepareTestExtension();
  profile = newProfileDir('main');
  await start();
});

// Each test starts from the defaults (both modes, default endpoint), so one
// failure does not cascade. The site list is left as the last test made it.
beforeEach(async () => {
  if (!browser) return;
  await browser.ext(() => chrome.storage.local.set({ modeLocalStorage: true, modeBlockRequests: true, endpointPatterns: ['/api/event^'] }));
  await browser.closePopups();
  const listed = (await extensionState()).storage.domains.length;
  await synced({ rules: listed ? 1 : 0 });
});

after(async () => {
  if (browser) await browser.close();
  if (site) await site.close();
});

test('not listed: a pageview is recorded', async () => {
  const s = await extensionState();
  assert.equal(s.rules.length, 0);
  assert.deepEqual(s.storage.domains, []);
  const v = await visit('example.test');
  assert.equal(v.pageviews.length, 1, 'pa.js sent one pageview');
  assert.equal(v.flag, null);
});

test('listed through the options page: both modes block, flag set', async () => {
  await addSite('https://www.example.test/some/page'); // pasted URL, www is dropped
  const p = await options();
  assert.deepEqual(await p.locator('#domains .domain').allTextContents(), ['example.test']);
  const s = await synced({ rules: 1, scriptMatches: ['*://example.test/*', '*://*.example.test/*'] });
  assert.deepEqual(s.rules[0].condition.initiatorDomains, ['example.test']);
  assert.equal(s.rules[0].condition.urlFilter, '/api/event^');
  const v = await visit('example.test');
  assert.equal(v.flag, '1', 'Mode A set the opt-out flag');
  assert.equal(v.hits.length, 0, 'nothing reached the server');
});

test('mode B alone blocks the POST (flag cleared, request still blocked)', async () => {
  await setMode('modeLocalStorage', false);
  // The flag set in the last test must not hide whether blocking works.
  const v = await visit('example.test');
  assert.equal(v.flag, null, 'with Mode A off, the content script removes an old flag');
  // pa.js may have read the flag before it was removed; a second visit is clean.
  const v2 = await visit('example.test');
  assert.equal(v2.flag, null);
  assert.equal(v2.hits.length, 0, 'request blocked by the DNR rule');
});

test('mode A alone: the flag stops pa.js, nothing is blocked', async () => {
  await setMode('modeLocalStorage', true);
  await setMode('modeBlockRequests', false);
  await synced({ rules: 0, scriptMatches: ['*://example.test/*'] });
  const first = await visit('blog.example.test');
  assert.equal(first.flag, '1');
  assert.equal(first.hits.length, 0, `first visit: pa.js sent nothing (got ${first.hits.length})`);
  const v = await visit('example.test');
  assert.equal(v.flag, '1');
  assert.equal(v.hits.length, 0);
  // Proof the request would not have been blocked: pa.js itself skipped.
  const page = (await visit('example.test', { keepOpen: true })).page;
  assert.equal(await page.evaluate(() => window.privatus && window.privatus.isOptedOut()), true);
  await page.close();
});

test('mode A alone, first visit to a new origin: sync and inline tracker', async () => {
  await setMode('modeBlockRequests', false);
  await synced({ rules: 0 });
  const results = {};
  for (const [host, load] of [['app.example.test', 'sync'], ['cdn.example.test', 'inline'], ['shop.example.test', 'defer']]) {
    const v = await visit(host, { load });
    results[load] = { flag: v.flag, hits: v.hits.length };
  }
  console.log('# first visit, Mode A only: ' + JSON.stringify(results));
  for (const [load, r] of Object.entries(results)) {
    assert.equal(r.flag, '1', `${load}: flag set`);
    assert.equal(r.hits, 0, `${load}: nothing sent on the very first visit`);
  }
});

test('domain matching: www and subdomains covered, other.test counted', async () => {
  await setMode('modeBlockRequests', true);
  await synced({ rules: 1 });
  for (const host of ['www.example.test', 'blog.example.test']) {
    const v = await visit(host);
    assert.equal(v.hits.length, 0, `${host} not counted`);
    assert.equal(v.flag, '1', `${host} flag`);
  }
  const other = await visit('other.test');
  assert.equal(other.pageviews.length, 1, 'other.test is counted');
  assert.equal(other.flag, null);
});

test('domain matching with Mode B only: subdomains blocked, other.test counted', async () => {
  await setMode('modeLocalStorage', false);
  await visit('www.example.test'); await visit('blog.example.test'); // clear old flags
  for (const host of ['www.example.test', 'blog.example.test']) {
    const v = await visit(host);
    assert.equal(v.flag, null);
    assert.equal(v.hits.length, 0, `${host} blocked by DNR`);
  }
  assert.equal((await visit('other.test')).pageviews.length, 1);
  await setMode('modeLocalStorage', true);
});

test('SPA navigation: pushState on a listed site is still not counted', async () => {
  for (const modes of [{ a: true, b: true }, { a: false, b: true }, { a: true, b: false }]) {
    await setMode('modeLocalStorage', modes.a);
    await setMode('modeBlockRequests', modes.b);
    await synced({ rules: modes.b ? 1 : 0 });
    await visit('example.test'); // settle the flag for this mode
    const v = await visit('example.test', { keepOpen: true });
    await v.page.click('#spa');
    await sleep(300);
    await v.page.click('#spa');
    await sleep(1000);
    const spaHits = site.events.filter((e) => e.host === 'example.test' && e.body && /\/spa-\d+/.test(e.body.u || ''));
    assert.equal(spaHits.length, 0, `SPA pageviews with ${JSON.stringify(modes)}`);
    await v.page.close();
  }
  // Control: on a site that is not listed the same clicks are counted.
  const ctrl = await visit('other.test', { keepOpen: true });
  await ctrl.page.click('#spa');
  await sleep(1000);
  const spaOther = site.events.filter((e) => e.host === 'other.test' && /\/spa-\d+/.test(e.body.u || ''));
  assert.equal(spaOther.length, 1, 'SPA pageview counted on other.test');
  await ctrl.page.close();
  await setMode('modeLocalStorage', true);
  await setMode('modeBlockRequests', true);
});

test('custom endpoint patterns', async () => {
  await setMode('modeLocalStorage', false); // test blocking only
  const metricsHost = `metrics.example.test:${site.port}`;
  const metrics = `http://${metricsHost}`;
  await visit('example.test'); // clear the flag
  // A host + path pattern replaces the default: hits to metrics.example.test are
  // blocked, the page's own /api/event is no longer matched.
  await setPatterns(`${metricsHost}/api/event`);
  let s = await synced({ rules: 1 });
  assert.equal(s.rules[0].condition.urlFilter, `||${metricsHost}/api/event`);
  const toMetrics = await visit('example.test', { api: metrics });
  assert.equal(toMetrics.hits.length, 0, 'custom host pattern blocks');
  const toSelf = await visit('example.test');
  assert.equal(toSelf.pageviews.length, 1, 'default pattern no longer applies');
  // Raw urlFilter with a subdomain wildcard.
  await setPatterns('||*.metrics.example.test^');
  s = await synced({ rules: 1 });
  assert.equal(s.rules[0].condition.urlFilter, '||metrics.example.test^');
  assert.equal((await visit('example.test', { api: metrics })).hits.length, 0, 'wildcard pattern blocks');
  assert.equal((await visit('example.test')).pageviews.length, 1);
  // A full URL and the default together: both blocked.
  await setPatterns(`${metrics}/api/event\n/api/event^`);
  s = await synced({ rules: 2 });
  assert.deepEqual(s.rules.map((r) => r.condition.urlFilter).sort(), ['/api/event^', `|${metrics}/api/event`].sort());
  assert.equal((await visit('example.test', { api: metrics })).hits.length, 0);
  assert.equal((await visit('example.test')).hits.length, 0);
  // Invalid input is refused and nothing changes.
  const p = await options();
  await p.fill('#patterns', 'not a pattern with spaces');
  await p.click('#save-patterns');
  assert.match(await p.textContent('#patterns-status'), /^Invalid: /);
  assert.equal((await extensionState()).rules.length, 2);
  // Reset to default.
  await p.click('#reset-patterns');
  await waitFor(async () => (await p.textContent('#patterns-status')) === 'Saved.');
  s = await synced({ rules: 1 });
  assert.equal(s.rules[0].condition.urlFilter, '/api/event^');
});

test('popup on a listed site: toggle shows on, stats render', async () => {
  const v = await visit('example.test', { keepOpen: true });
  const popup = await browser.openPopup(v.page);
  await popup.waitForSelector('#main:not([hidden])');
  assert.equal(await popup.textContent('#host'), 'example.test');
  assert.equal(await popup.isChecked('#toggle'), true);
  assert.match(await popup.textContent('#hint'), /Active for example\.test and its subdomains/);
  await waitFor(async () => (await popup.textContent('#skips')) !== '–', { message: 'stats' });
  const skips = await popup.textContent('#skips');
  const blocked = await popup.textContent('#blocked');
  assert.ok(Number(skips) >= 1, `opted-out page loads on this tab: ${skips}`);
  assert.match(blocked, /^\d+$/, `blocked count: ${blocked}`);
  await popup.close();
  await v.page.close();
});

test('badge: counts on the tab', async () => {
  // Mode B only: the browser's own DNR action count.
  await setMode('modeLocalStorage', false);
  await visit('example.test'); // clear flag
  const v = await visit('example.test', { keepOpen: true });
  const tabId = await browser.ext(async (url) => (await chrome.tabs.query({ url: url.replace(/^http:\/\/([^:/]+):\d+/, '*://$1') + '*' }))[0].id, v.url);
  const dnrBadge = await browser.ext((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  const popup = await browser.openPopup(v.page);
  await waitFor(async () => /^\d+|n\/a$/.test(await popup.textContent('#blocked')), { message: 'blocked count' });
  const blocked = await popup.textContent('#blocked');
  await popup.close();
  await v.page.close();
  console.log(`# Mode B badge text: ${JSON.stringify(dnrBadge)}, popup blocked count: ${blocked}`);
  assert.equal(blocked, '1', 'popup shows the one blocked request');
  assert.equal(dnrBadge, '1', 'badge shows the browser\'s blocked count');

  // Mode A only: the extension sets the badge to opted-out page loads.
  await setMode('modeLocalStorage', true);
  await setMode('modeBlockRequests', false);
  await synced({ rules: 0 });
  const a = await visit('example.test', { keepOpen: true });
  const tabA = await browser.ext(async () => (await chrome.tabs.query({ url: '*://example.test/*' })).pop().id);
  const badgeA = await waitFor(() => browser.ext((id) => chrome.action.getBadgeText({ tabId: id }), tabA), { message: 'Mode A badge' });
  assert.equal(badgeA, '1');
  await a.page.close();
  await setMode('modeBlockRequests', true);
});

test('popup toggle off and on again (current tab)', async () => {
  const v = await visit('example.test', { keepOpen: true });
  let popup = await browser.openPopup(v.page);
  await popup.waitForSelector('#main:not([hidden])');
  await popup.click('#toggle');
  await waitFor(async () => /counted normally/.test(await popup.textContent('#hint')), { message: 'toggle off' });
  await popup.close();
  await synced({ rules: 0 });
  assert.equal(await v.page.evaluate(() => localStorage.getItem('privatus_optout')), null, 'flag removed in the open tab');
  const counted = await visit('example.test');
  assert.equal(counted.pageviews.length, 1, 'counted again after toggling off');

  popup = await browser.openPopup(v.page);
  await popup.waitForSelector('#main:not([hidden])');
  assert.equal(await popup.isChecked('#toggle'), false);
  await popup.click('#toggle');
  await waitFor(async () => /Active for example\.test/.test(await popup.textContent('#hint')), { message: 'toggle on' });
  await popup.close();
  await synced({ rules: 1 });
  assert.equal(await v.page.evaluate(() => localStorage.getItem('privatus_optout')), '1', 'flag set in the open tab');
  assert.equal((await visit('example.test')).hits.length, 0);
  await v.page.close();
});

test('removing a site through the options page: counted again, flag cleared', async () => {
  // Leave flags on the origins first.
  for (const h of ['example.test', 'www.example.test', 'blog.example.test']) assert.equal((await visit(h)).flag, '1');
  const open = await visit('www.example.test', { keepOpen: true });
  await removeSite('example.test');
  const s = await synced({ rules: 0 });
  assert.deepEqual(s.storage.domains, []);
  assert.deepEqual(s.storage.cleanup.map((c) => c.domain), ['example.test']);
  assert.deepEqual(s.scripts.map((c) => c.id), ['privatus-cleanup'], 'only the cleanup script is left');
  assert.equal(await open.page.evaluate(() => localStorage.getItem('privatus_optout')), null, 'flag cleared in the open tab right away');
  await open.page.close();
  for (const h of ['example.test', 'www.example.test', 'blog.example.test']) {
    const v = await visit(h);
    assert.equal(v.flag, null, `${h} flag cleared`);
    assert.equal(v.pageviews.length, 1, `${h} counted again`);
  }
});

test('restart: service worker stopped, rules and content script still work', async () => {
  await addSite('example.test');
  await synced({ rules: 1, scriptMatches: ['*://example.test/*'] });
  // Playwright's own debugger link keeps its worker handle, so the worker is
  // stopped and checked through chrome://serviceworker-internals.
  const internals = await browser.context.newPage();
  await internals.goto('chrome://serviceworker-internals/');
  const status = async () => {
    const text = await internals.evaluate(() => document.body.innerText);
    const block = text.slice(text.indexOf(`chrome-extension://${browser.id}/`));
    return (/Running Status: (\w+)/.exec(block) || [])[1];
  };
  await waitFor(async () => (await status()) === 'RUNNING', { message: 'worker running' });
  await internals.getByText('Stop', { exact: true }).first().click();
  await waitFor(async () => (await status()) === 'STOPPED', { message: 'worker stopped' });
  const v = await visit('blog.example.test');
  assert.equal(v.hits.length, 0, 'blocked while the worker is asleep');
  assert.equal(v.flag, '1', 'content script ran while the worker is asleep');
  // A storage change wakes it again, and the state is unchanged.
  await setMode('modeBlockRequests', false);
  await synced({ rules: 0 });
  await waitFor(async () => (await status()) === 'RUNNING', { message: 'worker running again' });
  await setMode('modeBlockRequests', true);
  await synced({ rules: 1, scriptMatches: ['*://example.test/*'] });
  await internals.close();
});

test('restart: browser relaunched with the same profile', async () => {
  optionsPage = null;
  await browser.close();
  await start();
  const s = await synced({ rules: 1, scriptMatches: ['*://example.test/*', '*://*.example.test/*'] });
  assert.deepEqual(s.storage.domains.map((d) => d.domain), ['example.test']);
  const v = await visit('www.example.test');
  assert.equal(v.hits.length, 0);
  assert.equal(v.flag, '1');
  assert.equal((await visit('other.test')).pageviews.length, 1);
  const p = await options();
  assert.deepEqual(await p.locator('#domains .domain').allTextContents(), ['example.test']);
});

test('options page rejects bad input', async () => {
  const p = await options();
  await p.fill('#add-input', 'not a domain!');
  await p.click('#add-form button[type=submit]');
  await p.waitForSelector('#add-error:not([hidden])');
  assert.match(await p.textContent('#add-error'), /doesn't look like a domain/);
});

test('popup on a page that cannot be opted out', async () => {
  const p = await options(); // a chrome-extension:// page
  const popup = await browser.openPopup(p);
  await popup.waitForSelector('#unsupported:not([hidden])');
  await popup.close();
});

test('no console errors on the extension pages or service worker', () => {
  assert.deepEqual(extensionErrors, []);
});
