/*
 * Mode A content script. Registered (scripting.registerContentScripts) ONLY
 * for domains the user listed, while the opt-out flag mode is on. It runs at
 * document_start in the isolated world; localStorage is shared with the
 * page's origin, which is what pa.js reads.
 *
 * The flag is set straight away, before any page script runs, so even an
 * inline tracker on the very first visit sees it. Storage is read afterwards
 * only to undo that if the site was removed a moment ago.
 *
 * Sends nothing anywhere except a local message to this extension's
 * background (for the badge counter).
 */
(function () {
  'use strict';
  var api = typeof browser !== 'undefined' ? browser : chrome;
  var KEY = 'privatus_optout';
  var host = location.hostname.toLowerCase();

  try {
    localStorage.setItem(KEY, '1');
  } catch (e) {
    return; // storage blocked on this page
  }

  function matches(domain) {
    return host === domain || host.slice(-(domain.length + 1)) === '.' + domain;
  }

  function trackerPresent() {
    return !!document.querySelector(
      'script[src*="/js/pa.js"], script[src*="/js/pa.auto.js"], script[data-site^="pa_"]'
    );
  }

  function report() {
    api.runtime.sendMessage({ type: 'optout-pageload', trackerDetected: trackerPresent() })
      .catch(function () { /* background asleep / reloading */ });
  }

  api.storage.local.get(['domains', 'modeLocalStorage']).then(function (s) {
    var listed = (s.domains || []).some(function (e) { return matches(e.domain); });
    if (!listed || s.modeLocalStorage === false) {
      // Settings changed before the registration caught up.
      try { localStorage.removeItem(KEY); } catch (e) { /* blocked */ }
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', report, { once: true });
    } else {
      report();
    }
  });
})();
