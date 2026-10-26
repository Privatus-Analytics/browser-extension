/*
 * Pure helpers shared by the background worker, popup, options page and the
 * Node tests. No extension APIs in here.
 *
 * Loaded as a classic script (sets globalThis.PrivatusCore) or via require().
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrivatusCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_ENDPOINT_PATTERNS = ['/api/event^'];
  var CONTENT_SCRIPT_ID = 'privatus-optout';
  var CLEANUP_SCRIPT_ID = 'privatus-cleanup';
  var RULE_ID_BASE = 1000;
  var MAX_RULES = 100;
  var CLEANUP_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  var DEFAULT_SETTINGS = {
    domains: [],          // [{ domain: 'example.com', addedAt: 1730000000000 }]
    cleanup: [],          // [{ domain, removedAt }] — flag removed on next visit
    endpointPatterns: DEFAULT_ENDPOINT_PATTERNS.slice(),
    modeLocalStorage: true, // mode A
    modeBlockRequests: true // mode B
  };

  /**
   * Normalises user input or a URL into a bare hostname:
   * lowercase, no scheme/port/path/trailing dot, IDN kept as punycode if given.
   * Returns null for anything that is not a plausible public hostname.
   */
  function normalizeHostname(input) {
    if (input === null || input === undefined) return null;
    var s = String(input).trim().toLowerCase();
    if (!s) return null;
    // Strip scheme and anything after the host.
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
    s = s.replace(/^[^@\/]*@/, ''); // userinfo
    s = s.split(/[\/?#]/)[0];
    if (s.charAt(0) === '[') return null; // IPv6 literals are not supported
    s = s.replace(/:\d+$/, '');
    s = s.replace(/\.+$/, '');
    if (s.indexOf('*.') === 0) s = s.slice(2);
    if (!s || s.length > 253) return null;
    var labels = s.split('.');
    for (var i = 0; i < labels.length; i++) {
      if (!/^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/.test(labels[i])) return null;
    }
    return s;
  }

  /** Strips a leading "www." so a toggle covers the whole site. */
  function siteDomain(hostname) {
    var h = normalizeHostname(hostname);
    if (!h) return null;
    return h.indexOf('www.') === 0 && h.split('.').length > 2 ? h.slice(4) : h;
  }

  /** Only http(s) pages can be opted out (not chrome://, about:, file:, stores…). */
  function isTrackableUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
  }

  /** Is `hostname` equal to or a subdomain of `domain`? */
  function hostMatchesDomain(hostname, domain) {
    var h = normalizeHostname(hostname);
    var d = normalizeHostname(domain);
    if (!h || !d) return false;
    return h === d || h.slice(-(d.length + 1)) === '.' + d;
  }

  /** The listed domain entry covering a hostname, or null. */
  function findDomainFor(hostname, domains) {
    var list = domains || [];
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var d = typeof list[i] === 'string' ? list[i] : list[i].domain;
      if (hostMatchesDomain(hostname, d) && (!best || d.length > best.length)) best = d;
    }
    return best;
  }

  /** Host permission / content-script match patterns for a domain (+ subdomains). */
  function originPatternsFor(domain) {
    var d = normalizeHostname(domain);
    if (!d) return [];
    return ['*://' + d + '/*', '*://*.' + d + '/*'];
  }

  function matchesForDomains(domains) {
    var out = [];
    (domains || []).forEach(function (entry) {
      var d = typeof entry === 'string' ? entry : entry.domain;
      originPatternsFor(d).forEach(function (p) { if (out.indexOf(p) < 0) out.push(p); });
    });
    return out;
  }

  /**
   * Which content scripts to register, given the domains we have site access
   * to. Two scripts, so the opt-out one can set the flag at once, before any
   * page script runs, without first reading storage:
   *  - optout: listed domains while the opt-out flag mode is on;
   *  - cleanup: removed domains (for 30 days) and, while the mode is off,
   *    listed domains. Never on a page the optout script covers.
   * Returns registerContentScripts entries (without the static fields).
   */
  function planContentScripts(settings, grantedDomains) {
    var s = withDefaults(settings);
    var granted = (grantedDomains || []).map(normalizeHostname).filter(Boolean);
    var has = function (d) { return granted.indexOf(normalizeHostname(d)) >= 0; };
    var listed = s.domains.map(function (e) { return e.domain; }).filter(has);
    var removed = s.cleanup.map(function (e) { return e.domain; }).filter(has);
    var optoutDomains = s.modeLocalStorage ? listed : [];
    var cleanupDomains = removed.concat(s.modeLocalStorage ? [] : listed)
      .filter(function (d) { return !findDomainFor(d, optoutDomains); });
    var out = [];
    if (optoutDomains.length) {
      out.push({ id: CONTENT_SCRIPT_ID, js: ['content/optout.js'], matches: matchesForDomains(optoutDomains) });
    }
    if (cleanupDomains.length) {
      var entry = { id: CLEANUP_SCRIPT_ID, js: ['content/cleanup.js'], matches: matchesForDomains(cleanupDomains) };
      // A listed subdomain of a removed domain keeps its flag.
      if (optoutDomains.length) entry.excludeMatches = matchesForDomains(optoutDomains);
      out.push(entry);
    }
    return out;
  }

  /**
   * Validates and normalises an endpoint pattern into a declarativeNetRequest
   * urlFilter. Accepts:
   *  - a path: "/api/event", "/stats/api/event"
   *  - a host + path: "stats.example.com/api/event" -> "||stats.example.com/api/event"
   *  - a full URL: "https://stats.example.com/p/e" -> "|https://stats.example.com/p/e"
   *  - raw urlFilter syntax (starts with | or contains * or ^) is kept.
   * Returns null when invalid.
   */
  function endpointToUrlFilter(pattern) {
    if (pattern === null || pattern === undefined) return null;
    var p = String(pattern).trim();
    if (!p || p.length > 500) return null;
    if (/[\s"'<>\\]/.test(p) || /[^\x21-\x7e]/.test(p)) return null; // ASCII, no spaces
    if (p.indexOf('||') === 0 || p.charAt(0) === '|' || p.indexOf('*') >= 0 || p.indexOf('^') >= 0) {
      // "||*.example.com" -> "||example.com": "||" already covers subdomains,
      // and "||.example.com" would never match.
      return p.replace(/^\|\|\*\.?/, '||');
    }
    if (/^https?:\/\//i.test(p)) return '|' + p;
    if (p.charAt(0) === '/') return p;
    var slash = p.indexOf('/');
    var hostPart = slash >= 0 ? p.slice(0, slash) : p;
    var port = /:(\d{1,5})$/.exec(hostPart);
    var host = normalizeHostname(port ? hostPart.slice(0, port.index) : hostPart);
    if (!host || host.indexOf('.') < 0) return null;
    // Keep a port the user typed, or the filter could never match that URL.
    return '||' + host + (port ? ':' + port[1] : '') + (slash >= 0 ? p.slice(slash) : '/');
  }

  /**
   * declarativeNetRequest dynamic rules: block POSTs to the tracker endpoint
   * patterns when the request is initiated by a page on a listed domain.
   */
  function buildDnrRules(domains, endpointPatterns) {
    var initiatorDomains = [];
    (domains || []).forEach(function (entry) {
      var d = normalizeHostname(typeof entry === 'string' ? entry : entry.domain);
      if (d && initiatorDomains.indexOf(d) < 0) initiatorDomains.push(d);
    });
    if (!initiatorDomains.length) return [];
    var filters = [];
    (endpointPatterns && endpointPatterns.length ? endpointPatterns : DEFAULT_ENDPOINT_PATTERNS)
      .forEach(function (p) {
        var f = endpointToUrlFilter(p);
        if (f && filters.indexOf(f) < 0) filters.push(f);
      });
    return filters.slice(0, MAX_RULES).map(function (urlFilter, i) {
      return {
        id: RULE_ID_BASE + i + 1,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: urlFilter,
          initiatorDomains: initiatorDomains.slice(),
          requestMethods: ['post'],
          // main_frame is excluded by default; sub_frame navigations are not beacons.
          excludedResourceTypes: ['main_frame', 'sub_frame']
        }
      };
    });
  }

  /** Ids to remove + rules to add for updateDynamicRules. */
  function diffDynamicRules(existingRules, desiredRules) {
    return {
      removeRuleIds: (existingRules || [])
        .map(function (r) { return r.id; })
        .filter(function (id) { return id > RULE_ID_BASE && id <= RULE_ID_BASE + MAX_RULES; }),
      addRules: desiredRules || []
    };
  }

  /** Adds a domain (idempotent); returns a new settings object. */
  function addDomain(settings, input, now) {
    var d = siteDomain(input);
    if (!d) throw new Error('Not a valid domain: ' + input);
    var s = withDefaults(settings);
    var domains = s.domains.filter(function (e) { return e.domain !== d; });
    var existing = s.domains.filter(function (e) { return e.domain === d; })[0];
    domains.push(existing || { domain: d, addedAt: now || Date.now() });
    domains.sort(function (a, b) { return a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0; });
    var cleanup = s.cleanup.filter(function (e) { return e.domain !== d; });
    return Object.assign({}, s, { domains: domains, cleanup: cleanup });
  }

  /** Removes a domain and schedules localStorage cleanup for it. */
  function removeDomain(settings, input, now) {
    var d = siteDomain(input) || normalizeHostname(input);
    var s = withDefaults(settings);
    var had = s.domains.some(function (e) { return e.domain === d; });
    var domains = s.domains.filter(function (e) { return e.domain !== d; });
    var cleanup = s.cleanup.filter(function (e) { return e.domain !== d; });
    if (had) cleanup.push({ domain: d, removedAt: now || Date.now() });
    return Object.assign({}, s, { domains: domains, cleanup: cleanup });
  }

  function pruneCleanup(settings, now) {
    var s = withDefaults(settings);
    var t = now || Date.now();
    return Object.assign({}, s, {
      cleanup: s.cleanup.filter(function (e) { return t - (e.removedAt || 0) < CLEANUP_TTL_MS; })
    });
  }

  function withDefaults(settings) {
    var s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    s.domains = Array.isArray(s.domains) ? s.domains : [];
    s.cleanup = Array.isArray(s.cleanup) ? s.cleanup : [];
    s.endpointPatterns = Array.isArray(s.endpointPatterns) && s.endpointPatterns.length
      ? s.endpointPatterns : DEFAULT_ENDPOINT_PATTERNS.slice();
    return s;
  }

  /** Parses the options textarea (one pattern per line, # comments). */
  function parsePatternList(text) {
    var valid = [];
    var invalid = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var p = line.replace(/#.*$/, '').trim();
      if (!p) return;
      if (endpointToUrlFilter(p)) { if (valid.indexOf(p) < 0) valid.push(p); } else invalid.push(p);
    });
    return { valid: valid, invalid: invalid };
  }

  /** Badge text for a count (DNR-style: empty for 0, "999+" cap). */
  function badgeText(count) {
    var n = Number(count) || 0;
    if (n <= 0) return '';
    return n > 999 ? '999+' : String(n);
  }

  return {
    DEFAULT_ENDPOINT_PATTERNS: DEFAULT_ENDPOINT_PATTERNS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    CONTENT_SCRIPT_ID: CONTENT_SCRIPT_ID,
    CLEANUP_SCRIPT_ID: CLEANUP_SCRIPT_ID,
    RULE_ID_BASE: RULE_ID_BASE,
    MAX_RULES: MAX_RULES,
    normalizeHostname: normalizeHostname,
    siteDomain: siteDomain,
    isTrackableUrl: isTrackableUrl,
    hostMatchesDomain: hostMatchesDomain,
    findDomainFor: findDomainFor,
    originPatternsFor: originPatternsFor,
    matchesForDomains: matchesForDomains,
    planContentScripts: planContentScripts,
    endpointToUrlFilter: endpointToUrlFilter,
    buildDnrRules: buildDnrRules,
    diffDynamicRules: diffDynamicRules,
    addDomain: addDomain,
    removeDomain: removeDomain,
    pruneCleanup: pruneCleanup,
    withDefaults: withDefaults,
    parsePatternList: parsePatternList,
    badgeText: badgeText
  };
});
