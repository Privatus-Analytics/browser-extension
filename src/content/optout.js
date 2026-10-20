/*
 * Mode A content script. Registered (scripting.registerContentScripts) ONLY
 * for domains the user listed (and, for 30 days, domains they removed so the
 * flag can be cleaned up). Runs at document_start in the isolated world;
 * localStorage is shared with the page's origin, which is what pa.js reads.
 *
 * Reads the extension's own storage; sends nothing anywhere except a local
 * message to this extension's background (for the badge counter).
 */
(function () {
  'use strict';
  var api = typeof browser !== 'undefined' ? browser : chrome;
  var KEY = 'privatus_optout';
  var host = location.hostname.toLowerCase();

  function matches(domain) {
    return host === domain || host.slice(-(domain.length + 1)) === '.' + domain;
  }

  function trackerPresent() {
    return !!document.querySelector(
      'script[src*="/js/pa.js"], script[src*="/js/pa.auto.js"], script[data-site^="pa_"]'
    );
  }

  api.storage.local.get(['domains', 'cleanup', 'modeLocalStorage']).then(function (s) {
    var listed = (s.domains || []).some(function (e) { return matches(e.domain); });
    var cleanup = (s.cleanup || []).some(function (e) { return matches(e.domain); });
    var modeA = s.modeLocalStorage !== false;

    try {
      if (listed && modeA) {
        localStorage.setItem(KEY, '1');
      } else if (cleanup || (listed && !modeA)) {
        if (localStorage.getItem(KEY) === '1') localStorage.removeItem(KEY);
        return;
      } else {
        return;
      }
    } catch (e) {
      return; // storage blocked on this page
    }

    function report() {
      api.runtime.sendMessage({ type: 'optout-pageload', trackerDetected: trackerPresent() })
        .catch(function () { /* background asleep / reloading */ });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', report, { once: true });
    } else {
      report();
    }
  });
})();
