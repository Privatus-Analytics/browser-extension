/*
 * Background: keeps declarativeNetRequest rules (mode B) and the registered
 * content script (mode A) in sync with the domain list in storage.local.
 * Chrome runs this as a service worker, Firefox as an event page
 * (manifest background.scripts loads lib/core.js first).
 */
/* global PrivatusCore, importScripts */
if (typeof PrivatusCore === 'undefined' && typeof importScripts === 'function') {
  importScripts('lib/core.js');
}

var api = typeof browser !== 'undefined' ? browser : chrome;
var Core = PrivatusCore;

var dnr = api.declarativeNetRequest;
var supportsActionCount = !!(dnr && typeof dnr.setExtensionActionOptions === 'function');

async function loadSettings() {
  var raw = await api.storage.local.get(null);
  return Core.withDefaults(raw);
}

async function syncRules(settings) {
  if (!dnr) return;
  var desired = settings.modeBlockRequests ? Core.buildDnrRules(settings.domains, settings.endpointPatterns) : [];
  var existing = await dnr.getDynamicRules();
  var diff = Core.diffDynamicRules(existing, desired);
  await dnr.updateDynamicRules(diff);
}

/** Registers the opt-out content script for listed domains we have access to. */
async function syncContentScript(settings) {
  if (!api.scripting || !api.scripting.registerContentScripts) return;
  try {
    await api.scripting.unregisterContentScripts({ ids: [Core.CONTENT_SCRIPT_ID] });
  } catch (e) { /* not registered */ }

  // Listed domains (mode A) + removed domains awaiting cleanup. When mode A is
  // off the script still runs on listed domains to remove a previously set flag.
  var candidates = settings.domains.concat(settings.cleanup);
  var granted = [];
  for (var i = 0; i < candidates.length; i++) {
    var origins = Core.originPatternsFor(candidates[i].domain);
    if (!origins.length) continue;
    var ok = false;
    try { ok = await api.permissions.contains({ origins: origins }); } catch (e) { ok = false; }
    if (ok) granted = granted.concat(origins);
  }
  if (!granted.length) return;
  await api.scripting.registerContentScripts([{
    id: Core.CONTENT_SCRIPT_ID,
    matches: granted,
    js: ['content/optout.js'],
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: true
  }]);
}

var syncing = Promise.resolve();
function sync() {
  syncing = syncing.then(async function () {
    var settings = await loadSettings();
    await syncRules(settings);
    await syncContentScript(settings);
  }).catch(function (e) { console.warn('Privatus Analytics: sync failed', e); });
  return syncing;
}

async function init() {
  var raw = await api.storage.local.get(null);
  var pruned = Core.pruneCleanup(raw);
  var patch = { cleanup: pruned.cleanup };
  if (!Array.isArray(raw.endpointPatterns)) patch.endpointPatterns = pruned.endpointPatterns;
  if (raw.modeLocalStorage === undefined) patch.modeLocalStorage = true;
  if (raw.modeBlockRequests === undefined) patch.modeBlockRequests = true;
  if (!Array.isArray(raw.domains)) patch.domains = [];
  await api.storage.local.set(patch);
  if (supportsActionCount) {
    // Chrome shows the number of requests blocked by our rules on each tab.
    try { await dnr.setExtensionActionOptions({ displayActionCountAsBadgeText: true }); } catch (e) { /* unsupported */ }
  }
  await sync();
}

api.runtime.onInstalled.addListener(function () { init(); });
api.runtime.onStartup.addListener(function () { init(); });

api.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.domains || changes.cleanup || changes.endpointPatterns ||
      changes.modeLocalStorage || changes.modeBlockRequests) {
    sync();
  }
});

api.permissions.onAdded && api.permissions.onAdded.addListener(function () { sync(); });
api.permissions.onRemoved && api.permissions.onRemoved.addListener(function () { sync(); });

/*
 * Mode A counter: page loads on a listed site where the tracker was present
 * but told to stay quiet. Kept in storage.session (memory only, per browser
 * session). Shown as the badge only when DNR's own action count is not in use
 * (Firefox, or mode B turned off) — setting badge text would hide it.
 */
var session = api.storage.session || null;

async function bumpTabCount(tabId) {
  var key = 'skips:' + tabId;
  var current = 0;
  if (session) {
    var got = await session.get(key);
    current = got[key] || 0;
  }
  current += 1;
  if (session) {
    var patch = {};
    patch[key] = current;
    await session.set(patch);
  }
  var settings = await loadSettings();
  if (!supportsActionCount || !settings.modeBlockRequests) {
    await api.action.setBadgeText({ tabId: tabId, text: Core.badgeText(current) });
    await api.action.setBadgeBackgroundColor({ tabId: tabId, color: '#4b5563' });
  }
  return current;
}

function handleMessage(message, sender) {
  if (!message || sender.id !== api.runtime.id) return null;
  if (message.type === 'optout-pageload' && sender.tab && message.trackerDetected) {
    return bumpTabCount(sender.tab.id).then(function (n) { return { count: n }; });
  }
  if (message.type === 'tab-skips' && typeof message.tabId === 'number') {
    if (!session) return Promise.resolve({ count: 0 });
    var key = 'skips:' + message.tabId;
    return session.get(key).then(function (got) { return { count: got[key] || 0 }; });
  }
  if (message.type === 'sync') {
    return sync().then(function () { return { ok: true }; });
  }
  return null;
}

// sendResponse + `return true` works in both Chrome and Firefox.
api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  var pending = handleMessage(message, sender);
  if (!pending) return false;
  pending.then(sendResponse, function (e) { sendResponse({ error: String(e) }); });
  return true;
});

api.tabs.onRemoved.addListener(function (tabId) {
  if (session) session.remove('skips:' + tabId);
});
