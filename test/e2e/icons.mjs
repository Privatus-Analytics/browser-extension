// Renders src/icons/icon-*.png from src/icons/icon.svg (the Privatus Analytics logo).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root } from './harness.mjs';
const svg = readFileSync(join(root, 'src', 'icons', 'icon.svg'), 'utf8');
const b = await chromium.launch();
for (const s of [16, 32, 48, 128]) {
  const p = await b.newPage({ viewport: { width: s, height: s } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await p.screenshot({ path: join(root, 'src', 'icons', `icon-${s}.png`), omitBackground: true });
  await p.close();
}
await b.close();
console.log('icons written');
