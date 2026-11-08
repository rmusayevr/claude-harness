#!/usr/bin/env node
/**
 * Regenerate the README's static diagram from the interactive page.
 *
 *   node scripts/build-diagram.mjs          # write docs/how-it-works{,-dark}.svg
 *   node scripts/build-diagram.mjs --check  # exit 1 if they are out of date (CI)
 *
 * docs/index.html (served by GitHub Pages) is the one source. The README
 * cannot run scripts, so it shows a static copy of the same <svg> with the
 * page's colours inlined, one file per theme. Editing the page and forgetting
 * this script would leave the README showing an older harness; --check in CI
 * makes that a failed build instead of a quiet mismatch.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const html = readFileSync(path.join(DOCS, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

const svgSrc = html.slice(html.indexOf('<svg class="diagram"'), html.indexOf('</svg>') + 6);
const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
const light = css.match(/:root \{([\s\S]*?)\n\}/)[1];
const dark = css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1].replace(/color-scheme: dark;/, '');

// Node, edge, frame and marker rules only. Interaction and animation stay on the page.
const rules = css
  .split('\n')
  .filter((l) => /^\.(node|edge|frame|mk)/.test(l.trim()) && !/\.on|cursor|transition|playing/.test(l))
  .join('\n')
  .replace(/var\(--font-mono\)/g, 'ui-monospace,Consolas,monospace');

function build(tokens) {
  const bg = tokens.match(/--panel: (#[0-9a-f]+)/)[1];
  const style = `:root{${tokens}}
svg{color:var(--ink);font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
${rules}
.edge path{marker-end:url(#a)}
.node.out-run rect{stroke:var(--good)} .node.out-ask rect{stroke:var(--warn)} .node.out-block rect{stroke:var(--bad)}`;
  return (
    svgSrc
      .replace('<svg class="diagram" id="svg" viewBox="0 0 980 530"', '<svg xmlns="http://www.w3.org/2000/svg" width="980" height="530" viewBox="0 0 980 530"')
      .replace('<defs>', `<style>${style}</style>\n        <rect width="980" height="530" rx="12" fill="${bg}"/>\n        <defs>`)
      .replace(/ data-(id|frame)="[^"]*"/g, '') + '\n'
  );
}

const outputs = { 'how-it-works.svg': build(light), 'how-it-works-dark.svg': build(dark) };

if (process.argv.includes('--check')) {
  const stale = Object.entries(outputs).filter(([f, want]) => {
    const p = path.join(DOCS, f);
    return !existsSync(p) || readFileSync(p, 'utf8').replace(/\r\n/g, '\n') !== want;
  });
  if (stale.length) {
    console.error(`out of date: ${stale.map(([f]) => `docs/${f}`).join(', ')}. Run: node scripts/build-diagram.mjs`);
    process.exit(1);
  }
  console.log('diagram up to date');
} else {
  for (const [f, text] of Object.entries(outputs)) writeFileSync(path.join(DOCS, f), text);
  console.log(`wrote ${Object.keys(outputs).map((f) => `docs/${f}`).join(', ')}`);
}
