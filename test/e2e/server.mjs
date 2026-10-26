// A tiny test site for the end-to-end tests. Every hostname that resolves to
// 127.0.0.1 gets the same pages; the page loads the real Privatus Analytics
// tracker (pa.js) and points it back at this server with data-api, so every
// pageview the tracker sends lands in `events` below.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const DEFAULT_TRACKER = new URL('../../../../../analytics/web/public/js/pa.js', import.meta.url);

export function startSite({ port = 0, trackerPath = process.env.PA_TRACKER || DEFAULT_TRACKER } = {}) {
  const tracker = readFileSync(trackerPath);
  const events = [];

  function page(req, url) {
    const host = req.headers.host; // e.g. example.test:8123
    // ?api=<origin> sends hits elsewhere (custom endpoint tests).
    const api = url.searchParams.get('api') || `http://${host}`;
    const title = url.searchParams.get('title') || 'Test site';
    // ?load=defer (default) | sync | inline: how the page includes pa.js.
    const load = url.searchParams.get('load') || 'defer';
    const attrs = `data-site="pa_TESTSITE01" data-api="${api}"`;
    const tag = load === 'inline'
      ? `<script ${attrs}>${tracker.toString().replace(/<\/script/gi, '<\\/script')}</script>`
      : `<script ${load === 'sync' ? '' : 'defer '}src="/js/pa.js" ${attrs}></script>`;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
${tag}
<style>body{font:16px system-ui;margin:40px}</style>
</head><body>
<h1>${title}</h1>
<p id="where">${host}${url.pathname}</p>
<button id="spa" onclick="history.pushState({}, '', '/spa-' + Date.now()); document.getElementById('where').textContent = location.pathname">Go to another page (pushState)</button>
</body></html>`;
  }

  // A plain demo shop for the store screenshots (neutral name, no people).
  function shopDemo(req, kind) {
    const bakery = kind === 'bakery';
    const name = bakery ? 'My Bakery' : 'My Shop';
    const card = (name, price, hue) => `<div class="card"><div class="img" style="background:hsl(${hue} 60% 88%)"></div><b>${name}</b><span>${price}</span></div>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title>
<script defer src="/js/pa.js" data-site="pa_TESTSITE01" data-api="http://${req.headers.host}"></script>
<style>
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2937;background:#fafaf9}
nav{display:flex;gap:28px;align-items:center;padding:18px 48px;background:#fff;border-bottom:1px solid #e7e5e4}
nav strong{font-size:20px;margin-right:auto} nav a{color:#57534e;text-decoration:none}
.hero{padding:56px 48px 32px} .hero h1{font-size:40px;margin:0 0 8px} .hero p{color:#57534e;margin:0}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;padding:16px 48px 48px}
.card{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:4px}
.img{height:150px;border-radius:8px;margin-bottom:8px} .card span{color:#57534e}
</style></head><body>
<nav><strong>${name}</strong>${bakery ? '<a href="#">Bread</a><a href="#">Cakes</a><a href="#">Visit us</a>' : '<a href="#">New</a><a href="#">Mugs</a><a href="#">Plants</a>'}<a href="#">Cart (0)</a></nav>
${bakery
  ? `<section class="hero"><h1>Fresh every morning</h1><p>Baked by hand before the sun comes up.</p></section>
<section class="grid">${card('Sourdough loaf', '$7', 35)}${card('Butter croissant', '$3', 45)}${card('Carrot cake', '$24', 20)}${card('Seed rolls', '$5', 60)}</section>`
  : `<section class="hero"><h1>Spring collection</h1><p>Handmade things for your home.</p></section>
<section class="grid">${card('Stoneware mug', '$18', 28)}${card('Linen towel', '$12', 200)}${card('Small cactus', '$9', 120)}${card('Oak tray', '$34', 40)}</section>`}
</body></html>`;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname.endsWith('/api/event')) {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch { /* keep raw */ }
        events.push({ host: req.headers.host.split(':')[0], path: url.pathname, origin: req.headers.origin || null, body: json || body, at: Date.now() });
        res.writeHead(202, { 'Access-Control-Allow-Origin': '*' });
        res.end();
      });
      return;
    }
    if (url.pathname === '/js/pa.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' });
      return res.end(tracker);
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (url.pathname === '/shop-demo') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(shopDemo(req, url.searchParams.get('kind')));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page(req, url));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        events,
        reset() { events.length = 0; },
        close() { return new Promise((r) => server.close(r)); }
      });
    });
  });
}
