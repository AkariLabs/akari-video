import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { KeySequence } = require('@theia/core/lib/common/keys');
const source = readFileSync(new URL('../src/browser/akari-shortcuts.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', compiled)(exports);
const shortcuts = exports.AKARI_SHORTCUTS;

test('全ショートカットは日本語ラベル・分類・有効な Theia キー・when を持つ', () => {
    assert.ok(shortcuts.length >= 35);
    for (const shortcut of shortcuts) {
        assert.match(shortcut.command.id, /^akari\./);
        assert.match(shortcut.command.label, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
        assert.ok(['編集', 'タイムライン', '再生', '台本', 'インスペクター'].includes(shortcut.command.category));
        assert.ok(shortcut.when);
        for (const key of shortcut.keys) assert.equal(KeySequence.parse(key).length, 1, key);
    }
    assert.equal(new Set(shortcuts.map(shortcut => shortcut.command.id)).size, shortcuts.length);
});

test('別名キーと衝突する操作に固有の when が登録される', () => {
    const get = id => shortcuts.find(shortcut => shortcut.command.id === id);
    assert.deepEqual(get('akari.timeline.selectTool').keys, ['v', 'a']);
    assert.deepEqual(get('akari.timeline.razorTool').keys, ['b', 'c']);
    assert.deepEqual(get('akari.timeline.toggleSnap').keys, ['n', 'm']);
    for (const id of ['selectTool', 'razorTool', 'frameTool', 'toggleSnap', 'moveTrackUp', 'moveTrackDown']) {
        assert.equal(get(`akari.timeline.${id}`).when,
            'akariTimelineVisible && !akariModalOpen && !akariEditableFocus && !akariImeComposing', id);
    }
    assert.equal(get('akari.caption.placeText').when,
        'akariTimelineVisible && !akariModalOpen && !akariEditableFocus && !akariImeComposing');
    assert.match(get('akari.timeline.copy').when, /akariTextSelection/);
    assert.match(get('akari.timeline.togglePlayback').when, /akariFocusOnControl/);
    assert.match(get('akari.timeline.clearSelection').when, /akariFocusOutsideTimeline/);
    assert.match(get('akari.daihon.selectAllRows').when, /akariDaihonRowsFocus/);
    assert.match(get('akari.inspector.clearSolo').when, /akariInspectorSolo/);
    assert.match(get('akari.timeline.undo').when, /akariHistoryEditableFocus/);
});

test('ショートカットは保持中の参照が外れても attached なタイムラインへ届く', () => {
    const text = readFileSync(new URL('../src/browser/akari-shortcut-keybindings.ts', import.meta.url), 'utf8');
    const file = ts.createSourceFile('keybindings.ts', text, ts.ScriptTarget.Latest, true);
    const declaration = file.statements.find(node => ts.isClassDeclaration(node)
        && node.name?.text === 'AkariShortcutKeybindings');
    const method = declaration.members.find(node => ts.isMethodDeclaration(node)
        && node.name.getText(file) === 'shortcutTimelineWidget');
    const js = ts.transpileModule(`class Harness { ${method.getText(file)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    class Widget { constructor(attached, disposed = false) { this.isAttached = attached; this.isDisposed = disposed; } }
    const Harness = new Function('AkariAnnotationsWidget', `${js}; return Harness`)(Widget);
    const owner = new Harness();
    const detached = new Widget(false);
    const attached = new Widget(true);
    const disposed = new Widget(true, true);
    let current = detached;
    let tracked = new Set([detached, disposed, attached]);
    let candidates = [];
    owner.deps = {
        currentTimeline: () => current,
        activeWidget: () => detached,
        trackedTimelines: () => tracked,
        widgetManager: { getWidgets: () => candidates }
    };
    assert.equal(owner.shortcutTimelineWidget(), attached);
    current = attached;
    assert.equal(owner.shortcutTimelineWidget(), attached);
    current = undefined;
    tracked = new Set();
    candidates = [detached, disposed, attached];
    assert.equal(owner.shortcutTimelineWidget(), attached);
    assert.match(text, /const widget = this\.shortcutTimelineWidget\(\);[\s\S]*?akariTimelineVisible/);
    assert.match(text, /widget\?\.runRegisteredShortcut\(event\)/);
    assert.match(text, /widget\.setTimelineSnapEnabled\(!widget\.getTimelineSnapEnabled\(\)\)/);
});

test('contribution は新規のキー割り当て実装を配線するだけ', () => {
    const text = readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
    assert.match(text, /this\.getShortcutKeybindings\(\)\.registerCommands\(commands\)/);
    assert.match(text, /this\.getShortcutKeybindings\(\)\.registerKeybindings\(keybindings\)/);
    assert.match(text, /this\.toDispose\.push\(this\.getShortcutKeybindings\(\)\.start\(\)\)/);
    assert.doesNotMatch(text, /const refreshContext|AKARI_SHORTCUTS|latestKeydown|history\.handleKeydown/);
});
