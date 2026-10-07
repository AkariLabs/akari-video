import assert from 'node:assert/strict';
import test from 'node:test';
import { applyElementOverrides, applyPartMask, expandBagOverlays, resolveElementAddresses } from '../src/parts.mjs';

const html = '<!-- <i class=bar></i> --><script>"<i class=bar>"</script><style>.x{content:"<i class=bar>"}</style>'
  + '<div id=logo class="bar other" style="height:10px"></div><div class="other bar"></div><div class=bar></div>';

test('source address resolves id, class token, occurrence and unquoted attributes', () => {
  const result = resolveElementAddresses(html, ['#logo[0]', '.bar[0]', '.bar[1]', '.bar[2]', '.bar[3]']);
  assert.deepEqual(result.missing, ['.bar[3]']);
  assert.equal(result.found['#logo[0]'].start, result.found['.bar[0]'].start);
  assert.ok(result.found['.bar[0]'].start < result.found['.bar[1]'].start);
  assert.ok(result.found['.bar[1]'].start < result.found['.bar[2]'].start);
});

test('duplicate ids, nested class order, whitespace tokens and uppercase attribute names use source openings', () => {
  const source = '<div id=a CLASS="outer\tshared"><span class="shared\nother"><i id=a CLASS=shared></i></span></div>';
  const { found, missing } = resolveElementAddresses(source,
    ['#a[0]', '#a[1]', '.shared[0]', '.shared[1]', '.shared[2]', '.other[0]', 'div', '.shared[01]']);
  assert.equal(found['#a[0]'].start, source.indexOf('<div'));
  assert.equal(found['#a[1]'].start, source.indexOf('<i'));
  assert.equal(found['.shared[0]'].start, source.indexOf('<div'));
  assert.equal(found['.shared[1]'].start, source.indexOf('<span'));
  assert.equal(found['.shared[2]'].start, source.indexOf('<i'));
  assert.equal(found['.other[0]'].start, source.indexOf('<span'));
  assert.deepEqual(missing, ['div', '.shared[01]']);
});

test('script and style opening tags are not addressable and do not consume occurrence numbers', () => {
  const source = '<style class="x">.x{}</style><script id="s" class="x"></script><div class="x"></div>';
  const { found, missing } = resolveElementAddresses(source, ['.x[0]', '.x[1]', '#s[0]']);
  assert.equal(found['.x[0]'].start, source.indexOf('<div'));
  assert.deepEqual(missing, ['.x[1]', '#s[0]']);
});

test('overrides append inline style in map key order and report missing addresses', () => {
  const [out, result] = applyElementOverrides(html, {
    '.bar[0]': { style: { height: '20px', width: '10px' } },
    '#logo[0]': { style: { height: '30px' } },
    '.bar[2]': { style: { color: 'red' } },
    '.bar[99]': { style: { height: '90px' } },
  });
  assert.deepEqual(result.missing, ['.bar[99]']);
  assert.match(out, /style="height:10px;height:20px;width:10px;height:30px"/u);
  assert.match(out, /<div class=bar style="color:red"><\/div>/u);
  assert.equal(applyElementOverrides(html, { '.bar[99]': { style: { height: '90px' } } })[0], html);
});

test('part text replacement preserves the earlier element style override', () => {
  const [overridden] = applyElementOverrides('<div data-akari-part=A class=bar style="width:10px">old</div>',
    { '.bar[0]': { style: { width: '20px' } } });
  const [masked] = applyPartMask(overridden, 'A', { text: 'new' });
  assert.match(masked, /style="width:10px;width:20px"/u);
  assert.match(masked, />new<\/div>/u);
  assert.doesNotMatch(masked, />old<\/div>/u);
});

const item = (id, source, children = []) => ({ id, at: 0, duration: 2, source, children, declaration: { id, start: 0, duration: 2 } });

test('plain, part and bag routes apply source overrides before part style and merge child property', () => {
  const fragment = '<div class="bar" data-akari-part="A" style="height:10px"></div>'
    + '<div class="bar" data-akari-part="B"></div><i class="free"></i>';
  const parent = { '.free[0]': { style: { width: '40px', color: 'blue' } } };
  const child = { '.free[0]': { style: { width: '60px' } } };
  const bag = item('bag', { kind: 'html', html: 'f.html', elements: parent, exclude: ['unused'] }, [
    item('A', { kind: 'html', html: 'f.html', part: 'A', elements: child }),
  ]);
  const records = expandBagOverlays({ tracks: [{ items: [
    item('plain', { kind: 'html', html: 'f.html', elements: { '.bar[0]': { style: { height: '30px' } } } }),
    item('part', { kind: 'html', html: 'f.html', part: 'A', style: { height: '50px' }, elements: { '.bar[0]': { style: { height: '30px' } } } }),
    bag,
  ] }] }, () => fragment);
  assert.match(records[0].html, /height:10px;height:30px/u);
  assert.match(records[1].html, /height:10px;height:30px;height:50px/u);
  assert.equal(records.filter(record => record.parentId === 'bag').length, 2);
  assert.match(records.find(record => record.id === 'A').html, /width:60px;color:blue/u);
  assert.match(records.find(record => record.id === 'bag#B').html, /width:40px;color:blue/u);
});

test('absent and empty overrides retain records byte for byte', () => {
  const plain = item('plain', { kind: 'html', html: 'f.html' });
  const old = expandBagOverlays({ tracks: [{ items: [plain] }] }, () => html);
  const empty = expandBagOverlays({ tracks: [{ items: [item('plain', { kind: 'html', html: 'f.html', elements: {} })] }] }, () => html);
  assert.deepEqual(empty, old);
  assert.equal(old[0].html, 'f.html');
});
