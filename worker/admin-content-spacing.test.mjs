import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync('src/styles/admin-content-spacing.css', 'utf8');
const globalCss = readFileSync('src/styles/global.css', 'utf8');
const adminDir = 'src/pages/admin';
const pages = readdirSync(adminDir).filter(name => name.endsWith('.astro'));

assert.match(css, /\.metric\s*>\s*span[\s\S]*display:\s*block\s*!important/i, 'Metric labels must be block-level.');
assert.match(css, /\.metric\s*>\s*small[\s\S]*display:\s*block\s*!important/i, 'Metric helper text must be block-level.');
assert.match(css, /\.metric\s*>\s*small[\s\S]*margin-top:\s*5px\s*!important/i, 'Metric helper text needs explicit separation.');
assert.ok(globalCss.trim().endsWith("@import './admin-content-spacing.css';"), 'Content spacing must load last so page-local CSS cannot collapse labels/helper text.');

let metricPages = 0;
for (const page of pages) {
  const source = readFileSync(join(adminDir, page), 'utf8');
  if (/class=["'][^"']*metric\b/.test(source)) metricPages += 1;
}
assert.ok(metricPages >= 2, 'Expected shared metric patterns to remain covered across multiple admin pages.');

console.log(`Admin content spacing invariants passed across ${pages.length} admin pages (${metricPages} metric pages).`);
