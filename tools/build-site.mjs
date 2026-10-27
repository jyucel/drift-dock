#!/usr/bin/env node
/**
 * Copy the static game into _site/ for GitHub Pages. There is no bundling:
 * the game runs as native ES modules with relative paths, so it works from any
 * subpath (https://<user>.github.io/<repo>/).
 */
import { cpSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../_site/', import.meta.url);
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const entry of ['index.html', 'css', 'src', 'assets']) {
  cpSync(new URL(`../${entry}`, import.meta.url), new URL(entry, out), { recursive: true });
}
writeFileSync(new URL('.nojekyll', out), '');
console.log('built _site/');
