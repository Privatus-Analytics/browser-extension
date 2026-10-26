'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/lib/core.js');

const src = path.join(__dirname, '..', 'src');

test('normalizeHostname', () => {
  assert.equal(Core.normalizeHostname('https://WWW.Example.com:8443/path?q=1#x'), 'www.example.com');
  assert.equal(Core.normalizeHostname('example.com.'), 'example.com');
  assert.equal(Core.normalizeHostname('  blog.example.co.uk  '), 'blog.example.co.uk');
  assert.equal(Core.normalizeHostname('user:pw@shop.example.com/x'), 'shop.example.com');
  assert.equal(Core.normalizeHostname('*.example.com'), 'example.com');
  assert.equal(Core.normalizeHostname('localhost'), 'localhost');
  assert.equal(Core.normalizeHostname('xn--bcher-kva.example'), 'xn--bcher-kva.example');
  for (const bad of ['', null, undefined, 'exa mple.com', '-bad.com', 'a..b', 'http://[::1]/', 'ex!ample.com']) {
    assert.equal(Core.normalizeHostname(bad), null, String(bad));
  }
});

test('siteDomain strips www only when there is a parent', () => {
  assert.equal(Core.siteDomain('https://www.example.com/'), 'example.com');
  assert.equal(Core.siteDomain('www.com'), 'www.com');
  assert.equal(Core.siteDomain('app.example.com'), 'app.example.com');
});

test('isTrackableUrl', () => {
  assert.ok(Core.isTrackableUrl('https://example.com/'));
  assert.ok(Core.isTrackableUrl('http://localhost:3000/'));
  assert.ok(!Core.isTrackableUrl('chrome://extensions'));
  assert.ok(!Core.isTrackableUrl('about:blank'));
  assert.ok(!Core.isTrackableUrl(undefined));
});

test('domain matching', () => {
  assert.ok(Core.hostMatchesDomain('www.example.com', 'example.com'));
  assert.ok(Core.hostMatchesDomain('example.com', 'example.com'));
  assert.ok(!Core.hostMatchesDomain('badexample.com', 'example.com'));
  const domains = [{ domain: 'example.com' }, { domain: 'shop.example.com' }];
  assert.equal(Core.findDomainFor('a.shop.example.com', domains), 'shop.example.com');
  assert.equal(Core.findDomainFor('www.example.com', domains), 'example.com');
  assert.equal(Core.findDomainFor('other.org', domains), null);
});

test('origin patterns', () => {
  assert.deepEqual(Core.originPatternsFor('Example.com'), ['*://example.com/*', '*://*.example.com/*']);
  assert.deepEqual(Core.matchesForDomains([{ domain: 'a.com' }, 'a.com']), ['*://a.com/*', '*://*.a.com/*']);
});

test('endpointToUrlFilter', () => {
  assert.equal(Core.endpointToUrlFilter('/api/event^'), '/api/event^');
  assert.equal(Core.endpointToUrlFilter('/collect'), '/collect');
  assert.equal(Core.endpointToUrlFilter('stats.example.com/api/event'), '||stats.example.com/api/event');
  assert.equal(Core.endpointToUrlFilter('stats.example.com'), '||stats.example.com/');
  assert.equal(Core.endpointToUrlFilter('https://stats.example.com/e'), '|https://stats.example.com/e');
  assert.equal(Core.endpointToUrlFilter('||*.example.com/e'), '||example.com/e');
  assert.equal(Core.endpointToUrlFilter('||*example.com/e'), '||example.com/e');
  assert.equal(Core.endpointToUrlFilter('stats.example.com:8443/api/event'), '||stats.example.com:8443/api/event');
  assert.equal(Core.endpointToUrlFilter('stats.example.com:8443'), '||stats.example.com:8443/');
  for (const bad of ['', ' ', 'has space/x', 'ünï/x', 'nodot/x', '"x"']) {
    assert.equal(Core.endpointToUrlFilter(bad), null, bad);
  }
});

test('buildDnrRules', () => {
  assert.deepEqual(Core.buildDnrRules([], ['/api/event^']), []);
  const rules = Core.buildDnrRules(
    [{ domain: 'example.com' }, { domain: 'shop.org' }, { domain: 'example.com' }],
    ['/api/event^', 'privatusanalytics.com/api/event', 'bad pattern', '/api/event^']
  );
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], {
    id: Core.RULE_ID_BASE + 1,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '/api/event^',
      initiatorDomains: ['example.com', 'shop.org'],
      requestMethods: ['post'],
      excludedResourceTypes: ['main_frame', 'sub_frame']
    }
  });
  assert.equal(rules[1].condition.urlFilter, '||privatusanalytics.com/api/event');
  // falls back to the default endpoint
  assert.equal(Core.buildDnrRules(['a.com'], [])[0].condition.urlFilter, '/api/event^');
  // unique ids, within our range
  const many = Core.buildDnrRules(['a.com'], Array.from({ length: 150 }, (_, i) => `/e${i}`));
  assert.equal(many.length, Core.MAX_RULES);
  assert.equal(new Set(many.map((r) => r.id)).size, Core.MAX_RULES);
});

test('diffDynamicRules removes only our ids', () => {
  const diff = Core.diffDynamicRules([{ id: 5 }, { id: 1001 }, { id: 1100 }, { id: 1101 }], [{ id: 1001 }]);
  assert.deepEqual(diff.removeRuleIds, [1001, 1100]);
  assert.deepEqual(diff.addRules, [{ id: 1001 }]);
});

test('add/remove domains and cleanup', () => {
  let s = Core.withDefaults({});
  s = Core.addDomain(s, 'https://www.b.com/x', 1);
  s = Core.addDomain(s, 'a.com', 2);
  s = Core.addDomain(s, 'a.com', 3);
  assert.deepEqual(s.domains, [{ domain: 'a.com', addedAt: 2 }, { domain: 'b.com', addedAt: 1 }]);
  assert.throws(() => Core.addDomain(s, 'not a domain'), /valid domain/);
  s = Core.removeDomain(s, 'b.com', 10);
  assert.deepEqual(s.domains.map((d) => d.domain), ['a.com']);
  assert.deepEqual(s.cleanup, [{ domain: 'b.com', removedAt: 10 }]);
  s = Core.addDomain(s, 'b.com', 11);
  assert.deepEqual(s.cleanup, []);
  s = Core.removeDomain(s, 'b.com', 5);
  assert.equal(Core.pruneCleanup(s, 31 * 24 * 3600 * 1000).cleanup.length, 0);
  assert.equal(Core.pruneCleanup(s, 1000).cleanup.length, 1);
});

test('planContentScripts: opt-out script on listed sites, cleanup elsewhere', () => {
  const settings = {
    domains: [{ domain: 'example.com' }, { domain: 'blog.shop.com' }, { domain: 'nogrant.com' }],
    cleanup: [{ domain: 'shop.com', removedAt: 1 }, { domain: 'old.example.com', removedAt: 1 }],
    modeLocalStorage: true
  };
  const granted = ['example.com', 'blog.shop.com', 'shop.com', 'old.example.com'];
  const plan = Core.planContentScripts(settings, granted);
  assert.deepEqual(plan.map((p) => p.id), [Core.CONTENT_SCRIPT_ID, Core.CLEANUP_SCRIPT_ID]);
  assert.deepEqual(plan[0].js, ['content/optout.js']);
  assert.deepEqual(plan[0].matches, ['*://example.com/*', '*://*.example.com/*', '*://blog.shop.com/*', '*://*.blog.shop.com/*']);
  // old.example.com is still covered by the listed example.com, so no cleanup there;
  // the removed shop.com is cleaned up except on the listed blog.shop.com.
  assert.deepEqual(plan[1].js, ['content/cleanup.js']);
  assert.deepEqual(plan[1].matches, ['*://shop.com/*', '*://*.shop.com/*']);
  assert.deepEqual(plan[1].excludeMatches, plan[0].matches);

  // Opt-out flag mode off: listed sites get the cleanup script instead.
  const off = Core.planContentScripts({ ...settings, modeLocalStorage: false }, granted);
  assert.deepEqual(off.map((p) => p.id), [Core.CLEANUP_SCRIPT_ID]);
  assert.ok(off[0].matches.includes('*://*.example.com/*'));
  assert.ok(off[0].matches.includes('*://*.shop.com/*'));
  assert.equal(off[0].excludeMatches, undefined);

  assert.deepEqual(Core.planContentScripts({ domains: [{ domain: 'a.com' }] }, []), [], 'no site access, no scripts');
});

test('parsePatternList and badgeText', () => {
  assert.deepEqual(Core.parsePatternList('/api/event^\n# comment\n\nstats.x.com/e # pixel\nbad one\n/api/event^'),
    { valid: ['/api/event^', 'stats.x.com/e'], invalid: ['bad one'] });
  assert.equal(Core.badgeText(0), '');
  assert.equal(Core.badgeText(7), '7');
  assert.equal(Core.badgeText(5000), '999+');
});

test('manifest is valid MV3 for Chrome and Firefox', async () => {
  const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.service_worker, 'background.js');
  assert.deepEqual(m.background.scripts, ['lib/core.js', 'background.js']);
  assert.match(m.browser_specific_settings.gecko.id, /@/);
  assert.deepEqual(m.optional_host_permissions, ['*://*/*']);
  assert.ok(!m.host_permissions, 'no install-time host permissions');
  for (const p of ['storage', 'declarativeNetRequest', 'scripting', 'activeTab']) assert.ok(m.permissions.includes(p), p);
  // every referenced file exists
  const files = [m.background.service_worker, ...m.background.scripts, m.action.default_popup, m.options_ui.page,
    ...Object.values(m.icons), ...Object.values(m.action.default_icon), 'content/optout.js', 'content/cleanup.js'];
  for (const f of files) assert.ok(fs.existsSync(path.join(src, f)), f);

  const { chromeManifest, firefoxManifest } = await import('../scripts/build.mjs');
  const c = chromeManifest(m);
  assert.deepEqual(c.background, { service_worker: 'background.js' });
  assert.equal(c.browser_specific_settings, undefined);
  const f = firefoxManifest(m);
  assert.deepEqual(f.background, { scripts: ['lib/core.js', 'background.js'] });
  assert.equal(f.minimum_chrome_version, undefined);
  assert.equal(f.browser_specific_settings.gecko.id, m.browser_specific_settings.gecko.id);
});

test('no remote code or telemetry in the extension sources', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  for (const file of walk(src).filter((f) => /\.(js|html)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|\beval\(|new Function\(/.test(text), file);
    assert.ok(!/<script[^>]+src=["']https?:/.test(text), file);
  }
});
