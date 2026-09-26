import test from 'node:test';
import assert from 'node:assert/strict';
import { aiActionCatalog } from '../lib/common/ai-action-catalog.js';
import { appendAiStillPanel, imageRouteBadgeText, stillFalPrices, stillRouteGroups } from '../lib/browser/inspector/ai-still-panel.js';
import { stillMakerBadge } from '../lib/browser/inspector/maker-badge.js';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.style = {}; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
}
const walk = node => [node, ...node.children.flatMap(walk)];

test('still sections follow route declarations and keyless fal shows a settings link', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const routes = aiActionCatalog([]).find(action => action.id === 'still').routes;
    assert.deepEqual(stillRouteGroups.free.map(row => row.id), routes.filter(row => row.cost === 'free').map(row => row.id));
    assert.deepEqual(stillRouteGroups.paid.map(row => row.id), routes.filter(row => row.cost === 'paid').map(row => row.id));
    assert.equal(stillFalPrices.high, 0.0528);
    assert.equal(imageRouteBadgeText({ id: 'fal', state: 'ready', detail: 'キーを設定済み' }, false), '使える');
    const parent = new Node('root');
    let settings = 0;
    appendAiStillPanel(parent, { prompt: 'garden', aspect: '1:1', routeId: 'fal', probing: false, running: false,
      routes: [{ id: 'fal', state: 'missing', detail: 'キーを設定すると使えます' }] },
    { change() {}, probe() {}, generate() {}, cancel() {}, addReference() {}, chooseReference() {}, captureReference() {},
      openConnections() { settings++; } });
    const nodes = walk(parent);
    const fal = nodes.find(row => row.attributes.get('data-akari-inspector-ai-route') === 'fal');
    assert.equal(walk(fal).find(row => row.className === 'akari-inspector-ai-still-badge').textContent, 'キーが未設定');
    assert.deepEqual(nodes.filter(row => row.attributes.has('data-akari-inspector-ai-route-group'))
      .map(row => row.attributes.get('data-akari-inspector-ai-route-group')), ['free', 'paid']);
    const link = nodes.find(row => row.attributes.has('data-akari-inspector-ai-fal-settings'));
    assert.ok(link);
    link.listeners.get('click')({ preventDefault() {} });
    assert.equal(settings, 1);
    assert.equal(nodes.find(row => row.attributes.get('data-akari-inspector-ai-create') === 'true').disabled, true);
    assert.ok(nodes.some(row => row.textContent?.includes('見積もり $0.053 / 枚')));
    assert.ok(nodes.some(row => row.attributes.has('data-akari-inspector-ai-fal-quality')));
    assert.equal(stillMakerBadge('qwen').textContent, 'Q');
    assert.match(stillMakerBadge('fal', true).style.cssText, /margin-left:8px/);
  } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
});
