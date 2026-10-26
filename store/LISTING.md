# Store listing: Privatus Analytics – Block my visits

Everything here is ready to paste into the Chrome Web Store, Firefox Add-ons
(AMO) and Microsoft Edge Add-ons. It was written from the code in version
1.0.1. If the code changes, check it again.

## Files to upload

| What | File | Where |
|---|---|---|
| Chrome and Edge package | `dist/privatus-block-my-visits-chrome-1.0.1.zip` | Chrome Web Store, Edge Add-ons |
| Firefox package | `dist/privatus-block-my-visits-firefox-1.0.1.zip` | AMO |
| Screenshot 1 (1280x800) | `store/screenshot-1-popup-on.png` | all three stores |
| Screenshot 2 (1280x800) | `store/screenshot-2-popup-toggle.png` | all three stores |
| Screenshot 3 (1280x800) | `store/screenshot-3-options.png` | all three stores |
| Small promo tile (440x280) | `store/promo-small-440x280.png` | Chrome Web Store, Edge |
| Store logo (300x300) | `store/logo-300x300.png` | Edge (Chrome and AMO take the icon from the package) |

Build the zips with `node scripts/build.mjs --zip`.

## Name

```
Privatus Analytics – Block my visits
```

## Summary

Chrome takes this from the package (manifest `description`, 109 characters,
under the 132 limit). Use the same text for the AMO summary and the Edge short
description.

```
Stop counting your own visits in Privatus Analytics, so your stats show only real visitors. Collects nothing.
```

## Full description

```
When you visit your own website, you get counted. You check a new page, fix a typo or look at a sale, and every visit adds to your numbers. Your stats go up for no reason, and you can't tell how many real people came.

This extension stops your own visits from being counted in Privatus Analytics. Turn it on for your site with one click, and your stats show only real visitors.

How to use it
1. Go to your own website.
2. Click the extension button in your browser's toolbar.
3. Tick "Don't count my visits on this site".

That's it. It covers the whole site, with or without "www." in front, and every part of it, like blog.yoursite.com or shop.yoursite.com. You can add, see and remove your sites on the settings page.

How it works
It uses two ways at once, so nothing slips through:
- It leaves a small note in your browser for your site that says "don't count me". The Privatus Analytics script sees the note and sends nothing. This is the same note the script's own opt-out button leaves.
- It stops the browser from sending visit data from your site to Privatus Analytics.
You can turn either one off on the settings page.

Private by design
- It collects nothing and sends nothing to anyone. Not to us, not to anyone else.
- Your list of sites stays in your browser.
- It only works on the sites you add. It asks to use a site only when you add it.
- No ads, no tracking, no account needed.

It is free and open source (MIT license): https://github.com/Privatus-Analytics/browser-extension
```

## Category

| Store | Category |
|---|---|
| Chrome Web Store | Productivity → Developer Tools |
| Edge Add-ons | Developer tools |
| AMO | Web Development (and Privacy & Security if a second one is offered) |

Language: English.

## Single purpose (Chrome Web Store, Privacy practices tab)

```
The extension has one purpose: to stop the user's own visits to their own websites from being counted by the Privatus Analytics tracker. The user picks their sites, and the extension tells the tracker on those sites not to count them and blocks the tracker's requests from those sites.
```

## Permission justifications (Chrome Web Store, Privacy practices tab)

**storage**

```
Saves the user's list of sites and their settings (which of the two ways to use and which tracker addresses to block) in the extension's own storage in the browser. A per-tab count of skipped page loads is kept in session memory and cleared when the browser closes. Nothing is sent anywhere.
```

**declarativeNetRequest**

```
Blocks POST requests to the Privatus Analytics tracker address (/api/event) when they come from a site the user added. The rules are built only from the user's own list of sites. The browser does the blocking; the extension never sees the requests or their content. This lets the extension work even if the user does not give it access to the site.
```

**scripting**

```
Registers one small content script that runs only on the sites the user added. It sets the opt-out flag (localStorage.privatus_optout = "1") that the Privatus Analytics tracker checks, so the tracker sends nothing. A second cleanup script removes that flag on sites the user removes. It is also used to set or remove the flag in the open tab right away when the user clicks the toggle. The scripts read nothing from the page except whether a Privatus Analytics script tag is present, for the badge count.
```

**activeTab**

```
When the user clicks the toolbar button, the popup reads the current tab's address to show the site's name and whether it is on the list, and reads how many tracker requests were blocked on that tab (declarativeNetRequest.getMatchedRules). This happens only after the user's click, and only for that tab.
```

**Host permissions** (the optional `*://*/*`)

```
Host access is optional and is never granted at install. When the user adds a site, the extension asks for access to that one site and its subdomains only (for example *://example.com/* and *://*.example.com/*), so it can set the opt-out flag there. If the user says no, request blocking still works without it. The extension never runs on sites the user did not add.
```

**Remote code**

```
No, I am not using remote code. All code is in the package. There is no eval, no remote scripts and no network requests made by the extension.
```

## Data usage (Chrome Web Store, Privacy practices tab)

Tick none of the data types. The extension collects none of these:
personally identifiable information, health information, financial and payment
information, authentication information, personal communications, location,
web history, user activity, website content.

Tick all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

AMO: the package declares `data_collection_permissions: { required: ["none"] }`,
so the form shows "This add-on does not collect data". Edge has no separate
data form; the privacy policy URL below covers it.

## Privacy policy URL

```
https://privatusanalytics.com/legal/privacy
```

Checked with curl on 2026-10-26: it returns 200. It is the Privatus Analytics
privacy policy and does not mention the extension yet. The extension collects
nothing, so the policy is only needed because the stores ask for one. A
sentence in the policy like "The Block my visits browser extension collects no
data and sends nothing to us" would make it match exactly.

There is no docs page for the extension yet:
`https://privatusanalytics.com/docs/integrations/browser-extension` returns 404.
The package's homepage link now points to the existing page about leaving out
your own visits, `https://privatusanalytics.com/docs/tracker/opt-out` (200).

## Support URL and website

| Field | Value |
|---|---|
| Support URL | `https://privatusanalytics.com/contact` |
| Issues (AMO "Support site" or Edge "Support") | `https://github.com/Privatus-Analytics/browser-extension/issues` |
| Website / homepage | `https://privatusanalytics.com/docs/tracker/opt-out` |
| Support email | the Privatus Analytics support address used on the other listings |

## AMO only

**License:** MIT License (pick "MIT" in the list). The full text is in `LICENSE`.

**Source code:** not needed. The code is plain JavaScript. Nothing is
minified, bundled, transpiled or generated. The zip is the `src/` folder
with one change: `scripts/build.mjs` writes a Firefox-only `manifest.json`
(it keeps `background.scripts` and drops the Chrome-only keys). Pick "No" for
"Do you need to submit source code?".

**Notes for reviewers:**

```
What it does: stops the user's own visits from being counted by the Privatus Analytics tracker (pa.js) on sites the user lists. It collects nothing and makes no network requests of its own.

Two ways, both on by default:
1. Opt-out flag: a content script registered with scripting.registerContentScripts, only for listed sites (after the user grants optional host access for that one site), sets localStorage.privatus_optout = "1" at document_start. pa.js checks this flag and sends nothing. A second content script removes the flag on sites the user removed (for 30 days).
2. Request blocking: declarativeNetRequest dynamic rules block POST requests matching /api/event^ when the initiator is a listed site.

How to test:
1. Install the add-on and open https://privatusanalytics.com/ (it runs the Privatus Analytics tracker).
2. Open the Network panel and reload. You see a POST to https://privatusstats.com/api/event.
3. Click the toolbar button and tick "Don't count my visits on this site". Allow access to privatusanalytics.com when asked.
4. Reload. The POST is gone (blocked), localStorage.privatus_optout is "1" (Storage panel), and privatus.isOptedOut() in the console returns true.
5. Open the settings page (Manage sites & endpoints) and click Remove. Reload: the flag is gone and the POST is sent again.

No account, login or server is needed. The code is plain JavaScript with no build step besides writing the Firefox manifest. Source: https://github.com/Privatus-Analytics/browser-extension
```

## Edge only

Edge takes the Chrome zip as is. Use the same name, descriptions, category,
screenshots and promo tile. Edge's "Short description" is the summary above.
For "Notes for certification", paste the AMO reviewer notes above (the
steps are the same in Edge; the Network panel is in DevTools, F12).

## Tested before upload

- Chromium (Playwright 1.64, Chromium build 1248), with the real pa.js and
  the real options page and toolbar popup: `npm run test:e2e`, 19 tests pass.
  Unit tests: `npm test`, 13 pass.
- Firefox: `web-ext lint --source-dir dist/firefox` shows 0 errors, 0
  warnings, 0 notices.
