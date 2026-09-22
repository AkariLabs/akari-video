import { settingsIcon, SettingsIconName } from './settings-icons';

/**
 * 設定ダイアログ専用の小さな部品群（2026-09-22 設定ダイアログ刷新）。
 *
 * 素の select 要素・radio・checkbox の input は使わない。選択は ARIA の role（listbox / radiogroup / switch /
 * checkbox）を持つ button で作り、キーボード操作（矢印・Enter・Space・Esc）を部品側で持つ。
 * 見た目は settings-ui-style.ts の CSS（`--akari-*` トークンだけを参照）が決める。ここではクラス名だけを付ける。
 */

export interface SettingsOption<T extends string = string> {
    value: T;
    label: string;
    description?: string;
    icon?: SettingsIconName;
    disabled?: boolean;
    title?: string;
}

let sequence = 0;
function nextId(prefix: string): string { return `akari-set-${prefix}-${++sequence}`; }

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined) { node.textContent = text; }
    return node;
}

/** グループのカード。title はカード左上の小さな見出し（無ければ省く）。 */
export function groupCard(title: string | undefined, ...children: Node[]): HTMLElement {
    const card = el('div', 'akari-set-group');
    card.setAttribute('data-akari-settings-group', title ?? '');
    if (title) {
        const heading = el('div', 'akari-set-group-title', title);
        heading.setAttribute('role', 'heading');
        heading.setAttribute('aria-level', '3');
        card.append(heading);
    }
    card.append(...children);
    return card;
}

/** 行: 左 = ラベル + 説明、右 = 操作。 */
export function settingRow(label: string, description: string | undefined, ...controls: Node[]): HTMLElement {
    const row = el('div', 'akari-set-row');
    const text = el('div', 'akari-set-row-text');
    const title = el('div', 'akari-set-row-label', label);
    text.append(title);
    if (description) { text.append(el('div', 'akari-set-row-desc', description)); }
    const control = el('div', 'akari-set-row-control');
    control.append(...controls);
    row.append(text, control);
    return row;
}

/** 小さな注記（カードの下など）。 */
export function settingsNote(text: string): HTMLElement {
    return el('p', 'akari-set-note', text);
}

export type PillTone = 'ok' | 'neutral' | 'warn' | 'accent';
export function statusPill(text: string, tone: PillTone = 'neutral'): HTMLElement {
    const pill = el('span', `akari-set-pill akari-set-pill-${tone}`, text);
    pill.setAttribute('data-akari-pill-tone', tone);
    return pill;
}

export function setPill(pill: HTMLElement, text: string, tone: PillTone): void {
    pill.textContent = text;
    pill.className = `akari-set-pill akari-set-pill-${tone}`;
    pill.setAttribute('data-akari-pill-tone', tone);
}

/** オン / オフのスイッチ（role=switch）。押したら即 onChange。 */
export function switchControl(options: { label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }): HTMLButtonElement {
    const button = el('button', 'akari-set-switch');
    button.type = 'button';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', options.label);
    button.setAttribute('aria-checked', String(options.checked));
    button.disabled = !!options.disabled;
    button.append(el('span', 'akari-set-switch-knob'));
    button.addEventListener('click', () => {
        const next = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', String(next));
        options.onChange(next);
    });
    return button;
}

/**
 * 1 つだけ選ぶ群（role=radiogroup）の共通処理。矢印キーで隣へ移って選ぶ（ネイティブ radio と同じ）、
 * Tab で入るのは選択中の 1 個だけ（roving tabindex）。
 */
function radioGroup<T extends string>(
    group: HTMLElement, items: { value: T; button: HTMLButtonElement; disabled?: boolean }[], value: T, onChange: (value: T) => void
): void {
    let current = value;
    const paint = (): void => {
        const focusable = items.some(item => item.value === current) ? current : items.find(item => !item.disabled)?.value;
        for (const item of items) {
            const on = item.value === current;
            item.button.setAttribute('aria-checked', String(on));
            item.button.tabIndex = item.value === focusable ? 0 : -1;
        }
    };
    const select = (item: { value: T; button: HTMLButtonElement; disabled?: boolean }, focus: boolean): void => {
        if (item.disabled) { return; }
        const changed = item.value !== current;
        current = item.value;
        paint();
        if (focus) { item.button.focus(); }
        if (changed) { onChange(item.value); }
    };
    for (const item of items) {
        item.button.addEventListener('click', () => select(item, false));
        item.button.addEventListener('keydown', event => {
            const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
            const step = keys[event.key];
            if (!step) { return; }
            event.preventDefault();
            const enabled = items.filter(candidate => !candidate.disabled);
            const index = enabled.indexOf(item);
            select(enabled[(index + step + enabled.length) % enabled.length], true);
        });
    }
    group.setAttribute('role', 'radiogroup');
    paint();
}

/** セグメント（丸いピルの中の 2〜6 択）。 */
export function segmentedControl<T extends string>(options: {
    label: string; options: readonly SettingsOption<T>[]; value: T; onChange: (value: T) => void;
}): HTMLElement {
    const group = el('div', 'akari-set-seg');
    group.setAttribute('aria-label', options.label);
    group.setAttribute('data-akari-segmented', options.label);
    const items = options.options.map(option => {
        const button = el('button', 'akari-set-seg-item', option.label);
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.setAttribute('data-value', option.value);
        if (option.title) { button.title = option.title; }
        if (option.disabled) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
        group.append(button);
        return { value: option.value, button, disabled: option.disabled };
    });
    radioGroup(group, items, options.value, options.onChange);
    return group;
}

/** 選択カード（テーマ・画質・モードなど）。preview はカード上部に置く絵（テーマの見本など）。 */
export function choiceCards<T extends string>(options: {
    label: string; options: readonly (SettingsOption<T> & { preview?: HTMLElement })[]; value: T; columns: number; onChange: (value: T) => void;
}): HTMLElement {
    const group = el('div', `akari-set-cards akari-set-cards-${options.columns}`);
    group.setAttribute('aria-label', options.label);
    group.setAttribute('data-akari-choice-cards', options.label);
    const items = options.options.map(option => {
        const button = el('button', 'akari-set-card');
        button.type = 'button';
        button.setAttribute('role', 'radio');
        button.setAttribute('data-value', option.value);
        if (option.preview) { button.append(option.preview); }
        const top = el('span', 'akari-set-card-title');
        if (option.icon) { top.append(settingsIcon(option.icon)); }
        top.append(el('span', undefined, option.label));
        button.append(top);
        if (option.description) { button.append(el('span', 'akari-set-card-desc', option.description)); }
        group.append(button);
        return { value: option.value, button, disabled: option.disabled };
    });
    radioGroup(group, items, options.value, options.onChange);
    return group;
}

/** 複数選ぶチェックの並び（role=checkbox の button）。 */
export function checkChips<T extends string>(options: {
    label: string; options: readonly SettingsOption<T>[]; checked: readonly T[]; onToggle: (value: T, checked: boolean) => void;
}): HTMLElement {
    const group = el('div', 'akari-set-chips');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', options.label);
    for (const option of options.options) {
        const button = el('button', 'akari-set-chip');
        button.type = 'button';
        button.setAttribute('role', 'checkbox');
        button.setAttribute('data-value', option.value);
        button.setAttribute('aria-checked', String(options.checked.includes(option.value)));
        const box = el('span', 'akari-set-chip-box');
        box.append(settingsIcon('check', 'sm'));
        button.append(box, el('span', undefined, option.label));
        button.addEventListener('click', () => {
            const next = button.getAttribute('aria-checked') !== 'true';
            button.setAttribute('aria-checked', String(next));
            options.onToggle(option.value, next);
        });
        group.append(button);
    }
    return group;
}

export interface DropdownHandle extends HTMLElement {
    akariSetDisabled?: (disabled: boolean) => void;
}

/**
 * 自前のドロップダウン（button + role=listbox）。選択肢ごとに一言の説明とチェックの印を出す。
 * キーボード: ボタン上で ArrowDown / ArrowUp / Enter / Space = 開く。一覧で ArrowUp / ArrowDown / Home / End = 移動、Enter / Space = 決定、Esc = 閉じる。
 * Esc は設定ダイアログ自体を閉じないよう、開いている間だけ伝播を止める。
 */
export function dropdown<T extends string>(options: {
    label: string; options: readonly SettingsOption<T>[]; value: T; onChange: (value: T) => void; disabled?: boolean;
}): DropdownHandle {
    const wrap = el('div', 'akari-set-dropdown') as DropdownHandle;
    wrap.setAttribute('data-akari-dropdown', options.label);
    const button = el('button', 'akari-set-dropdown-button');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', options.label);
    const current = el('span', 'akari-set-dropdown-current');
    button.append(current, settingsIcon('chev', 'sm'));
    const list = el('div', 'akari-set-dropdown-list');
    const listId = nextId('listbox');
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', options.label);
    list.tabIndex = -1;
    list.hidden = true;
    button.setAttribute('aria-controls', listId);
    let value = options.value;
    let active = Math.max(0, options.options.findIndex(option => option.value === value));
    const nodes = options.options.map((option, index) => {
        const node = el('div', 'akari-set-option');
        node.id = `${listId}-${index}`;
        node.setAttribute('role', 'option');
        node.setAttribute('data-value', option.value);
        if (option.disabled) { node.setAttribute('aria-disabled', 'true'); }
        const text = el('div', 'akari-set-option-text');
        text.append(el('span', 'akari-set-option-label', option.label));
        if (option.description) { text.append(el('small', 'akari-set-option-desc', option.description)); }
        node.append(settingsIcon('check', 'sm'), text);
        node.addEventListener('mousedown', event => event.preventDefault());
        node.addEventListener('click', () => choose(index));
        node.addEventListener('mousemove', () => setActive(index));
        list.append(node);
        return node;
    });
    const paint = (): void => {
        const selected = options.options.find(option => option.value === value);
        current.textContent = selected?.label ?? value;
        nodes.forEach((node, index) => node.setAttribute('aria-selected', String(options.options[index].value === value)));
    };
    const setActive = (index: number): void => {
        active = index;
        nodes.forEach((node, candidate) => node.classList?.toggle('akari-set-option-active', candidate === index));
        list.setAttribute('aria-activedescendant', nodes[index]?.id ?? '');
        nodes[index]?.scrollIntoView?.({ block: 'nearest' });
    };
    const outside = (event: MouseEvent): void => {
        if (!wrap.contains(event.target as Node)) { close(false); }
    };
    const open = (): void => {
        if (button.disabled || !list.hidden) { return; }
        list.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        // 下に入り切らないときだけ上へ開く（ページのスクロール領域の中で見切れないように）。
        const scroller = wrap.closest('[data-akari-settings-section]') as HTMLElement | null;
        const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
        const rect = button.getBoundingClientRect();
        wrap.classList.toggle('akari-set-dropdown-up', rect.bottom + list.offsetHeight + 8 > bottom && rect.top - list.offsetHeight > 0);
        setActive(Math.max(0, options.options.findIndex(option => option.value === value)));
        list.focus();
        document.addEventListener('mousedown', outside, true);
    };
    const close = (focusButton = true): void => {
        if (list.hidden) { return; }
        list.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        document.removeEventListener('mousedown', outside, true);
        if (focusButton) { button.focus(); }
    };
    const choose = (index: number): void => {
        const option = options.options[index];
        if (!option || option.disabled) { return; }
        const changed = option.value !== value;
        value = option.value;
        paint();
        close();
        if (changed) { options.onChange(value); }
    };
    const move = (step: number): void => {
        const count = options.options.length;
        let index = active;
        for (let tries = 0; tries < count; tries++) {
            index = (index + step + count) % count;
            if (!options.options[index].disabled) { break; }
        }
        setActive(index);
    };
    button.addEventListener('click', () => { if (list.hidden) { open(); } else { close(); } });
    button.addEventListener('keydown', event => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            open();
        }
    });
    list.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown') { move(1); }
        else if (event.key === 'ArrowUp') { move(-1); }
        else if (event.key === 'Home') { setActive(0); }
        else if (event.key === 'End') { setActive(options.options.length - 1); }
        else if (event.key === 'Enter' || event.key === ' ') { choose(active); }
        else if (event.key === 'Escape') { close(); }
        else if (event.key === 'Tab') { close(false); return; }
        else { return; }
        event.preventDefault();
        event.stopPropagation();
    });
    list.addEventListener('focusout', event => {
        if (!wrap.contains(event.relatedTarget as Node | null)) { close(false); }
    });
    wrap.akariSetDisabled = disabled => {
        button.disabled = disabled;
        if (disabled) { close(false); }
    };
    button.disabled = !!options.disabled;
    wrap.append(button, list);
    paint();
    return wrap;
}

/** 1 行の入力欄（text / password）。素の input だが select / radio / checkbox ではない。 */
export function textField(options: {
    label: string; value?: string; placeholder?: string; type?: 'text' | 'password'; onChange?: (value: string) => void; wide?: boolean;
}): HTMLInputElement {
    const input = el('input', `akari-set-input${options.wide ? ' akari-set-input-wide' : ''}`);
    input.type = options.type ?? 'text';
    input.value = options.value ?? '';
    input.spellcheck = false;
    if (options.placeholder) { input.placeholder = options.placeholder; }
    input.setAttribute('aria-label', options.label);
    if (options.onChange) { input.addEventListener('change', () => options.onChange!(input.value)); }
    return input;
}
