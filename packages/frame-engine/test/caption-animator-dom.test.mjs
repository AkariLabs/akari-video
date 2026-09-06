import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCaptionAnimatorDom } from '../dist/timeline/caption-animator-dom.js';

// Only the DOM surface used by the adapter; serialization detects stray styles.
class ElementStub {
  constructor(className = '', children = [], attributes = {}, tagName = 'span') {
    this.className = className;
    this.tagName = tagName;
    this.children = children;
    this.attributes = attributes;
    this.parentElement = null;
    this.textContent = children.length ? '' : '字幕';
    for (const child of children) child.parentElement = this;
    const values = {};
    const priorities = {};
    this.style = new Proxy(values, { get: (target, key) => {
      if (key === 'getPropertyPriority') return name => priorities[name] ?? '';
      if (key === 'setProperty') return (name, value, priority = '') => { target[name] = value; priorities[name] = priority; };
      if (key === 'removeProperty') return name => { delete target[name]; delete priorities[name]; };
      return target[key] ?? '';
    } });
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const [tag, rest] = part.trim().split(/(?=[.[])/u, 2);
      const condition = rest ?? tag;
      if (rest && tag && tag !== this.tagName) return false;
      if (condition.startsWith('.')) return this.className.split(' ').includes(condition.slice(1));
      if (condition.startsWith('[')) return Object.hasOwn(this.attributes, condition.slice(1, -1));
      return this.tagName === condition;
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  getAttribute(name) {
    if (name === 'style') return Object.keys(this.style).length ? JSON.stringify(this.style) : null;
    return this.attributes[name] ?? null;
  }
  serialize() {
    return JSON.stringify([this.className, this.attributes, this.textContent, this.getAttribute('style'), this.children.map(c => c.serialize())]);
  }
}
const char = index => new ElementStub('akari-caption__char', [], { 'data-akari-char': String(index) });
const word = children => new ElementStub('akari-caption__tok', children);
const line = children => new ElementStub('akari-caption__line', children, {}, 'p');
const rootOf = children => new ElementStub('', children, {}, 'div');
const a = (overrides = {}) => ({ id: 'a', basis: 'chars', amount: { x: 80, y: 24, opacity: -1 }, ...overrides });
const options = (animators, overrides = {}) => ({ animators, cueLocalSeconds: 0, cueDurationSec: 2, fps: 30, outputWidth: 1920, ...overrides });

test('absent and empty animators preserve DOM bytes without creating style attributes', () => {
  const chars = [char(0), char(1)];
  const root = rootOf([line([word(chars)])]);
  const before = root.serialize();
  for (const animators of [undefined, null, []]) applyCaptionAnimatorDom(root, options(animators));
  assert.equal(root.serialize(), before);
  assert.ok([root, ...root.querySelectorAll('.akari-caption__char')].every(node => node.getAttribute('style') === null));
});

test('chars get distinct transforms and opacity, retaining markup and unrelated inline styles', () => {
  const chars = [0, 1, 2, 3].map(char);
  chars[0].style.opacity = '0.8';
  chars[0].style.color = 'red';
  const root = rootOf([line([word(chars)])]);
  applyCaptionAnimatorDom(root, options([a()]));
  assert.equal(chars[0].style.transform, 'translate(10.000000px, 3.000000px) scale(1.000000) rotate(0.000000deg)');
  assert.equal(chars[3].style.transform, 'translate(70.000000px, 21.000000px) scale(1.000000) rotate(0.000000deg)');
  assert.equal(chars[0].style.opacity, '0.700000');
  assert.equal(chars[3].style.opacity, '0.125000');
  assert.equal(chars[0].style.display, 'inline-block');
  assert.equal(chars[0].style.color, 'red');
  assert.equal(root.getAttribute('style'), null);
  assert.deepEqual(root.querySelectorAll('.akari-caption__char'), chars);
  assert.ok(chars.every((node, index) => node.textContent === '字幕' && node.getAttribute('data-akari-char') === String(index)));
});

test('repeat and backward seeks are deterministic and never accumulate opacity', () => {
  const chars = [0, 1, 2, 3].map(char);
  chars[0].style.opacity = '0.6';
  const root = rootOf([word(chars)]);
  const declaration = options([a({ randomize: { seed: 1 } })], {
    keyframes: [{ t: 0, animator: { a: { offset: -0.3 } } }, { t: 15, animator: { a: { offset: 1 } } }],
    cueLocalSeconds: 0.2,
  });
  applyCaptionAnimatorDom(root, declaration);
  const first = root.serialize();
  applyCaptionAnimatorDom(root, declaration);
  assert.equal(root.serialize(), first);
  applyCaptionAnimatorDom(root, { ...declaration, cueLocalSeconds: 0.5 });
  assert.notEqual(root.serialize(), first);
  applyCaptionAnimatorDom(root, declaration);
  assert.equal(root.serialize(), first);
});

test('item clock offset does not reset keyframes when the next cue starts', () => {
  const root = rootOf([char(0)]);
  applyCaptionAnimatorDom(root, options([a()], {
    cueLocalSeconds: 0, keyframeOffsetSeconds: 0.5,
    keyframes: [{ t: 0, animator: { a: { offset: 0 } } }, { t: 15, animator: { a: { offset: 1 } } }],
  }));
  assert.equal(root.children[0].style.opacity, '1.000000');
});

test('CSS opacity is resampled after each seek before the animator overrides it', () => {
  const node = char(0);
  let cssOpacity = '0.4';
  node.ownerDocument = { defaultView: { getComputedStyle: () => {
    assert.equal(node.style.opacity, '');
    return { opacity: cssOpacity };
  } } };
  const root = rootOf([node]);
  applyCaptionAnimatorDom(root, options([a()]));
  assert.equal(node.style.opacity, '0.200000');
  assert.equal(node.style.getPropertyPriority('opacity'), 'important');
  assert.equal(node.style.getPropertyPriority('transform'), 'important');
  cssOpacity = '0.8';
  applyCaptionAnimatorDom(root, options([a()]));
  assert.equal(node.style.opacity, '0.400000');
  applyCaptionAnimatorDom(root, options([a()]));
  assert.equal(node.style.opacity, '0.400000');
});

test('mixed bases add translation rotation and opacity deltas, multiply scale only once', () => {
  const chars = [char(0), char(1)];
  const words = chars.map(node => word([node]));
  const lines = words.map(node => line([node]));
  const root = rootOf(lines);
  const animators = [a({ amount: { x: 40, scale: 1, rotate: 20, opacity: -1, letterSpacing: 4, blur: 8 } }),
    a({ id: 'word', basis: 'words', amount: { x: 40, scale: 1, rotate: 20, opacity: -1, letterSpacing: 4, blur: 8 } }),
    a({ id: 'line', basis: 'lines', amount: { y: 40, opacity: 1 } })];
  applyCaptionAnimatorDom(root, options(animators, { outputWidth: 960 }));
  assert.equal(chars[0].style.transform, 'translate(10.000000px, 5.000000px) scale(1.562500) rotate(10.000000deg)');
  assert.equal(chars[0].style.opacity, '0.750000');
  assert.equal(chars[1].style.opacity, '0.250000');
  assert.equal(chars[0].style.letterSpacing, '1.000000px');
  assert.equal(chars[0].style.filter, 'blur(2.000000px)');
  assert.ok([...words, ...lines].every(node => node.getAttribute('style') === null));
});

test('opacity clamps the sum before multiplying the base and accepts external base edits', () => {
  const node = char(0);
  node.style.opacity = '0.4';
  const root = rootOf([node]);
  applyCaptionAnimatorDom(root, options(['a', 'b', 'c'].map(id => a({ id }))));
  assert.equal(node.style.opacity, '0.000000');
  applyCaptionAnimatorDom(root, options([a({ amount: { opacity: 1 } })]));
  assert.equal(node.style.opacity, '0.400000');
  node.style.opacity = '0.8';
  applyCaptionAnimatorDom(root, options([a()]));
  assert.equal(node.style.opacity, '0.400000');
});

test('words and segments share units and warn only once per root across frames', () => {
  const words = [word([]), word([])];
  const root = rootOf(words);
  const codes = [];
  const declaration = options([a({ basis: 'words' }), a({ id: 's', basis: 'segments' })], { warn: code => codes.push(code) });
  applyCaptionAnimatorDom(root, declaration);
  applyCaptionAnimatorDom(root, declaration);
  assert.deepEqual(codes, ['animator.segments-fallback']);
  assert.equal(words[0].style.opacity, '0.500000');
  assert.equal(words[1].style.opacity, '0.000000');
});

test('word spans are a fallback only when token markers are absent', () => {
  const node = new ElementStub('akari-caption__word');
  const root = rootOf([node]);
  applyCaptionAnimatorDom(root, options([a({ basis: 'words' })]));
  assert.equal(node.style.opacity, '0.500000');
});

test('lines count across reveal groups without double counting nested lines', () => {
  const lines = [line([]), line([])];
  const group = new ElementStub('akari-caption__reveal-group', lines, {}, 'div');
  const fallback = new ElementStub('akari-caption__reveal-group', [], {}, 'div');
  applyCaptionAnimatorDom(rootOf([group, fallback]), options([a({ basis: 'lines' })]));
  assert.equal(group.getAttribute('style'), null);
  assert.deepEqual([...lines, fallback].map(node => node.style.opacity), ['0.833333', '0.500000', '0.166667']);
});

test('missing units warn and leave DOM unchanged while other bases still apply', () => {
  const node = word([]);
  const root = rootOf([node]);
  const codes = [];
  const before = root.serialize();
  applyCaptionAnimatorDom(root, options([a()], { warn: code => codes.push(code) }));
  assert.equal(root.serialize(), before);
  assert.deepEqual(codes, ['animator.missing-chars']);
  applyCaptionAnimatorDom(root, options([a(), a({ id: 'w', basis: 'words' })]));
  assert.equal(node.style.opacity, '0.500000');
});
