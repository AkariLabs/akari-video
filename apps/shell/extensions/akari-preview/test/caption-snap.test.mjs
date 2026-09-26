import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const interaction = readFileSync(new URL('../../../../../packages/overlay-runtime/src/interaction.js', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = interaction.indexOf('function closestAxisSnap(');
const end = interaction.indexOf('function applyDragSnapping(', start);
assert.ok(start >= 0 && end > start);
const snapFunctions = interaction.slice(start, end);

const compute = (displayDx, prior = null) => {
    const scale = 676 / 1280;
    const centerX = 640 + displayDx / scale;
    const bounds = { left: centerX - 168, centerX, right: centerX + 168,
        top: 260, centerY: 290, bottom: 320 };
    const context = { SNAP_DISTANCE: 6, SNAP_RELEASE_DISTANCE: 6,
        outputSize: () => ({ width: 1280, height: 720 }), currentDisplayScale: () => scale };
    vm.createContext(context);
    vm.runInContext(snapFunctions, context);
    return vm.runInContext('computeSnapCorrection', context)(bounds, prior);
};

test('caption shares the six pixel overlay snap range', () => {
    const near = compute(5);
    assert.ok(near.x);
    assert.ok(Math.abs(near.x.correction * 676 / 1280 + 5) < 0.001);
    assert.equal(compute(7).x, null);
    assert.equal(compute(7, near).x, null);
});

test('caption drag bypasses snapping with the current Command modifier', () => {
    const drag = preview.slice(preview.indexOf("const onCaptionPointerDown = event =>"),
        preview.indexOf('new ResizeObserver(() => updateCaptionSelectBox())'));
    assert.match(drag, /!captionSnapEnabled \|\| moveEvent\.metaKey \|\| moveEvent\.ctrlKey[\s\S]*?\|\| !window\.akari\.interaction\?\.computeSnapCorrection/);
    assert.match(drag, /dragSnap = \{ x: null, y: null \};\s*window\.akari\.interaction\?\.hideSnapGuides/);
});

test('selection uses a single solid ink box and instant icon help', () => {
    assert.match(preview, /#caption-select-box \{[^\n]*border: 1\.5px solid var\(--akari-caption-select-color\)/);
    assert.match(preview, /\.caption-row-plate\[data-selected\][^\n]*\{ outline: none;/);
    assert.doesNotMatch(preview, /\.akari-caption__plate \{ outline: 1\.5px solid #f5c451/);
    assert.match(preview, /\[data-caption-tool\]:hover \.akari-caption-tool-tip[^\n]*display: block/);
    assert.match(preview, /id="caption-row-box-toggle"[^\n]*aria-pressed="false"/);
    for (const tab of ['text', 'stroke', 'background']) {
        assert.match(preview, new RegExp('data-palette-tab="' + tab + '"'));
    }
    assert.match(preview, /getCommand\('akari\.inspector\.revealField'\)/);
    assert.match(preview, /command \? 'akari\.inspector\.revealField' : 'akari\.inspector\.open'/);
    assert.match(preview, /toolStyle: \{ captionIds: ids, change \}/);
    const tools = preview.slice(preview.indexOf('<div id="caption-select-box">'), preview.indexOf('<canvas id="pen-layer"'));
    assert.doesNotMatch(tools, /[\p{Extended_Pictographic}↺✓🧲]/u);
});

test('group toggle and Alt drag keep the box dashed and tooltips follow state', () => {
    const tools = new Map();
    const tooltips = new Map();
    const attributes = new Set();
    const button = name => {
        if (!tools.has(name)) {
            const classes = new Set();
            tools.set(name, {
                classList: { toggle: (key, on) => on ? classes.add(key) : classes.delete(key),
                    contains: key => classes.has(key) },
                style: { setProperty() {} }
            });
        }
        return tools.get(name);
    };
    const state = { caption: { textStyle: { background: { opacity: 0 } } }, clampOn: false };
    const context = vm.createContext({
        selectedCaptionId: 'c1',
        captionSnapEnabled: true, captionGroupToolEnabled: false, captionDragGroupActive: false,
        captionPositionReset: {}, captionClampChip: button('clamp'), captionTool: button,
        selectedCaption: () => state.caption,
        captionClampEnabled: () => state.clampOn, captionHasCuePosition: () => false,
        setCaptionToolTip: (name, message) => tooltips.set(name, message),
        captionSelectBox: { toggleAttribute: (key, on) => on ? attributes.add(key) : attributes.delete(key) }
    });
    const from = preview.indexOf('const updateCaptionSelectTools =');
    const to = preview.indexOf('const updateCaptionSelectBoxForRect =', from);
    assert.ok(from >= 0 && to > from);
    vm.runInContext(preview.slice(from, to), context);
    vm.runInContext('updateCaptionSelectTools()', context);
    assert.match(tooltips.get('group'), /^この字幕だけ動く/);
    assert.match(tooltips.get('snap'), /^吸着 ON/);
    assert.match(tooltips.get('clamp'), /^はみ出し防止 OFF/);
    assert.match(tooltips.get('cushion'), /^座布団 OFF/);

    vm.runInContext('captionGroupToolEnabled = true; setCaptionGroupMode(false)', context);
    assert.ok(attributes.has('data-alt-all'));
    assert.ok(button('group').classList.contains('on'));
    assert.match(tooltips.get('group'), /^全字幕が動く/);
    vm.runInContext('captionGroupToolEnabled = false; setCaptionGroupMode(true)', context);
    assert.ok(attributes.has('data-alt-all'), 'Alt drag also uses a dashed box');
    vm.runInContext('setCaptionGroupMode(false)', context);
    assert.ok(!attributes.has('data-alt-all'));

    state.clampOn = true;
    state.caption.textStyle.background.opacity = 0.75;
    vm.runInContext('captionSnapEnabled = false; updateCaptionSelectTools()', context);
    assert.match(tooltips.get('snap'), /^吸着 OFF/);
    assert.match(tooltips.get('clamp'), /^はみ出し防止 ON/);
    assert.match(tooltips.get('cushion'), /^座布団 ON/);
    assert.match(preview, /captionTool\('group'\)\.addEventListener\('click',[\s\S]*?captionGroupToolEnabled = !captionGroupToolEnabled;\s*setCaptionGroupMode\(false\)/);
});
