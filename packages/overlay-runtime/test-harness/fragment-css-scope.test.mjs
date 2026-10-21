import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import {
  collectFragmentCssNames,
  isGuardedFragmentCssName,
  scopeFragmentCss,
} from '../src/fragment-css-scope.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = (name) => readFileSync(
  join(repoRoot, 'packages/edit-lint/test/fixtures/fragment-css-collision/overlays', name),
  'utf8',
);

const a = fixture('a.html');
const b = fixture('b.html');
const plain = fixture('plain.html');

test('only the later colliding fragment is renamed; the first keeps its bytes', () => {
  const scoped = scopeFragmentCss([{ id: 'a', html: a }, { id: 'b', html: b }]);
  assert.equal(scoped[0].changed, false);
  assert.equal(scoped[0].html, a);
  assert.equal(scoped[1].changed, true);
  assert.deepEqual(scoped[1].renames.classes, { 'lbl-hashimoto': 'lbl-hashimoto__f2' });
  assert.deepEqual(scoped[1].renames.keyframes, { drift: 'drift__f2' });
  assert.match(scoped[1].html, /class="card lbl-hashimoto__f2"/u);
  assert.match(scoped[1].html, /\.lbl-hashimoto__f2 \{ left: 60%; animation: drift__f2 2s/u);
  assert.match(scoped[1].html, /@keyframes drift__f2/u);
  assert.doesNotMatch(scoped[1].html, /animation: drift 2s/u);
});

test('a fragment with no shared name is byte-identical', () => {
  const scoped = scopeFragmentCss([{ id: 'a', html: a }, { id: 'plain', html: plain }]);
  assert.equal(scoped[0].html, a);
  assert.equal(scoped[1].html, plain);
  assert.equal(scoped[1].changed, false);
});

test('animation-name, style attributes, @media and several animations follow the rename', () => {
  const first = '<div class="box alt"><style>@media (min-width: 100px){ .box{color:red} .alt{animation-name: spin} }'
    + '@keyframes spin{to{transform:rotate(1turn)}} @keyframes fade{to{opacity:0}}</style>'
    + '<span class="alt" style="animation: spin 1s, fade 2s">x</span></div>';
  const second = first.replace('>x<', '>y<');
  const scoped = scopeFragmentCss([{ id: 'one', html: first }, { id: 'two', html: second }]);
  assert.equal(scoped[0].changed, false);
  assert.deepEqual(scoped[1].renames.classes, { alt: 'alt__f2', box: 'box__f2' });
  assert.deepEqual(scoped[1].renames.keyframes, { fade: 'fade__f2', spin: 'spin__f2' });
  assert.match(scoped[1].html, /@media \(min-width: 100px\)\{ \.box__f2\{color:red\} \.alt__f2\{animation-name: spin__f2\}/u);
  assert.match(scoped[1].html, /@keyframes spin__f2/u);
  assert.match(scoped[1].html, /style="animation: spin__f2 1s, fade__f2 2s"/u);
  assert.match(scoped[1].html, /<span class="alt__f2"/u);
});

test('several colliding names are all renamed with the fragment suffix', () => {
  const version = (text) => `<div class="one two"><style>.one{a:1}.two{b:2}@keyframes k1{}@keyframes k2{}</style>`
    + `<span class="one">${text}</span></div>`;
  const scoped = scopeFragmentCss([
    { id: 'first', html: version('first') },
    { id: 'second', html: version('second') },
    { id: 'third', html: version('third') },
  ]);
  assert.equal(scoped[0].changed, false);
  assert.deepEqual(Object.keys(scoped[1].renames.classes).sort(), ['one', 'two']);
  assert.deepEqual(Object.keys(scoped[2].renames.classes).sort(), ['one', 'two']);
  assert.equal(scoped[1].renames.classes.one, 'one__f2');
  assert.equal(scoped[2].renames.classes.one, 'one__f3');
  assert.equal(scoped[1].renames.keyframes.k1, 'k1__f2');
  assert.equal(scoped[2].renames.keyframes.k1, 'k1__f3');
});

test('the runtime class namespace and host classes are never renamed', () => {
  const version = (text) => '<div class="akari-caption scene"><style>'
    + '.akari-caption__plate{opacity:1}.scene{color:red}'
    + '@keyframes akari-caption-fade{to{opacity:0}}</style>'
    + `<span class="akari-caption__plate scene">${text}</span></div>`;
  const scoped = scopeFragmentCss([
    { id: 'first', html: version('first') },
    { id: 'second', html: version('second') },
  ]);
  assert.equal(scoped[1].changed, false);
  assert.deepEqual(scoped[1].renames.classes, {});
  assert.deepEqual(scoped[1].renames.keyframes, {});
  // .akari-* と .scene はガード対象なので、この 2 断片では書き換える名前が無い。
  assert.equal(scoped[1].html, version('second'));
});

test('reusing the same fragment html is not a collision, but a third distinct fragment is', () => {
  const scoped = scopeFragmentCss([
    { id: 'a', html: a },
    { id: 'a-again', html: a },
    { id: 'c', html: b.replace('>B<', '>C<') },
  ]);
  assert.equal(scoped[0].changed, false);
  assert.equal(scoped[1].changed, false);
  assert.equal(scoped[1].html, a);
  assert.equal(scoped[2].changed, true);
  assert.equal(scoped[2].renames.classes['lbl-hashimoto'], 'lbl-hashimoto__f3');
});

function collectHtml(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectHtml(path, found);
    else if (entry.name.endsWith('.html')) found.push(path);
  }
  return found;
}

function corpus() {
  const roots = [
    'assets',
    'dev-fixtures',
    'packages/schemas/examples',
    'packages/preview-server/fixtures',
    'packages/render-cut/evidence',
    'packages/edit-lint/test/fixtures',
  ];
  return roots.flatMap((root) => {
    const directory = join(repoRoot, root);
    try {
      return statSync(directory).isDirectory() ? collectHtml(directory) : [];
    } catch {
      return [];
    }
  });
}

test('every existing fragment is byte-identical on a one-fragment page (measured count)', (t) => {
  const paths = corpus();
  assert.ok(paths.length > 0, 'no fragment html was found');
  const changed = [];
  for (const path of paths) {
    const html = readFileSync(path, 'utf8');
    const scoped = scopeFragmentCss([{ id: path, html }]);
    if (scoped[0].html !== html || scoped[0].changed) changed.push(path);
  }
  t.diagnostic(`fragments checked: ${paths.length}`);
  assert.deepEqual(changed, []);
});

test('all collision-free pairs stay byte-identical (measured count)', (t) => {
  const paths = corpus();
  const fragments = paths.map((path) => ({ path, html: readFileSync(path, 'utf8') }));
  const names = fragments.map(({ html }) => collectFragmentCssNames(html));
  const collide = (left, right) => [...left.classes].some((name) => right.classes.has(name))
    || [...left.keyframes].some((name) => right.keyframes.has(name));
  let checked = 0;
  const changed = [];
  for (let first = 0; first < fragments.length; first += 1) {
    for (let second = first + 1; second < fragments.length; second += 1) {
      if (collide(names[first], names[second])) continue;
      checked += 1;
      const scoped = scopeFragmentCss([
        { id: fragments[first].path, html: fragments[first].html },
        { id: fragments[second].path, html: fragments[second].html },
      ]);
      if (scoped[0].html !== fragments[first].html) changed.push(`${fragments[first].path} (first)`);
      if (scoped[1].html !== fragments[second].html) changed.push(`${fragments[second].path} (second)`);
    }
  }
  t.diagnostic(`collision-free pairs checked: ${checked}`);
  assert.ok(checked > 0, 'no collision-free pair was found');
  assert.deepEqual(changed, []);
});

test('the shared module is a browser-safe ES module', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const moduleBase64 = readFileSync(new URL('../src/fragment-css-scope.mjs', import.meta.url)).toString('base64');
    const observed = await page.evaluate(async ({ moduleBase64, first, second }) => {
      const module = await import('data:text/javascript;base64,' + moduleBase64);
      const scoped = module.scopeFragmentCss([{ id: 'a', html: first }, { id: 'b', html: second }]);
      return { firstChanged: scoped[0].changed, second: scoped[1].html };
    }, { moduleBase64, first: a, second: b });
    assert.equal(observed.firstChanged, false);
    assert.match(observed.second, /lbl-hashimoto__f2/u);
    assert.match(observed.second, /@keyframes drift__f2/u);
  } finally {
    await browser.close();
  }
});

test('guarded names are reported as guarded for the runtime report', () => {
  assert.equal(isGuardedFragmentCssName('class', 'akari-caption__plate'), true);
  assert.equal(isGuardedFragmentCssName('class', 'scene'), true);
  assert.equal(isGuardedFragmentCssName('class', 'lbl-hashimoto'), false);
  assert.equal(isGuardedFragmentCssName('keyframes', 'akari-caption-fade'), true);
  assert.equal(isGuardedFragmentCssName('keyframes', 'drift'), false);
});
