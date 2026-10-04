import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/interaction.js', import.meta.url), 'utf8');
const start = source.indexOf('function lineEndpointArtwork(');
const end = source.indexOf('function beginLineEndpoint(', start);
assert.ok(start >= 0 && end > start);

function element(name, attributes = {}, box = { x: 0, width: 0 }) {
  const attrs = new Map(Object.entries(attributes));
  const node = {
    tagName: name, children: [], childNodes: [], parentNode: null,
    getAttribute: key => attrs.get(key) ?? null,
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: key => attrs.delete(key),
    getBBox: () => box,
    insertBefore(child, sibling) {
      this.children.splice(this.children.indexOf(sibling), 0, child);
      child.parentNode = this;
    },
    appendChild(child) {
      if (child.parentNode) {
        child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      }
      this.children.push(child);
      this.childNodes = this.children;
      child.parentNode = this;
    },
    replaceWith(...replacements) {
      const parent = this.parentNode;
      const index = parent.children.indexOf(this);
      parent.children.splice(index, 1, ...replacements);
      for (const replacement of replacements) replacement.parentNode = parent;
    },
  };
  return node;
}

function harness(initialScaleX, capAlreadyGrouped) {
  const body = element('line', { x1: '0', x2: capAlreadyGrouped ? '196.16' : '192.32' });
  const cap = element('polygon', {}, { x: 187.2, width: 12.8 });
  const svg = element('svg', { width: '200', height: '40' });
  svg.appendChild(body);
  if (capAlreadyGrouped) {
    const group = element('g', { 'data-line-cap': 'end', transform: 'translate(200 20) scale(0.5 1)' });
    group.appendChild(cap);
    svg.appendChild(group);
  } else svg.appendChild(cap);
  const context = vm.createContext({
    document: { createElementNS: (_namespace, name) => element(name) },
  });
  vm.runInContext(source.slice(start, end), context);
  const artwork = vm.runInContext('lineEndpointArtwork', context)(
    { querySelector: () => svg }, { scaleX: initialScaleX, scaleY: 1 });
  return { context, svg, body, cap, artwork };
}

test('dragging a uniformly scaled line keeps the end cap and body inset fixed in screen pixels', () => {
  const { context, svg, body, cap, artwork } = harness(1, false);
  vm.runInContext('updateLineEndpointArtwork', context)(artwork, 2, 1);
  assert.equal(body.getAttribute('x2'), '196.16');
  assert.equal(svg.children[1].getAttribute('transform'),
    'translate(200 20) scale(0.5 1) translate(-200 -20)');
  vm.runInContext('restoreLineEndpointArtwork', context)(artwork);
  assert.equal(body.getAttribute('x2'), '192.32');
  assert.equal(svg.children[1], cap);
});

test('dragging an already stretched line updates its marked cap without changing the first line', () => {
  const { context, svg, body, artwork } = harness(2, true);
  vm.runInContext('updateLineEndpointArtwork', context)(artwork, 4, 1);
  assert.ok(Math.abs(Number(body.getAttribute('x2')) - 198.08) < 1e-8);
  assert.equal(svg.children[0], body);
  assert.equal(svg.children[1].getAttribute('transform'), 'translate(200 20) scale(0.25 1)');
  vm.runInContext('restoreLineEndpointArtwork', context)(artwork);
  assert.equal(svg.children[1].getAttribute('transform'), 'translate(200 20) scale(0.5 1)');
});
