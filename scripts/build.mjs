#!/usr/bin/env node
// Produces store-ready builds with browser-specific manifests:
//   dist/chrome   — background.service_worker only, no gecko settings
//   dist/firefox  — background.scripts only (event page), gecko settings
// src/ itself loads unpacked in both browsers (each ignores the other's key
// with a warning), so this script is only needed for packaging.
// Usage: node scripts/build.mjs [--zip]   (zip needs the `zip` binary)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const base = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));

export function chromeManifest(m) {
  const out = structuredClone(m);
  out.background = { service_worker: m.background.service_worker };
  delete out.browser_specific_settings;
  return out;
}

export function firefoxManifest(m) {
  const out = structuredClone(m);
  out.background = { scripts: m.background.scripts };
  delete out.minimum_chrome_version;
  return out;
}

function build(name, manifest) {
  const dir = join(dist, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(src, dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (process.argv.includes('--zip')) {
    const zip = join(dist, `privatus-block-my-visits-${name}-${manifest.version}.zip`);
    rmSync(zip, { force: true });
    execFileSync('zip', ['-qr', zip, '.'], { cwd: dir });
  }
  console.log(`built ${dir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build('chrome', chromeManifest(base));
  build('firefox', firefoxManifest(base));
}
