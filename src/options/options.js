/* Options page: domains, modes and endpoint patterns (chrome.storage.local). */
(function () {
  'use strict';
  var api = typeof browser !== 'undefined' ? browser : chrome;
  var Core = window.PrivatusCore;
  var $ = function (id) { return document.getElementById(id); };
  var settings = Core.withDefaults({});

  async function load() {
    settings = Core.withDefaults(await api.storage.local.get(null));
    $('modeLocalStorage').checked = settings.modeLocalStorage;
    $('modeBlockRequests').checked = settings.modeBlockRequests;
    $('patterns').value = settings.endpointPatterns.join('\n');
    await renderDomains();
  }

  async function renderDomains() {
    var ul = $('domains');
    ul.textContent = '';
    $('empty').hidden = settings.domains.length > 0;
    for (var i = 0; i < settings.domains.length; i++) {
      var entry = settings.domains[i];
      var origins = Core.originPatternsFor(entry.domain);
      var granted = false;
      try { granted = await api.permissions.contains({ origins: origins }); } catch (e) { granted = false; }

      var li = document.createElement('li');
      var name = document.createElement('span');
      name.className = 'domain';
      name.textContent = entry.domain;
      li.appendChild(name);

      if (settings.modeLocalStorage && !granted) {
        var grant = document.createElement('button');
        grant.type = 'button';
        grant.className = 'secondary';
        grant.textContent = 'Allow opt-out flag';
        grant.title = 'Grant access to ' + entry.domain + ' so the extension can set the opt-out flag';
        grant.addEventListener('click', requestAccess.bind(null, origins));
        li.appendChild(grant);
      }

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'danger';
      remove.textContent = 'Remove';
      remove.addEventListener('click', removeDomain.bind(null, entry.domain));
      li.appendChild(remove);
      ul.appendChild(li);
    }
  }

  function requestAccess(origins) {
    api.permissions.request({ origins: origins }).then(function () {
      return api.runtime.sendMessage({ type: 'sync' });
    }).then(renderDomains).catch(function () {});
  }

  async function save(patch) {
    await api.storage.local.set(patch);
    Object.assign(settings, patch);
  }

  function addDomain(event) {
    event.preventDefault();
    $('add-error').hidden = true;
    var value = $('add-input').value;
    var domain = Core.siteDomain(value);
    if (!domain) {
      $('add-error').textContent = 'That doesn\'t look like a domain (e.g. example.com).';
      $('add-error').hidden = false;
      return;
    }
    // Ask for access in the same user gesture (only needed for the opt-out flag).
    var permission = settings.modeLocalStorage
      ? api.permissions.request({ origins: Core.originPatternsFor(domain) }).catch(function () { return false; })
      : Promise.resolve(false);
    permission.then(async function () {
      var next = Core.addDomain(settings, domain);
      await save({ domains: next.domains, cleanup: next.cleanup });
      $('add-input').value = '';
      await renderDomains();
    });
  }

  async function removeDomain(domain) {
    var next = Core.removeDomain(settings, domain);
    await save({ domains: next.domains, cleanup: next.cleanup });
    // Remove the flag right away in open tabs of that site (when we have access).
    try {
      var tabs = await api.tabs.query({ url: Core.originPatternsFor(domain) });
      await Promise.all(tabs.map(function (tab) {
        return api.scripting.executeScript({
          target: { tabId: tab.id },
          func: function () { try { localStorage.removeItem('privatus_optout'); } catch (e) { /* blocked */ } }
        }).catch(function () {});
      }));
    } catch (e) { /* no access: the content script cleans up on the next visit */ }
    await renderDomains();
  }

  function savePatterns() {
    var parsed = Core.parsePatternList($('patterns').value);
    if (parsed.invalid.length) {
      $('patterns-status').textContent = 'Invalid: ' + parsed.invalid.join(', ');
      return;
    }
    var list = parsed.valid.length ? parsed.valid : Core.DEFAULT_ENDPOINT_PATTERNS.slice();
    save({ endpointPatterns: list }).then(function () {
      $('patterns').value = list.join('\n');
      $('patterns-status').textContent = 'Saved.';
    });
  }

  $('add-form').addEventListener('submit', addDomain);
  $('save-patterns').addEventListener('click', savePatterns);
  $('reset-patterns').addEventListener('click', function () {
    $('patterns').value = Core.DEFAULT_ENDPOINT_PATTERNS.join('\n');
    savePatterns();
  });
  ['modeLocalStorage', 'modeBlockRequests'].forEach(function (id) {
    $(id).addEventListener('change', function (e) {
      var patch = {};
      patch[id] = e.target.checked;
      save(patch).then(renderDomains);
    });
  });
  api.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && (changes.domains || changes.cleanup)) load();
  });
  load();
})();
