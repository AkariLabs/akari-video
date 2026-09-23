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
export interface ShortcutBinding { keybinding: string; when?: string; context?: string; command?: string; }
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
type WhenNode = { op: 'atom'; value: string } | { op: 'not'; child: WhenNode } |
    { op: 'and' | 'or'; left: WhenNode; right: WhenNode };
const WHEN_TERM_LIMIT = 64;
/** Monaco's text input is a textarea. akari-shortcut-keybindings.ts sets both AKARI edit contexts
 * via isEditableEventTarget, so these Theia contexts imply them. Other contexts stay independent. */
const WHEN_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = {
    textInputFocus: ['akariEditableFocus', 'akariHistoryEditableFocus'],
    editorTextFocus: ['akariEditableFocus', 'akariHistoryEditableFocus']
};

/** Unknown operators stay opaque: they never prove that two bindings are exclusive. */
function parseWhen(input: string): WhenNode | undefined {
    const tokens = input.match(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|&&|\|\||==|!=|>=|<=|=~|[()!<>]|[^\s()!<>=&|]+|\S/g) ?? [];
    let at = 0;
    const atom = (): WhenNode | undefined => {
        if (tokens[at] === '(') {
            at++;
            const inner = disjunction();
            if (tokens[at++] !== ')') { return undefined; }
            return inner;
        }
        const start = at;
        while (at < tokens.length && !['&&', '||', ')'].includes(tokens[at])) { at++; }
        if (at === start) { return undefined; }
        return { op: 'atom', value: tokens.slice(start, at).join(' ').trim() };
    };
    const unary = (): WhenNode | undefined => {
        if (tokens[at] === '!') {
            at++;
            const child = unary();
            return child && { op: 'not', child };
        }
        return atom();
    };
    const conjunction = (): WhenNode | undefined => {
        let left = unary();
        while (left && tokens[at] === '&&') {
            at++;
            const right = unary();
            if (!right) { return undefined; }
            left = { op: 'and', left, right };
        }
        return left;
    };
    const disjunction = (): WhenNode | undefined => {
        let left = conjunction();
        while (left && tokens[at] === '||') {
            at++;
            const right = conjunction();
            if (!right) { return undefined; }
            left = { op: 'or', left, right };
        }
        return left;
    };
    const result = disjunction();
    return at === tokens.length ? result : undefined;
}

function hasPositiveWhenIdentifier(node: WhenNode, negated = false): boolean {
    if (node.op === 'not') { return hasPositiveWhenIdentifier(node.child, !negated); }
    if (node.op === 'atom') { return !negated && /^[A-Za-z_][\w.]*/.test(node.value); }
    return hasPositiveWhenIdentifier(node.left, negated) || hasPositiveWhenIdentifier(node.right, negated);
}

type Literal = { value: string; negated: boolean };
function whenTerms(node: WhenNode, negated = false): Literal[][] | undefined {
    if (node.op === 'not') { return whenTerms(node.child, !negated); }
    if (node.op === 'atom') { return [[{ value: node.value, negated }]]; }
    const left = whenTerms(node.left, negated);
    const right = whenTerms(node.right, negated);
    if (!left || !right) { return undefined; }
    const join = (node.op === 'and') !== negated;
    if (!join) { return left.length + right.length > WHEN_TERM_LIMIT ? undefined : [...left, ...right]; }
    if (left.length * right.length > WHEN_TERM_LIMIT) { return undefined; }
    return left.flatMap(a => right.map(b => [...a, ...b]));
}

function comparableAtom(value: string): { key: string; relation: 'bool' | 'eq' | 'ne'; value: string } {
    const match = /^([\w.:-]+)\s*(==|!=)\s*(?:'((?:\\.|[^'])*)'|"((?:\\.|[^"])*)"|([^\s]+))$/.exec(value);
    if (match) { return { key: match[1], relation: match[2] === '==' ? 'eq' : 'ne', value: match[3] ?? match[4] ?? match[5] }; }
    if (/^[\w.:-]+$/.test(value)) { return { key: value, relation: 'bool', value: '' }; }
    return { key: `opaque:${value}`, relation: 'bool', value: '' };
}

function possibleTerm(term: readonly Literal[]): boolean {
    const yes = new Set<string>(); const no = new Set<string>();
    const equals = new Map<string, string>(); const differs = new Map<string, Set<string>>();
    const expanded = term.flatMap(literal => !literal.negated && WHEN_IMPLICATIONS[literal.value]
        ? [literal, ...WHEN_IMPLICATIONS[literal.value].map(value => ({ value, negated: false }))] : [literal]);
    for (const literal of expanded) {
        const atom = comparableAtom(literal.value);
        if (atom.key === 'true' || atom.key === 'false') {
            if ((atom.key === 'true') === literal.negated) { return false; }
            continue;
        }
        const relation = literal.negated ? atom.relation === 'eq' ? 'ne' : atom.relation === 'ne' ? 'eq' : 'notBool' : atom.relation;
        if (relation === 'bool') { if (no.has(atom.key)) { return false; } yes.add(atom.key); }
        else if (relation === 'notBool') { if (yes.has(atom.key) || equals.get(atom.key)) { return false; } no.add(atom.key); }
        else if (relation === 'eq') {
            if (equals.has(atom.key) && equals.get(atom.key) !== atom.value || differs.get(atom.key)?.has(atom.value) || atom.value !== '' && no.has(atom.key)) { return false; }
            equals.set(atom.key, atom.value);
        } else {
            if (equals.get(atom.key) === atom.value) { return false; }
            if (!differs.has(atom.key)) { differs.set(atom.key, new Set()); }
            differs.get(atom.key)!.add(atom.value);
        }
    }
    return true;
}

export function shortcutWhensOverlap(a?: string, b?: string, aContext?: string, bContext?: string): boolean {
    const expressions = [a, b].filter((item): item is string => !!item?.trim());
    const contexts = [aContext, bContext].filter((item): item is string => !!item);
    const parsed = [...expressions.map(parseWhen), ...contexts.map(value => ({ op: 'atom', value: `context:${value}` } as WhenNode))];
    if (parsed.some(node => !node)) { return true; }
    let terms: Literal[][] = [[]];
    for (const node of parsed) {
        const next = whenTerms(node!);
        if (!next || terms.length * next.length > WHEN_TERM_LIMIT) { return true; }
        terms = terms.flatMap(left => next.map(right => [...left, ...right]));
    }
    return terms.some(possibleTerm);
}

export function normalizeShortcutKey(binding: string): string {
    return binding.trim().toLowerCase().split(/\s+/).map(chord => {
        const parts = chord.split('+').map(part => ({ command: 'ctrlcmd', cmd: 'ctrlcmd', meta: 'ctrlcmd', control: 'ctrl', option: 'alt' } as Record<string, string>)[part] ?? part);
        const key = parts.pop() ?? '';
        return `${[...new Set(parts)].sort().join('+')}+${key}`;
    }).join(' ');
}

/** Same key sequence and satisfiable when expressions on distinct active commands. */
export function shortcutConflicts(rows: readonly ShortcutRow[]): Set<string> {
    const owners = new Map<string, { id: string; binding: ShortcutBinding }[]>();
    for (const row of rows) for (const binding of row.bindings) {
        if (row.id.startsWith('-') || binding.command?.startsWith('-') || !binding.keybinding) { continue; }
        const key = normalizeShortcutKey(binding.keybinding);
        if (!owners.has(key)) { owners.set(key, []); }
        owners.get(key)!.push({ id: row.id, binding });
    }
    const conflicts = new Set<string>();
    for (const entries of owners.values()) for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]; const b = entries[j];
        if (a.id !== b.id && shortcutWhensOverlap(a.binding.when, b.binding.when, a.binding.context, b.binding.context)) {
            conflicts.add(a.id); conflicts.add(b.id);
        }
    }
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
    const parsed = parseWhen(when);
    if (/akari[A-Za-z0-9_]+/.test(when) && parsed && !hasPositiveWhenIdentifier(parsed)) { return ''; }
    if (positive.has('akariKeyframeSelected')) { return 'キーフレームを選んでいるとき'; }
    if (positive.has('akariNumberFieldFocus')) { return '数値の欄'; }
    if (positive.has('akariInspectorFocus')) { return 'インスペクター'; }
    if (positive.has('akariDaihonRowsFocus')) { return '台本の一覧'; }
    if (positive.has('akariTimelineVisible')) { return 'タイムライン'; }
    return when.length > 72 ? `${when.slice(0, 69)}…` : when;
}
