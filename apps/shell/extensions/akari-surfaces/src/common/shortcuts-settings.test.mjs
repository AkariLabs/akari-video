import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUT_GROUPS, AKARI_SHORTCUT_ORDER, compareShortcutRows, shortcutGroup, normalizeShortcutSearch, shortcutKeyText, matchesShortcut,
    filterShortcuts, shortcutConflicts, keybindingFromKeyCode, shortcutWhen } from '../../lib/common/shortcuts-settings.js';

test('registered AKARI command IDs map to the seven navigation groups', () => {
    assert.deepEqual(SHORTCUT_GROUPS.map(group => group.id), ['editing', 'playback', 'preview', 'script', 'panels', 'partner', 'other']);
    const examples = {
        'akari.timeline.undo': 'editing', 'akari.timeline.razorTool': 'editing', 'akari.caption.placeText': 'editing',
        'akari.timeline.togglePlayback': 'playback', 'akari.timeline.previousFrame': 'playback',
        'akari.preview.ensureVisible': 'preview', 'akari.daihon.selectAllRows': 'script',
        'akari.transcript.open': 'script', 'akari.inspector.stepup': 'panels',
        'akari.home.newWindow': 'panels', 'akari.settings.open': 'panels',
        'akari.partner.send': 'partner', 'akari.home.newProject': 'other', 'workbench.action.files.open': 'other'
    };
    for (const [id, expected] of Object.entries(examples)) { assert.equal(shortcutGroup(id), expected, id); }
});

test('search accepts symbol and word spellings, case and whitespace', () => {
    const split = { id: 'akari.timeline.razorTool', label: '分割ツール', group: 'editing',
        bindings: [{ keybinding: 'ctrlcmd+b', when: 'akariTimelineVisible' }], modified: false, conflict: false };
    assert.deepEqual(shortcutKeyText('ctrlcmd+shift+b'), [['⌘', '⇧', 'B']]);
    for (const query of ['⌘B', '⌘ B', 'cmd+b', 'CTRLCMD + B', '分割', 'razorTool']) {
        assert.equal(matchesShortcut(split, query), true, query);
    }
    assert.equal(matchesShortcut({ ...split, bindings: [{ keybinding: 'b' }, { keybinding: 'c' }] }, '⌘B'), true);
    assert.equal(matchesShortcut(split, '文字'), false);
    const text = { ...split, id: 'akari.caption.placeText', label: '文字を置く', bindings: [{ keybinding: 't' }] };
    assert.equal(matchesShortcut(text, '文字'), true);
    assert.equal(normalizeShortcutSearch(' CtrlCmd + B '), normalizeShortcutSearch('⌘B'));
});

test('key boxes use the registered spelling, not the local keyboard layout', () => {
    const cases = {
        'ctrlcmd+shift+g': [['⌘', '⇧', 'G']], 'alt+backspace': [['⌥', '⌫']],
        '[': [['[']], ']': [[']']], '\\': [['\\']], escape: [['Esc']], enter: [['↩']],
        space: [['Space']], 'shift+alt+left': [['⇧', '⌥', '←']], delete: [['⌦']],
        'ctrl+right': [['⌃', '→']]
    };
    for (const [binding, boxes] of Object.entries(cases)) { assert.deepEqual(shortcutKeyText(binding), boxes, binding); }
});

test('AKARI registration order wins over label order, then other AKARI and Theia labels follow', () => {
    const row = (id, label) => ({ id, label, group: 'other', bindings: [], modified: false, conflict: false });
    assert.equal(AKARI_SHORTCUT_ORDER[0], 'akari.timeline.undo');
    assert.deepEqual([
        row('workbench.a', 'A'), row('akari.home.newProject', 'あ'), row('akari.timeline.moveTrackDown', '1 つ下のトラックへ'),
        row('akari.timeline.razorTool', '分割ツール'), row('akari.timeline.undo', '元に戻す'), row('workbench.z', 'Z'),
        row('akari.inspector.clearSolo', 'インスペクターのソロを外す'), row('akari.home.newWindow', '新しいウィンドウ')
    ].sort(compareShortcutRows).map(item => item.id), [
        'akari.timeline.undo', 'akari.timeline.razorTool', 'akari.timeline.moveTrackDown',
        'akari.home.newWindow', 'akari.inspector.clearSolo', 'akari.home.newProject', 'workbench.a', 'workbench.z'
    ]);
});

test('filters include user disable lines, active unassigned and exact conflicts', () => {
    const rows = [
        { id: 'a', label: 'A', group: 'other', bindings: [{ keybinding: 'b', when: 'timeline' }], modified: false, conflict: false },
        { id: 'b', label: 'B', group: 'other', bindings: [{ keybinding: 'B', when: 'timeline' }], modified: true, conflict: false },
        { id: 'c', label: 'C', group: 'other', bindings: [{ keybinding: 'b', when: 'preview' }], modified: false, conflict: false },
        { id: 'd', label: 'D', group: 'other', bindings: [], modified: true, conflict: false }
    ];
    const conflicts = shortcutConflicts(rows);
    assert.deepEqual([...conflicts].sort(), ['a', 'b']);
    for (const row of rows) { row.conflict = conflicts.has(row.id); }
    assert.deepEqual(filterShortcuts(rows, '', 'modified').map(row => row.id), ['b', 'd']);
    assert.deepEqual(filterShortcuts(rows, '', 'unassigned').map(row => row.id), ['d']);
    assert.deepEqual(filterShortcuts(rows, '', 'conflicts').map(row => row.id), ['a', 'b']);
    assert.deepEqual(filterShortcuts(rows, 'D', 'all').map(row => row.id), ['d']);
});

test('physical KeyCode stringification keeps Theia modifier order and ignores produced glyphs', () => {
    const code = (key, flags = {}) => ({ key: key && { easyString: key }, meta: false, ctrl: false, shift: false, alt: false, ...flags });
    assert.equal(keybindingFromKeyCode(code('b', { alt: true }), true), 'alt+b'); // ⌥B produces ∫ on macOS.
    assert.equal(keybindingFromKeyCode(code('1', { shift: true }), true), 'shift+1'); // ⇧1 produces !.
    assert.equal(keybindingFromKeyCode(code('g', { meta: true, shift: true }), true), 'ctrlcmd+shift+g');
    assert.equal(keybindingFromKeyCode(code('f5'), true), 'f5');
    assert.equal(keybindingFromKeyCode(code('up'), true), 'up');
    assert.equal(keybindingFromKeyCode(code('b', { ctrl: true }), false), 'ctrlcmd+b');
    assert.equal(keybindingFromKeyCode(code(undefined, { shift: true }), true), undefined);
    assert.equal(shortcutWhen('akariTimelineVisible && akariKeyframeSelected'), 'キーフレームを選んでいるとき');
    assert.equal(shortcutWhen('akariTimelineVisible && !akariModalOpen && !akariFocusOutsideTimeline && !akariInspectorFocus'), 'タイムライン');
    assert.equal(shortcutWhen('akariInspectorFocus && akariInspectorSolo && !akariEditableFocus && !akariImeComposing'), 'インスペクター');
});
