/*
 * Cleanup content script. Registered ONLY for domains the user removed (for
 * 30 days) and, while the opt-out flag mode is off, for listed domains. It
 * removes the opt-out flag this extension set earlier, so the visits are
 * counted again. Never registered on a page the opt-out script covers.
 */
(function () {
  'use strict';
  try {
    if (localStorage.getItem('privatus_optout') === '1') localStorage.removeItem('privatus_optout');
  } catch (e) { /* storage blocked on this page */ }
})();
