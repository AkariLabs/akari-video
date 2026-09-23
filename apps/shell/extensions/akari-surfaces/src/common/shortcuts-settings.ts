/** Settings-only grouping: command IDs mirror the owning extensions without importing them. */
export const SHORTCUT_GROUPS = [
    { id: 'editing', label: '編集・タイムライン' },
    { id: 'playback', label: '再生' },
    { id: 'preview', label: 'プレビュー' },
    { id: 'script', label: '台本・字幕' },
    { id: 'panels', label: 'パネル・画面' },
    { id: 'partner', label: 'パートナー' },
    { id: 'other', label: 'そのほか' }
] as const;
export type ShortcutGroup = typeof SHORTCUT_GROUPS[number]['id'];
export type ShortcutFilter = 'all' | 'modified' | 'unassigned' | 'conflicts';
export interface ShortcutBinding { keybinding: string; when?: string; context?: string; }
export interface ShortcutRow { id: string; label: string; group: ShortcutGroup; bindings: readonly ShortcutBinding[]; modified: boolean; conflict: boolean; }

// Mirrors the mock's KEYS order with AKARI_SHORTCUTS IDs, without importing akari-annotations.
export const AKARI_SHORTCUT_ORDER = [
    'akari.timeline.undo', 'akari.timeline.redo', 'akari.timeline.selectTool', 'akari.timeline.razorTool',
    'akari.timeline.frameTool', 'akari.timeline.toggleSnap', 'akari.caption.placeText',
    'akari.timeline.delete', 'akari.timeline.deleteKeyframe', 'akari.timeline.deleteOneSide',
    'akari.timeline.copy', 'akari.timeline.cut', 'akari.timeline.paste', 'akari.timeline.group',
    'akari.timeline.ungroup', 'akari.timeline.moveTrackUp', 'akari.timeline.moveTrackDown',
    'akari.timeline.nudgeleft', 'akari.timeline.nudgeright', 'akari.timeline.nudgeup', 'akari.timeline.nudgedown',
    'akari.timeline.nudge10left', 'akari.timeline.nudge10right', 'akari.timeline.nudge10up', 'akari.timeline.nudge10down',
    'akari.timeline.selectParent', 'akari.timeline.selectChild', 'akari.timeline.clearSelection',
    'akari.timeline.togglePlayback', 'akari.timeline.previousFrame', 'akari.timeline.nextFrame',
    'akari.timeline.previousSecond', 'akari.timeline.nextSecond',
    'akari.daihon.selectAllRows', 'akari.daihon.clearRowSelection',
    'akari.home.newWindow', 'akari.settings.open', 'akari.inspector.clearSolo',
    'akari.inspector.stepup', 'akari.inspector.stepdown', 'akari.inspector.step10up', 'akari.inspector.step10down',
    'akari.partner.send'
] as const;
const shortcutOrder = new Map<string, number>(AKARI_SHORTCUT_ORDER.map((id, index) => [id, index]));
export function compareShortcutRows(a: ShortcutRow, b: ShortcutRow): number {
    const aAkari = a.id.startsWith('akari.'); const bAkari = b.id.startsWith('akari.');
    if (aAkari !== bAkari) { return aAkari ? -1 : 1; }
    if (aAkari) {
        const aOrder = shortcutOrder.get(a.id) ?? Infinity; const bOrder = shortcutOrder.get(b.id) ?? Infinity;
        if (aOrder !== bOrder) { return aOrder - bOrder; }
    }
    return a.label.localeCompare(b.label, 'ja') || a.id.localeCompare(b.id);
}

export function shortcutGroup(id: string): ShortcutGroup {
    if (!id.startsWith('akari.')) { return 'other'; }
    if (id === 'akari.caption.placeText') { return 'editing'; }
    if (/^akari\.timeline\.(togglePlayback|previousFrame|nextFrame|previousSecond|nextSecond|play|pause|seek|step|jump|goTo)/i.test(id)) { return 'playback'; }
    if (id.startsWith('akari.timeline.')) { return 'editing'; }
    if (id.startsWith('akari.preview.')) { return 'preview'; }
    if (/^akari\.(daihon|transcript|caption|subtitle|captions)\./.test(id)) { return 'script'; }
    if (id === 'akari.home.newWindow' || /^akari\.(inspector|settings|window|panel|zoom|appearance)\./.test(id)) { return 'panels'; }
    if (/^akari\.(partner|agent)\./.test(id)) { return 'partner'; }
    return 'other';
}

const keyNames: Record<string, string> = {
    escape: 'Esc', esc: 'Esc', backspace: '⌫', delete: '⌦', enter: '↩', return: '↩',
    space: 'Space', left: '←', right: '→', up: '↑', down: '↓',
    arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓'
};
/** Collapse spelling and spacing so ⌘B, cmd+b and ctrlcmd+b match the same key. */
export function normalizeShortcutSearch(value: string): string {
    return value.toLocaleLowerCase().replace(/ctrlcmd|command|cmd|meta|⌘/g, '⌘')
        .replace(/control|ctrl|⌃/g, '⌃').replace(/option|alt|⌥/g, '⌥')
        .replace(/shift|⇧/g, '⇧').replace(/\s|\+/g, '')
        .replace(/escape|esc/g, 'esc').replace(/backspace/g, '⌫').replace(/delete/g, '⌦')
        .replace(/arrowleft|left/g, '←').replace(/arrowright|right/g, '→')
        .replace(/arrowup|up/g, '↑').replace(/arrowdown|down/g, '↓');
}
/** Each inner array is one chord; each string is one visible <kbd> box. */
export function shortcutKeyText(binding: string): string[][] {
    return binding.trim().split(/\s+/).map(chord => chord.split('+').map(token => {
        const lower = token.toLowerCase();
        return ({ ctrlcmd: '⌘', cmd: '⌘', meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' } as Record<string, string>)[lower]
            ?? keyNames[lower] ?? token.toUpperCase();
    }));
}
export function matchesShortcut(row: ShortcutRow, query: string): boolean {
    const needle = normalizeShortcutSearch(query);
    if (!needle) { return true; }
    if ([row.label, row.id, ...row.bindings.flatMap(binding => [binding.keybinding,
        shortcutKeyText(binding.keybinding).map(chord => chord.join('')).join(' ')])]
        .some(value => normalizeShortcutSearch(value).includes(needle))) { return true; }
    // The AKARI tool bindings are bare letters (B/C for the split tool). Accept a
    // modifier-prefixed query such as ⌘B as a search for that letter as well.
    const plain = needle.replace(/[⌘⌃⌥⇧]/g, '');
    return plain !== needle && plain.length === 1 && row.bindings.some(binding =>
        normalizeShortcutSearch(binding.keybinding) === plain);
}
export function filterShortcuts(rows: readonly ShortcutRow[], query: string, filter: ShortcutFilter): ShortcutRow[] {
    return rows.filter(row => matchesShortcut(row, query) && (filter === 'all' ||
        filter === 'modified' && row.modified || filter === 'unassigned' && row.bindings.length === 0 ||
        filter === 'conflicts' && row.conflict));
}
/** A conflict is exact key + exact when/context on at least two distinct commands. */
export function shortcutConflicts(rows: readonly ShortcutRow[]): Set<string> {
    const owners = new Map<string, Set<string>>();
    for (const row of rows) for (const binding of row.bindings) {
        const signature = `${normalizeShortcutSearch(binding.keybinding)}\0${binding.when?.trim() ?? ''}\0${binding.context ?? ''}`;
        if (!owners.has(signature)) { owners.set(signature, new Set()); }
        owners.get(signature)!.add(row.id);
    }
    const conflicts = new Set<string>();
    for (const ids of owners.values()) if (ids.size > 1) for (const id of ids) conflicts.add(id);
    return conflicts;
}
export interface ShortcutPhysicalCode {
    key?: { easyString: string };
    meta: boolean;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
}
/** Stringify Theia's physical KeyCode. Never use KeyboardEvent.key: Option/Shift change that glyph. */
export function keybindingFromKeyCode(code: ShortcutPhysicalCode, mac: boolean): string | undefined {
    if (!code.key) { return undefined; }
    const modifiers = [code.meta && mac ? 'ctrlcmd' : undefined, code.ctrl ? mac ? 'ctrl' : 'ctrlcmd' : undefined,
        code.shift ? 'shift' : undefined, code.alt ? 'alt' : undefined].filter((value): value is string => !!value);
    return [...modifiers, code.key.easyString].join('+');
}

export function shortcutWhen(when?: string): string {
    if (!when) { return 'いつでも'; }
    const positive = new Set([...when.matchAll(/(!?)\s*(akari[A-Za-z0-9_]+)/g)]
        .filter(match => !match[1]).map(match => match[2]));
    if (positive.has('akariKeyframeSelected')) { return 'キーフレームを選んでいるとき'; }
    if (positive.has('akariNumberFieldFocus')) { return '数値の欄'; }
    if (positive.has('akariInspectorFocus')) { return 'インスペクター'; }
    if (positive.has('akariDaihonRowsFocus')) { return '台本の一覧'; }
    if (positive.has('akariTimelineVisible')) { return 'タイムライン'; }
    return when.length > 72 ? `${when.slice(0, 69)}…` : when;
}
