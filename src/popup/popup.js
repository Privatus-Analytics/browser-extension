/* Popup: per-site toggle for the current tab's hostname. */
(function () {
  'use strict';
  var api = typeof browser !== 'undefined' ? browser : chrome;
  var Core = window.PrivatusCore;
  var $ = function (id) { return document.getElementById(id); };

  var state = { tab: null, host: null, settings: null };

  function showError(e) {
    $('error').textContent = String((e && e.message) || e);
    $('error').hidden = false;
  }

  function setFlagInTab(tabId, on) {
    // Runs in the page's origin so localStorage is the site's own storage.
    return api.scripting.executeScript({
      target: { tabId: tabId },
      func: function (enable) {
        try {
          if (enable) localStorage.setItem('privatus_optout', '1');
          else localStorage.removeItem('privatus_optout');
          return true;
        } catch (e) { return false; }
      },
      args: [on]
    }).catch(function () { return null; }); // no host permission: content script handles it later
  }

  function render() {
    var s = state.settings;
    var listed = Core.findDomainFor(state.host, s.domains);
    $('host').textContent = state.host;
    $('toggle').checked = !!listed;
    var modes = [];
    if (s.modeLocalStorage) modes.push('opt-out flag');
    if (s.modeBlockRequests) modes.push('request blocking');
    $('hint').textContent = listed
      ? 'Active for ' + listed + ' and its subdomains (' + (modes.join(' + ') || 'no mode enabled') + '). Reload the page if it was already open.'
      : 'Your visits to ' + Core.siteDomain(state.host) + ' are counted normally.';
  }

  async function refreshStats() {
    $('stats').hidden = false;
    var dnr = api.declarativeNetRequest;
    if (dnr && dnr.getMatchedRules) {
      try {
        // Allowed without extra permission thanks to activeTab (popup click).
        var res = await dnr.getMatchedRules({ tabId: state.tab.id });
        $('blocked').textContent = String((res.rulesMatchedInfo || []).length);
      } catch (e) { $('blocked').textContent = 'n/a'; }
    } else {
      $('blocked').textContent = 'n/a';
    }
    try {
      var r = await api.runtime.sendMessage({ type: 'tab-skips', tabId: state.tab.id });
      $('skips').textContent = String((r && r.count) || 0);
    } catch (e) { $('skips').textContent = '0'; }
  }

  function onToggle(event) {
    var on = event.target.checked;
    var s = state.settings;
    var domain = on ? Core.siteDomain(state.host) : Core.findDomainFor(state.host, s.domains);
    // permissions.request must run synchronously inside the click handler.
    var permission = on && s.modeLocalStorage
      ? api.permissions.request({ origins: Core.originPatternsFor(domain) })
      : Promise.resolve(false);

    permission.catch(function () { return false; }).then(async function (granted) {
      var next = on ? Core.addDomain(s, domain) : Core.removeDomain(s, domain);
      await api.storage.local.set({ domains: next.domains, cleanup: next.cleanup });
      state.settings = next;
      if (on && granted) await setFlagInTab(state.tab.id, true);
      if (!on) await setFlagInTab(state.tab.id, false);
      await api.runtime.sendMessage({ type: 'sync' }).catch(function () {});
      render();
    }).catch(showError);
  }

  async function init() {
    var tabs = await api.tabs.query({ active: true, currentWindow: true });
    state.tab = tabs[0];
    state.settings = Core.withDefaults(await api.storage.local.get(null));
    if (!state.tab || !Core.isTrackableUrl(state.tab.url)) {
      $('unsupported').hidden = false;
      return;
    }
    state.host = Core.normalizeHostname(state.tab.url);
    if (!state.host) { $('unsupported').hidden = false; return; }
    $('main').hidden = false;
    render();
    refreshStats();
  }

  $('toggle').addEventListener('change', onToggle);
  $('options').addEventListener('click', function (e) {
    e.preventDefault();
    api.runtime.openOptionsPage();
    window.close();
  });
  init().catch(showError);
})();
