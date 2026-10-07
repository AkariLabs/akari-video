import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { launchBrowser } from './fixtures/browser.mjs';
import { resolveElementAddresses } from '../src/parts.mjs';

const canonical = readFileSync(new URL('../src/element-selection.mjs', import.meta.url), 'utf8');
const classic = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const body = source => source.slice(source.indexOf('// BEGIN element-selection'), source.indexOf('// END element-selection'));

test('classic element selection is the exact canonical body', () => {
  assert.ok(body(canonical).length > 100);
  assert.equal(body(classic), body(canonical));
});

test('DOM addresses agree with source resolver on six fragment forms', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  const fragments = [
    '<div class="chart"><div class="bar">A</div><div class="bar">B</div></div>',
    '<table class="chart"><tr><td class="cell">A</td><td class="cell">B</td></tr></table>',
    '<div class="line"><span class="point">A</span></div>',
    '<div class="bar"><div class="bar">A</div><div class="bar">B</div></div>',
    '<div class="chart"><span class="primary bar">A</span><span class="bar primary">B</span></div>',
    '<div CLASS="chart"><span CLASS="bar">A</span><span CLASS="bar">B</span></div>'
  ];
  await page.setContent('<div id="mount"></div>');
  await page.addScriptTag({ content: canonical.slice(canonical.indexOf('// BEGIN element-selection'),
    canonical.indexOf('// END element-selection')) });
  for (const html of fragments) {
    const observed = await page.evaluate(html => {
      const mount = document.getElementById('mount');
      mount.innerHTML = html;
      const root = mount.firstElementChild;
      if (html.includes('class="line"')) {
        const clone = document.createElement('span');
        clone.className = 'point'; clone.setAttribute('data-akari-hit-proxy', 'true');
        root.prepend(clone);
      }
      return [root, ...root.querySelectorAll('*')].filter(element => elementAddress(root, element))
        .map(element => ({ ref: elementAddress(root, element), tag: element.tagName.toLowerCase(),
          text: element.textContent }));
    }, html);
    for (const item of observed) {
      const span = resolveElementAddresses(html, [item.ref]).found[item.ref];
      assert.ok(span, `${item.ref} in ${html}`);
      assert.match(html.slice(span.start, span.end).toLowerCase(), new RegExp(`^<${item.tag}(?:\\s|>)`));
      const firstText = html.slice(span.end).split('<', 1)[0].trim();
      if (firstText) assert.ok(item.text.includes(firstText), `${item.ref} points at ${firstText}`);
    }
  }
});

test('runtime text split spans exist only in DOM and keep source address indices', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  const source = '<div class="chart"><span class="bar" data-akari-split="chars">AB</span><span class="bar">CD</span></div>';
  await page.setContent('<div id="mount"></div>');
  await page.addScriptTag({ content: readFileSync(new URL('../src/text-split.js', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: canonical.slice(canonical.indexOf('// BEGIN element-selection'),
    canonical.indexOf('// END element-selection')) });
  const observed = await page.evaluate(html => {
    const mount = document.getElementById('mount');
    mount.innerHTML = html;
    window.akari.textSplit.applyAll(mount);
    const root = mount.firstElementChild;
    return { unitCount: root.querySelectorAll('span.akari-u').length,
      refs: [...root.querySelectorAll('.bar')].map(element => elementAddress(root, element)),
      unitAddress: elementAddress(root, root.querySelector('.akari-u')) };
  }, source);
  assert.deepEqual(observed, { unitCount: 2, refs: ['.bar[0]', '.bar[1]'], unitAddress: null });
  for (const ref of observed.refs) assert.ok(resolveElementAddresses(source, [ref]).found[ref]);
});

test('eligible elements obey names, visibility, size, wrappers, SVG and runtime exclusions', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setViewport({ width: 300, height: 200 });
  await page.setContent(`<div id="root" style="position:relative;width:300px;height:200px">
    <div class="full" style="width:285px;height:190px"></div>
    <div class="wide" style="width:285px;height:100px"></div>
    <div class="tall" style="width:150px;height:190px"></div>
    <div class="hidden" style="display:none"><span class="inside">X</span></div>
    <div class="invisible" style="visibility:hidden"><span class="inside">X</span></div>
    <div class="zero" style="opacity:0"><span class="inside">X</span></div>
    <span class="tiny" style="display:block;width:1px;height:1px">X</span>
    <span class="above-one" style="display:block;width:1.1px;height:1.1px">X</span>
    <span class="good" style="display:block;width:20px;height:20px">X</span>
    <span style="display:block;width:20px;height:20px">No class</span>
    <span class="akari-u" style="display:block;width:20px;height:20px">Split</span>
    <span class="proxy" data-akari-hit-proxy style="display:block;width:20px;height:20px">Proxy</span>
    <img class="full-img" width="300" height="200" src="">
    <svg class="mini" width="60" height="40"><rect class="bar" width="50" height="30" fill="red"/></svg>
    <svg class="full-svg" width="300" height="200"><rect width="300" height="200" fill="red"/></svg>
  </div>`);
  await page.addScriptTag({ content: canonical.slice(canonical.indexOf('// BEGIN element-selection'),
    canonical.indexOf('// END element-selection')) });
  const observed = await page.evaluate(() => {
    const root = document.getElementById('root');
    const output = root.getBoundingClientRect();
    const eligible = selector => selectableElement(root, root.querySelector(selector), output);
    return { root: selectableElement(root, root, output), full: eligible('.full'),
      wide: eligible('.wide'), tall: eligible('.tall'),
      hidden: eligible('.hidden .inside'), invisible: eligible('.invisible .inside'),
      zero: eligible('.zero .inside'), tiny: eligible('.tiny'), aboveOne: eligible('.above-one'), good: eligible('.good'),
      unnamed: eligible('span:not([class])'), split: eligible('.akari-u'),
      proxy: eligible('.proxy'), fullImg: eligible('.full-img'), fullSvg: eligible('.full-svg'),
      svg: eligible('.mini'), svgChild: eligible('.mini rect') };
  });
  assert.deepEqual(observed, { root: false, full: false, wide: true, tall: true,
    hidden: false, invisible: false, zero: false, tiny: false, aboveOne: true,
    good: true, unnamed: false, split: false, proxy: false,
    fullImg: true, fullSvg: true, svg: true, svgChild: false });
});
