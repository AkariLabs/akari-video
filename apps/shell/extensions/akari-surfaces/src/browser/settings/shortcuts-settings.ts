import { CommandRegistry, Disposable } from '@theia/core/lib/common';
import { KeybindingRegistry, KeybindingScope, ScopedKeybinding } from '@theia/core/lib/browser/keybinding';
import { Key, KeyCode, KeySequence } from '@theia/core/lib/common/keys';
import { KeyboardLayoutService } from '@theia/core/lib/browser/keyboard/keyboard-layout-service';
import { KeymapsService } from '@theia/keymaps/lib/browser/keymaps-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { AkariSettingsMaintenanceService } from '../../common/settings-maintenance-protocol';
import { compareShortcutRows, filterShortcuts, keybindingFromKeyCode, SHORTCUT_GROUPS, ShortcutFilter, ShortcutRow,
    shortcutConflicts, shortcutGroup, shortcutKeyText, shortcutWhen } from '../../common/shortcuts-settings';
import { el, groupCard, segmentedControl, textField } from './settings-ui';
import { settingsIcon } from './settings-icons';

/** Dedicated controls for the shortcut table; all button styling is scoped to Settings v3. */
function shortcutButton(className: string, label: string, click: () => void): HTMLButtonElement {
    const button = el('button', className, label);
    button.type = 'button';
    button.addEventListener('click', click);
    return button;
}

export class ShortcutsSettingsView {
    private filter: ShortcutFilter = 'all';
    private query = '';
    private readonly search: HTMLInputElement;
    private readonly jump = el('div', 'akari-shortcuts-jump');
    private readonly list = el('div', 'akari-shortcuts-list');
    private recording?: { id: string; label: string; old?: ScopedKeybinding; button: HTMLButtonElement };
    private busy = false;
    private readonly changed: Disposable;
    private readonly keydown = (event: KeyboardEvent): void => {
        if (!this.recording) { return; }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (event.key === 'Escape') { this.stopRecording(); return; }
        if (event.repeat || event.isComposing || event.key === 'Process' || event.key === 'Dead') { return; }
        const keybinding = this.keybindingForPhysicalEvent(event);
        if (!keybinding || this.busy) { return; }
        const { id, old } = this.recording;
        this.stopRecording();
        void this.write(async () => {
            const fallback = this.registry.getKeybindingsByScope(KeybindingScope.DEFAULT).find(binding => binding.command === id);
            await this.keymaps.setKeybinding({ command: id, keybinding, when: old?.when ?? fallback?.when,
                context: old?.context ?? fallback?.context }, old);
        });
    };

    constructor(
        private readonly section: HTMLElement,
        private readonly registry: KeybindingRegistry,
        private readonly commands: CommandRegistry,
        private readonly keymaps: KeymapsService,
        private readonly keyboardLayout: KeyboardLayoutService,
        private readonly eventDispatch: () => 'code' | 'keyCode',
        private readonly files: FileService,
        private readonly env: EnvVariablesServer,
        private readonly maintenance: AkariSettingsMaintenanceService,
        private readonly error: (message: string) => void
    ) {
        this.search = textField({ label: 'ショートカットを検索', placeholder: '操作の名前 または キーで探す（例: ⌘B）' });
        this.search.setAttribute('data-shortcuts-search', '');
        this.search.addEventListener('input', () => { this.query = this.search.value; this.renderList(); });
        const searchWrap = el('label', 'akari-shortcuts-search');
        searchWrap.append(settingsIcon('search', 'sm'), this.search);
        const filters = segmentedControl<ShortcutFilter>({ label: 'ショートカットの状態', value: this.filter,
            options: [{ value: 'all', label: 'すべて' }, { value: 'modified', label: '変更した' },
                { value: 'unassigned', label: '未割り当て' }, { value: 'conflicts', label: '重なり' }],
            onChange: value => { this.filter = value; this.renderList(); } });
        filters.querySelectorAll<HTMLButtonElement>('[data-value]').forEach(button =>
            button.setAttribute('data-shortcuts-filter', button.dataset.value ?? ''));
        const open = shortcutButton('akari-set-btn akari-set-btn-ghost akari-set-btn-sm', 'JSON で開く', () => void this.openJson());
        open.prepend(settingsIcon('code', 'sm'));
        open.setAttribute('data-shortcuts-open-json', '');
        const first = el('div', 'akari-shortcuts-controls');
        first.append(searchWrap, filters, open);
        const bar = el('div', 'akari-shortcuts-bar');
        bar.append(first, this.jump);
        section.append(bar, this.list);
        this.changed = registry.onKeybindingsChanged(() => this.renderList());
        this.renderList();
    }

    /** Invert Theia's layout resolution so a saved binding resolves to this exact physical press. */
    private keybindingForPhysicalEvent(event: KeyboardEvent): string | undefined {
        let pressed: KeyCode;
        try { pressed = KeyCode.createKeyCode(event, this.eventDispatch()); }
        catch { return undefined; }
        if (pressed.isModifierOnly()) { return undefined; }
        this.keyboardLayout.validateKeyCode(pressed);
        const mac = navigator.platform.includes('Mac');
        const candidates = [pressed.key!, ...Object.values(Key).filter(Key.isKey)];
        // A JIS key may require Shift/Alt in the persisted logical spelling even when
        // the physical press did not. Try the pressed modifiers first, then nearest variants.
        const modifiers = [false, true].flatMap(shift => [false, true].flatMap(alt =>
            [false, true].map(ctrl => ({ shift, alt, ctrl })))).sort((a, b) =>
            Number(a.shift !== pressed.shift) + Number(a.alt !== pressed.alt) + Number(a.ctrl !== pressed.ctrl)
            - Number(b.shift !== pressed.shift) - Number(b.alt !== pressed.alt) - Number(b.ctrl !== pressed.ctrl));
        for (const variant of modifiers) {
            const seen = new Set<string>();
            for (const key of candidates) {
                if (seen.has(key.code)) { continue; }
                seen.add(key.code);
                const binding = keybindingFromKeyCode({ ...pressed, ...variant, key }, mac);
                if (!binding) { continue; }
                try {
                    const parsed = KeySequence.parse(binding);
                    if (parsed.length === 1 && this.keyboardLayout.resolveKeyCode(parsed[0]).equals(pressed)) { return binding; }
                } catch { /* This physical key has no representable Theia binding. */ }
            }
        }
        return undefined;
    }

    dispose(): void {
        this.stopRecording();
        this.changed.dispose();
    }

    private rows(): ShortcutRow[] {
        const byId = new Map<string, ScopedKeybinding[]>();
        for (const scope of [KeybindingScope.DEFAULT, KeybindingScope.USER, KeybindingScope.WORKSPACE]) {
            for (const binding of this.registry.getKeybindingsByScope(scope)) {
                const id = binding.command.replace(/^-/, '');
                if (!byId.has(id)) { byId.set(id, []); }
                byId.get(id)!.push(binding);
            }
        }
        const userIds = new Set(this.registry.getKeybindingsByScope(KeybindingScope.USER).map(binding => binding.command.replace(/^-/, '')));
        const ids = new Set<string>();
        for (const command of this.commands.commands) if (command.id.startsWith('akari.') && command.label) { ids.add(command.id); }
        for (const id of byId.keys()) if (this.commands.getCommand(id)) { ids.add(id); }
        const rows: ShortcutRow[] = [...ids].map(id => {
            const command = this.commands.getCommand(id);
            const bindings = this.registry.getKeybindingsForCommand(id);
            return { id, label: command?.label ?? id, group: shortcutGroup(id), bindings,
                modified: userIds.has(id), conflict: false };
        }).filter(row => row.id.startsWith('akari.') ? !!this.commands.getCommand(row.id)?.label : row.bindings.length > 0 || userIds.has(row.id));
        const conflicts = shortcutConflicts(rows);
        for (const row of rows) { row.conflict = conflicts.has(row.id); }
        rows.sort(compareShortcutRows);
        return rows;
    }

    private renderList(): void {
        if (this.recording) { this.stopRecording(false); }
        this.jump.replaceChildren();
        this.list.replaceChildren();
        const rows = filterShortcuts(this.rows(), this.query, this.filter);
        for (const group of SHORTCUT_GROUPS) {
            const members = rows.filter(row => row.group === group.id);
            if (!members.length) { continue; }
            const heading = el('h3', 'akari-shortcuts-heading', `${group.label} · ${members.length}`);
            heading.setAttribute('data-shortcuts-group', group.id);
            const chip = shortcutButton('akari-shortcuts-chip', group.label, () => heading.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            chip.setAttribute('data-shortcuts-jump', group.id);
            this.jump.append(chip);
            const card = groupCard(undefined, ...members.map(row => this.renderRow(row)));
            card.classList.add('akari-shortcuts-card');
            this.list.append(heading, card);
        }
        if (!rows.length) { this.list.append(el('p', 'akari-shortcuts-empty', '一致する操作はありません。')); }
    }

    private renderRow(row: ShortcutRow): HTMLElement {
        const node = el('div', 'akari-shortcuts-row');
        node.setAttribute('data-shortcuts-row', row.id);
        const name = el('div', 'akari-shortcuts-name');
        name.append(el('span', undefined, row.label));
        if (row.conflict) {
            const badge = el('span', 'akari-shortcuts-conflict', '重なり');
            badge.setAttribute('data-shortcuts-conflict', '');
            name.append(badge);
        }
        const conditions = [...new Set(row.bindings.map(binding => shortcutWhen(binding.when)))];
        if (!conditions.length) {
            const original = this.registry.getKeybindingsByScope(KeybindingScope.DEFAULT).find(binding => binding.command === row.id);
            conditions.push(shortcutWhen(original?.when));
        }
        const when = el('div', 'akari-shortcuts-when', conditions.join(' / '));
        const keys = el('div', 'akari-shortcuts-keys');
        if (!row.bindings.length) { keys.append(this.keyButton(row.id, row.label)); }
        else for (const binding of row.bindings) { keys.append(this.keyButton(row.id, row.label, binding as ScopedKeybinding)); }
        const menu = this.rowMenu(row);
        node.append(name, when, keys, menu);
        return node;
    }

    private keyButton(id: string, label: string, binding?: ScopedKeybinding): HTMLButtonElement {
        const button = shortcutButton('akari-shortcuts-key', '', () => this.startRecording(id, label, binding, button));
        button.setAttribute('data-shortcuts-key', '');
        const chords = binding ? shortcutKeyText(binding.keybinding) : [];
        const displayed = chords.map(parts => parts.join(' ')).join(' / ') || '未割り当て';
        button.setAttribute('aria-label', `${label} のキー ${displayed} を変更`);
        if (binding) {
            chords.forEach((parts, index) => {
                if (index) { button.append(el('span', 'akari-shortcuts-chord', 'つぎ')); }
                for (const part of parts) { button.append(el('kbd', undefined, part)); }
            });
        } else { button.append(el('span', 'akari-shortcuts-unassigned', '未割り当て')); }
        return button;
    }

    private startRecording(id: string, label: string, old: ScopedKeybinding | undefined, button: HTMLButtonElement): void {
        if (this.busy) { return; }
        this.stopRecording(false);
        this.recording = { id, label, old, button };
        button.replaceChildren(el('span', 'akari-shortcuts-record-label', 'キーを押す…'));
        button.setAttribute('data-recording', 'true');
        window.addEventListener('keydown', this.keydown, true);
    }
    private stopRecording(refresh = true): void {
        if (!this.recording) { return; }
        const { id, label, old, button } = this.recording;
        this.recording = undefined;
        window.removeEventListener('keydown', this.keydown, true);
        if (refresh) { this.renderList(); }
        else { button.replaceWith(this.keyButton(id, label, old)); }
    }

    private rowMenu(row: ShortcutRow): HTMLElement {
        const wrap = el('div', 'akari-shortcuts-menu');
        const trigger = shortcutButton('akari-shortcuts-more', '…', () => {
            const next = !items.hidden;
            this.section.querySelectorAll<HTMLElement>('.akari-shortcuts-menu-items').forEach(item => { item.hidden = true; });
            items.hidden = next;
            trigger.setAttribute('aria-expanded', String(!next));
        });
        trigger.setAttribute('data-shortcuts-menu', '');
        trigger.setAttribute('aria-label', `${row.label} のメニュー`);
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        const items = el('div', 'akari-shortcuts-menu-items');
        items.setAttribute('role', 'menu');
        items.hidden = true;
        const disable = shortcutButton('akari-shortcuts-menu-action', '無効にする', () => {
            items.hidden = true;
            void this.write(async () => {
                for (const binding of this.registry.getKeybindingsForCommand(row.id)) { await this.keymaps.unsetKeybinding(binding); }
            });
        });
        disable.setAttribute('data-shortcuts-action', 'disable');
        disable.setAttribute('role', 'menuitem');
        disable.disabled = row.bindings.length === 0;
        const reset = shortcutButton('akari-shortcuts-menu-action', '既定に戻す', () => {
            items.hidden = true;
            void this.write(() => this.keymaps.removeKeybinding(row.id));
        });
        reset.setAttribute('data-shortcuts-action', 'reset');
        reset.setAttribute('role', 'menuitem');
        reset.disabled = !row.modified;
        items.append(disable, reset);
        wrap.append(trigger, items);
        return wrap;
    }

    private async write(operation: () => Promise<void>): Promise<void> {
        this.busy = true;
        try { await operation(); this.renderList(); }
        catch (error) { this.error(`ショートカットを保存できませんでした: ${String(error)}`); }
        finally { this.busy = false; }
    }
    private async openJson(): Promise<void> {
        try {
            const config = new URI(await this.env.getConfigDirUri());
            if (!await this.files.exists(config)) { await this.files.createFolder(config); }
            const file = config.resolve('keymaps.json');
            if (!await this.files.exists(file)) { await this.files.create(file, '[]\n'); }
            await this.maintenance.openPath(file.path.fsPath());
        } catch (error) { this.error(`keymaps.json を開けませんでした: ${String(error)}`); }
    }
}
