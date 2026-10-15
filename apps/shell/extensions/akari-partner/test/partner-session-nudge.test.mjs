import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

globalThis.Element ??= class { constructor() { this.classList = { add() {} }; this.style = {}; }
    matches() { return false; } };
globalThis.HTMLElement ??= globalThis.Element;
globalThis.MouseEvent ??= class extends Event {};
globalThis.DragEvent ??= class extends MouseEvent {};
globalThis.document ??= { createElement: () => new Element(), documentElement: { style: {} },
    body: new Element(), queryCommandSupported: () => false };
globalThis.window ??= Object.assign(new EventTarget(), { localStorage: { getItem: () => '1' } });
globalThis.window.navigator = { maxTouchPoints: 0 };

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
require('@theia/core/lib/browser/frontend-application-config-provider').FrontendApplicationConfigProvider.set({});
const URI = require('@theia/core/lib/common/uri').default;
const { PartnerSessionService } = require('../lib/browser/partner-session-service.js');

test('readEvent skips a nudge-false annotation but queues an unmarked annotation', async () => {
    const service = new PartnerSessionService();
    const events = new Map();
    service.fileService = { read: async uri => ({ value: events.get(uri.toString()) }) };
    let scheduled = 0;
    service.scheduleFlush = () => { scheduled++; };
    const resource = new URI('file:///project/.akari/events/annotation.json');
    const base = { type: 'annotation-created', occurredAt: '2026-10-15T00:00:00.000Z', path: 'review.json' };
    events.set(resource.toString(), JSON.stringify({ ...base, nudge: false }));
    await service.readEvent(resource);
    assert.deepEqual(service.queue, []);
    assert.equal(scheduled, 0);
    events.set(resource.toString(), JSON.stringify(base));
    await service.readEvent(resource);
    assert.equal(service.queue.length, 1);
    assert.equal(scheduled, 1);
    await service.readEvent(resource);
    assert.equal(service.queue.length, 1);
});
