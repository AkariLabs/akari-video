import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const browser = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const section = (start, end) => {
    const from = browser.indexOf(start);
    const to = browser.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, start);
    return browser.slice(from, to);
};

function captionHarness() {
    const listeners = new Map();
    const writes = [];
    const events = [];
    const resolveWrites = [];
    const posted = [];
    const saved = new Map();
    let renders = 0;
    const captions = ['A', 'B'].map(id => ({ id, textStyle: {
        text_anchor: 'bc', position: { x: 0, y: 0 }
    } }));
    const plates = new Map(captions.map((cue, index) => [cue.id, {
        style: { translate: '', removeProperty() {} },
        baseX: index * 400,
        setPointerCapture() {}, hasPointerCapture: () => false
    }]));
    const moveOf = plate => {
        const [x = '0', y = '0'] = plate.style.translate.split(' ');
        return { x: Number.parseFloat(x) || 0, y: Number.parseFloat(y) || 0 };
    };
    const rectOf = plate => {
        const move = moveOf(plate);
        return { left: plate.baseX + move.x, right: plate.baseX + move.x + 100,
            top: move.y, bottom: move.y + 40 };
    };
    let selected = 'A';
    const context = vm.createContext({
        window: {
            AkariEditKernel: { resolveCaptionLineStyleVars: style => ({
                '--caption-left': `${style.position.x * 100}%`,
                '--caption-top': `${style.position.y * 100}%`
            }) },
            akari: {
                reportGesture: phase => events.push(phase),
                interaction: { hideSnapGuides() {} },
                engine: { captionWrite: (id, patch) => {
                    writes.push({ id, patch });
                    return new Promise(resolve => resolveWrites.push(() => {
                        if (patch.cuePosition) saved.set(id, patch.cuePosition.position);
                        resolve();
                    }));
                } },
                showWriteError(error) { throw error; }
            },
            addEventListener: (name, listener) => listeners.set(name, listener),
            postMessage: message => posted.push(message),
            removeEventListener: (name, listener) => {
                if (listeners.get(name) === listener) listeners.delete(name);
            }
        },
        document: { body: { classList: { add() {}, remove() {} } } },
        console,
        captions,
        captionRows: new Map(captions.map(cue => [cue.id, { caption: cue, plate: plates.get(cue.id) }])),
        captionSelectBox: { contains: () => false },
        captionForEvent: event => captions.find(cue => cue.id === event.target.id),
        selectedCaptionPlate: () => plates.get(selected),
        beginCaptionHandleDrag: () => false,
        captionClampEnabled: () => false,
        selectCaption: id => { selected = id; },
        setCaptionGroupMode() {},
        captionVisualRect: plate => rectOf(plate ?? plates.get(selected)),
        captionLayoutRect: plate => rectOf(plate ?? plates.get(selected)),
        captionTransformValues: () => ({}),
        captionOutputPoint: (x, y) => ({ x, y }),
        captionOutputFrame: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
        captionPositionFromVisualRect: rect => ({ anchor: 'bc', position: { x: rect.left, y: rect.top } }),
        updateCaptionSelectBox() {}, updateCaptionSelectBoxForRect() {},
        clearLiveOverride() {}, captionStylePreview: { captionsUpdated() {} },
        rebuildSegments() {}, renderCaption() { renders += 1; },
        resumeCaptionMotionAfterRender() {},
        selectedCaptionIds: new Set(),
        captionGroupToolEnabled: false, captionSnapEnabled: false,
        activeCaptionEdit: null, CLICK_THRESHOLD_PX: 3,
        summary: { output: { width: 1280, height: 720 } }
    });
    const flags = section('            let selectionDragActive =', '            let suppressClick =');
    const drag = section('            const onCaptionPointerDown =',
        "            captionLayer.addEventListener('pointerdown', onCaptionPointerDown);");
    const receive = section("                if (message && message.type === 'akari-preview-captions-update') {",
        "                if (message && message.type === 'akari-preview-audio-update') {");
    vm.runInContext(`${flags}\nlet pendingCaptionDragReload = false;
        const captionCuePositionKnown = new Map();
        ${drag}\nglobalThis.down = onCaptionPointerDown;
        globalThis.overrides = captionPositionOverrides;
        globalThis.receive = message => { ${receive} };
        globalThis.currentCaptions = () => captions;
        globalThis.protect = protectCaptionUpdate;`, context);
    const event = (id, x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y,
        target: { id, closest: selector => selector === '.caption-row-plate' ? plates.get(id) : null },
        preventDefault() {}, stopPropagation() {} });
    const grab = (id, dx, dy) => {
        const start = event(id, 0, 0);
        context.down(start);
        listeners.get('pointermove')(event(id, dx, dy));
        listeners.get('pointerup')(event(id, dx, dy));
    };
    const tap = id => {
        context.down(event(id, 0, 0));
        listeners.get('pointerup')(event(id, 0, 0));
    };
    const settle = async index => {
        resolveWrites[index]();
        await new Promise(resolve => setImmediate(resolve));
    };
    return { context, plates, writes, events, saved, grab, tap, settle,
        receive: captions => context.receive({ type: 'akari-preview-captions-update', captions }),
        posted,
        deliverPosted: () => { for (const message of posted.splice(0)) context.receive(message); },
        renders: () => renders };
}

test('(a) A を 3 連続で掴み直し、保存前の画面位置を出発点にする', async () => {
    const h = captionHarness();
    h.grab('A', 160, 0);
    assert.equal(h.writes[0].patch.cuePosition.position.x, 160);
    h.grab('A', 0, 120);
    assert.equal(h.writes[1].patch.cuePosition.position.x, 160,
        '2 回目の pointermove は前回の 160px を消さない');
    h.grab('A', -160, 0);
    assert.equal(h.writes[2].patch.cuePosition.position.x, 0);
    assert.equal(h.writes[2].patch.cuePosition.position.y, 120);
    const stale = [{ id: 'A', textStyle: { position: { x: 160, y: 0 } } }];
    h.receive(stale);
    assert.equal(h.renders(), 0, '保存待ち中の字幕通知は保留する');
    await h.settle(0);
    await h.settle(1);
    await h.settle(2);
    assert.equal(h.saved.get('A').x, 0);
    assert.equal(h.saved.get('A').y, 120);
    assert.equal(h.posted.length, 1, '最後の保存完了後に保留通知を再配送する');
    h.deliverPosted();
    h.receive(stale);
    assert.equal(h.renders(), 2);
    assert.equal(h.context.currentCaptions()[0].textStyle.position.y, 120);
    assert.equal(h.context.currentCaptions()[0].textStyleVars['--caption-top'], '12000%');
    h.receive([{ id: 'A', textStyle: { position: { x: 0, y: 120 } },
        textStyleVars: { '--caption-left': '0px', '--caption-top': '120px' } }]);
    assert.equal(h.renders(), 3);
    assert.equal(h.plates.get('A').style.translate, '');
    assert.deepEqual(h.events, ['begin', 'begin', 'begin', 'saved', 'end', 'saved', 'end', 'saved', 'end']);
});

test('(b) A → B → A でも A の保存前位置を保持する', async () => {
    const h = captionHarness();
    h.grab('A', 160, 0);
    h.grab('B', 0, 80);
    h.grab('A', 0, 120);
    assert.equal(h.writes[2].patch.cuePosition.position.x, 160);
    assert.equal(h.writes[2].patch.cuePosition.position.y, 120);
    h.receive([{ id: 'A', textStyle: { position: { x: 160, y: 0 } } },
        { id: 'B', textStyle: { position: { x: 400, y: 80 } } }]);
    await h.settle(0);
    await h.settle(1);
    await h.settle(2);
    assert.equal(h.saved.get('A').x, 160);
    assert.equal(h.saved.get('A').y, 120);
    h.deliverPosted();
    h.receive([{ id: 'A', textStyle: { position: { x: 160, y: 0 } } },
        { id: 'B', textStyle: { position: { x: 400, y: 80 } } }]);
    assert.equal(h.renders(), 2);
    assert.equal(h.context.currentCaptions()[0].textStyle.position.y, 120);
    h.receive([{ id: 'A', textStyle: { position: { x: 160, y: 120 } } },
        { id: 'B', textStyle: { position: { x: 400, y: 80 } } }]);
    assert.equal(h.renders(), 3);
});

test('(b) A の保存待ち中に動かさず掴み直しても画面位置を保つ', async () => {
    const h = captionHarness();
    h.grab('A', 160, 0);
    h.tap('A');
    assert.equal(h.plates.get('A').style.translate, '160px 0px');
    assert.equal(h.writes.length, 1);
    await h.settle(0);
});

test('保存待ち位置を保ちながら別の行の文字を受け取り、削除後は保護を解除する', async () => {
    const h = captionHarness();
    h.grab('A', 160, 0);
    await h.settle(0);
    h.deliverPosted();
    h.receive([
        { id: 'A', text: 'A', textStyle: { position: { x: 0, y: 0 } } },
        { id: 'B', text: 'updated', textStyle: { position: { x: 0, y: 0 } } }
    ]);
    assert.equal(h.context.currentCaptions()[1].text, 'updated');
    assert.equal(h.context.currentCaptions()[0].textStyle.position.x, 160);
    h.receive([{ id: 'B', text: 'still updated' }]);
    assert.equal(h.context.overrides.has('A'), false);
    h.receive([{ id: 'A', textStyle: { position: { x: 25, y: 0 } } }]);
    assert.equal(h.context.currentCaptions()[0].textStyle.position.x, 25);
});
