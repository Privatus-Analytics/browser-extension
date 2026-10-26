# Privatus Analytics – Block my visits (browser extension)

A Manifest V3 WebExtension for **Chrome** (and Chromium browsers) and **Firefox**
that stops *your own* visits from being counted by
[Privatus Analytics](https://privatusanalytics.com) on the sites you choose —
handy for site owners, editors and developers.

- Popup toggle for the current tab: **"Don't count my visits on this site"**
  (covers the domain and its subdomains; a leading `www.` is dropped).
- Options page: list of sites, the two exclusion modes, custom tracker endpoints.
- Vanilla JS, no bundler, no dependencies, no remote code, no telemetry, no analytics.
  The only state is the site list and settings in `chrome.storage.local`
  (extension storage) plus a per-tab counter in `storage.session` (memory).

## How it works

**Mode A — opt-out flag (the official mechanism).** When you enable a site, the
extension asks for access to *that site only* (`optional_host_permissions`,
requested at toggle time) and registers a content script for it with
`chrome.scripting.registerContentScripts`. At `document_start`, before any
page script runs, it sets `localStorage.privatus_optout = "1"` in the site's
origin — exactly what `privatus.optOut()` does — and `pa.js` then sends nothing,
even on the very first visit and even if the tracker is inlined. Toggling off
removes the flag immediately in the current tab and, for 30 days, on your next
visit to any other origin of that site (subdomains have separate localStorage)
through a second, cleanup-only content script. No content script ever runs on
sites you did not list.

**Mode B — request blocking.** `declarativeNetRequest` dynamic rules block
`POST` requests whose URL matches a tracker endpoint pattern when the request is
initiated by a listed site (`condition.initiatorDomains`). The default pattern is
`/api/event^` (urlFilter syntax: `^` = end or separator). Add more patterns if
you need them, e.g. `privatusstats.com/api/event`. Blocking rules need no host
permission, so Mode B works even if you decline site access.

Both modes are on by default; either can be switched off on the options page.

### Badge counter

- **Chrome**: the extension calls
  `declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true })`,
  so the toolbar badge shows how many tracker requests were blocked on the current
  tab (maintained by the browser). We deliberately do **not** use
  `onRuleMatchedDebug` — it only exists for unpacked extensions — nor the
  `declarativeNetRequestFeedback` permission. The popup additionally reads
  `getMatchedRules({ tabId })`, which `activeTab` allows after you click the button.
- **Firefox / Mode B off**: the badge counts *opted-out page loads*: the Mode A
  content script tells the background when a page on a listed site contained a
  Privatus Analytics tracker script while the flag was set (those visits were skipped by
  `pa.js` itself, so there is no request to count). Setting badge text would hide
  the DNR count, so this fallback is only used when the DNR count is unavailable.

### Limitations

- Custom tracker endpoints on the same path as other `POST` APIs of your site would
  also be blocked for pages on listed sites — use a specific pattern.
- The flag is per browser profile; incognito/private windows need the extension
  allowed there.

## Install (development / unpacked)

`src/` is loadable as-is in both browsers (the manifest has
`background.service_worker` for Chrome and `background.scripts` for Firefox; each
browser ignores the other key with a warning).

- **Chrome**: `chrome://extensions` → Developer mode → *Load unpacked* → `src/`.
- **Firefox** (140+): `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `src/manifest.json`.

## Build store packages

```sh
node scripts/build.mjs          # dist/chrome, dist/firefox with browser-specific manifests
node scripts/build.mjs --zip    # also dist/*.zip (needs `zip`)
```

- `dist/chrome/manifest.json`: `background.service_worker` only, no `browser_specific_settings`.
- `dist/firefox/manifest.json`: `background.scripts` only (event page), gecko id
  `block-my-visits@privatusanalytics.com`, `data_collection_permissions: none`.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Your site list and settings (extension storage only). |
| `declarativeNetRequest` | Mode B blocking rules. |
| `scripting` | Register the opt-out content script for listed sites; set/remove the flag in the current tab. |
| `activeTab` | Read the current tab's hostname when you open the popup. |
| optional host access (per site) | Requested only when you enable a site, for Mode A. |

## Tests

Pure helpers (hostname normalisation, DNR rule builder, content script plan,
settings updates, manifest variants) are tested with the Node test runner:

```sh
npm test
```

End-to-end tests load the built extension into a real Chromium with
Playwright, serve a local test site with the real `pa.js`, and drive the real
options page and toolbar popup (both modes, subdomains, SPA navigation, custom
endpoints, removing a site, worker and browser restarts, the badge):

```sh
npm run test:e2e        # HEADED=1 to watch
```

They use a test-only copy of the build (`test/e2e/.build/`) whose manifest
grants the test hosts up front, because the site access prompt cannot be
clicked in automation; one more test runs the shipped `dist/chrome` unchanged.
The tracker is read from `../../../analytics/web/public/js/pa.js`; set
`PA_TRACKER` to use another copy.

`store/` holds the store listing text (`LISTING.md`) and images.

## License

MIT — see [LICENSE](LICENSE).
