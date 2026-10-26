// Store images from the real extension: the real popup and options page in
// Chromium, on a neutral demo shop (myshop.example). Writes to ../../store/.
//
//   node scripts/build.mjs && cd test/e2e && node screenshots.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startSite } from './server.mjs';
import { root, here, prepareTestExtension, launch, newProfileDir, sleep, waitFor } from './harness.mjs';

const out = join(root, 'store');
mkdirSync(out, { recursive: true });
const work = join(here, '.build', 'shots');
mkdirSync(work, { recursive: true });

const dataUri = (buf) => 'data:image/png;base64,' + buf.toString('base64');
const icon128 = readFileSync(join(root, 'src', 'icons', 'icon-128.png'));
const icon32 = readFileSync(join(root, 'src', 'icons', 'icon-32.png'));

const site = await startSite();
const browser = await launch(prepareTestExtension(), newProfileDir('shots'));
const { context, id } = browser;

async function render(html, file, width, height, { transparent = false } = {}) {
  const path = join(work, file.replace(/\.png$/, '.html'));
  writeFileSync(path, html);
  const page = await context.newPage();
  await page.setViewportSize({ width, height });
  await page.goto('file://' + path);
  await page.waitForLoadState('load');
  await page.screenshot({ path: join(out, file), omitBackground: transparent });
  await page.close();
  console.log('wrote', join(out, file));
}

// 1. Sites list on the options page.
const options = await context.newPage();
await options.goto(`chrome-extension://${id}/options/options.html`);
await waitFor(async () => (await options.inputValue('#patterns')) !== '');
for (const domain of ['myshop.example', 'acme.example', 'travelblog.example']) {
  await options.fill('#add-input', domain);
  await options.click('#add-form button[type=submit]');
  await waitFor(async () => (await options.locator('#domains .domain').allTextContents()).includes(domain));
}

// The demo shop with the extension on (listed), and the real popup.
async function shopWithPopup(host, kind = 'shop') {
  const page = await context.newPage();
  await page.setViewportSize({ width: 820, height: 600 });
  await page.goto(`http://${host}:${site.port}/shop-demo?kind=${kind}`);
  await sleep(1500);
  const shop = await page.screenshot();
  const popup = await browser.openPopup(page);
  await popup.waitForSelector('#main:not([hidden])');
  await waitFor(async () => (await popup.textContent('#skips')) !== '–');
  await sleep(300);
  const popupShot = await popup.locator('body').screenshot();
  await popup.close();
  await page.close();
  return { shop, popupShot };
}

function browserFrame({ host, shop, popupShot, title, sub }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box} body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    background:linear-gradient(135deg,#4f46e5 0%,#3730a3 60%,#312e81 100%);position:relative}
  .caption{position:absolute;left:56px;top:0;bottom:0;width:340px;display:flex;flex-direction:column;justify-content:center;color:#fff}
  .caption h1{font-size:44px;line-height:1.12;margin:0 0 18px;font-weight:750}
  .caption p{font-size:21px;line-height:1.45;margin:0;opacity:.95}
  .win{position:absolute;left:420px;top:70px;width:822px;height:662px;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.35)}
  .bar{height:60px;background:#f3f4f6;border-bottom:1px solid #d1d5db;display:flex;align-items:center;gap:12px;padding:0 14px}
  .dots{display:flex;gap:7px} .dots i{width:12px;height:12px;border-radius:50%;background:#d1d5db;display:block}
  .url{flex:1;background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:7px 16px;font-size:14px;color:#374151}
  .ext{width:32px;height:32px;border-radius:7px;background:#e0e7ff;display:flex;align-items:center;justify-content:center}
  .ext img{width:18px;height:18px}
  .shop{display:block;width:820px;height:600px}
  .popup{position:absolute;top:126px;right:46px;border-radius:10px;box-shadow:0 14px 44px rgba(0,0,0,.30);border:1px solid #d1d5db;background:#fff;overflow:hidden}
  .popup img{display:block}
  </style></head><body>
  <div class="caption"><h1>${title}</h1><p>${sub}</p></div>
  <div class="win"><div class="bar"><div class="dots"><i></i><i></i><i></i></div><div class="url">${host}</div><div class="ext"><img src="${dataUri(icon32)}"></div></div>
  <img class="shop" src="${dataUri(shop)}"></div>
  <div class="popup"><img src="${dataUri(popupShot)}"></div>
  </body></html>`;
}

const listed = await shopWithPopup('myshop.example');
await render(browserFrame({
  host: 'myshop.example', ...listed,
  title: 'Your own visits stop counting',
  sub: 'Turn it on for your site. Then your stats show only real visitors, not you.'
}), 'screenshot-1-popup-on.png', 1280, 800);

// A site that is not listed yet: the one-click toggle, still off.
const notListed = await shopWithPopup('mybakery.example', 'bakery');
await render(browserFrame({
  host: 'mybakery.example', ...notListed,
  title: 'One click on your own site',
  sub: 'Open the button while you are on your site and tick the box. That is all.'
}), 'screenshot-2-popup-toggle.png', 1280, 800);

// 3. The options page as it is, at 1280x800.
await options.reload();
await options.waitForSelector('#domains .domain');
await options.setViewportSize({ width: 1280, height: 800 });
await options.screenshot({ path: join(out, 'screenshot-3-options.png') });
console.log('wrote', join(out, 'screenshot-3-options.png'));

// Small promo tile 440x280 (Chrome Web Store, Edge).
const iconCss = `background:url(${dataUri(icon128)}) center/contain no-repeat`;
await render(`<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:440px;height:280px;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    background:linear-gradient(135deg,#4f46e5,#312e81);color:#fff;display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box}
  .icon{width:96px;height:96px;flex:none;${iconCss};filter:drop-shadow(0 6px 16px rgba(0,0,0,.3))}
  h1{font-size:30px;line-height:1.1;margin:0 0 10px;font-weight:750} p{font-size:17px;line-height:1.35;margin:0;opacity:.95}
  small{display:block;margin-top:12px;font-size:13px;opacity:.8}
  </style></head><body><div class="icon"></div><div><h1>Block my visits</h1>
  <p>Stop counting your own visits, so your stats show real visitors.</p><small>For Privatus Analytics</small></div></body></html>`,
  'promo-small-440x280.png', 440, 280);

// Store logo 300x300 (Edge asks for 1:1, 300x300 recommended): the 128px icon
// drawn as a vector at full size, so it is not blurry.
await render(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;width:300px;height:300px;background:transparent}</style></head><body>
  <svg width="300" height="300" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
    <circle cx="64" cy="64" r="60" fill="#4f46e5"/>
    <circle cx="64" cy="64" r="32" fill="none" stroke="#fff" stroke-width="11"/>
    <line x1="42" y1="86" x2="86" y2="42" stroke="#fff" stroke-width="11"/>
  </svg></body></html>`, 'logo-300x300.png', 300, 300, { transparent: true });

await browser.close();
await site.close();
