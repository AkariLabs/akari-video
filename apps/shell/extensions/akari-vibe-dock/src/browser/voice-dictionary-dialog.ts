import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { AkariVoiceDictionaryService, VoiceEntry } from '../common/voice-dictionary-protocol';

const HISTORY_KEY = 'akari.listening.history';
const CORRECTIONS_KEY = 'akari.listening.showCorrections';
const phraseKey = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s/gu, '');
const localDate = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.slice(0, 10);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
};
const button = (label: string, action: () => void, style = 'secondary small'): HTMLButtonElement => {
    const result = node('button', `theia-button ${style}`, label);
    result.type = 'button';
    result.onclick = action;
    return result;
};

function ensureStyles(): void {
    if (document.getElementById('akari-voice-dictionary-style')) return;
    const style = node('style');
    style.id = 'akari-voice-dictionary-style';
    style.textContent = `
.akari-voice-dict-dialog .dialogBlock { width: min(760px, calc(100vw - 48px)) !important; min-width: 0 !important; max-width: none !important; max-height: calc(100vh - 48px) !important; padding: 0 !important; border: 1px solid var(--akari-line) !important; border-radius: 12px !important; background: var(--akari-card) !important; overflow: hidden; }
.akari-voice-dict-dialog .dialogTitle, .akari-voice-dict-dialog .dialogControl { display: none !important; }
.akari-voice-dict-dialog .dialogContent { min-height: 0; padding: 0 !important; max-height: calc(100vh - 48px) !important; overflow: hidden !important; }
.akari-voice-dict { display: flex; flex-direction: column; min-height: 0; max-height: calc(100vh - 48px); color: var(--akari-ink); }
.akari-voice-dict-header { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 20px 20px 0; }
.akari-voice-dict-heading { color: var(--akari-ink); font-size: 18px; font-weight: 700; line-height: 1.4; }
.akari-voice-dict-header .closeButton { color: var(--akari-muted); cursor: pointer; }
.akari-voice-dict-lead { flex: none; margin: 0; padding: 10px 20px 18px; color: var(--akari-muted); font-size: 12px; line-height: 1.6; }
.akari-voice-dict-table-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; scroll-padding-block: 40px 8px; padding: 0 20px; }
.akari-voice-dict-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
.akari-voice-dict-table th { position: sticky; top: 0; background: var(--akari-card); padding: 9px 10px; text-align: left; color: var(--akari-faint); font-size: 11px; font-weight: 500; border-bottom: 1px solid var(--akari-line-inner); }
.akari-voice-dict-table th:first-child { width: 27%; }
.akari-voice-dict-table th:last-child { width: 24%; }
.akari-voice-dict-table td { padding: 9px 10px; border-bottom: 1px solid var(--akari-line-inner); vertical-align: middle; overflow-wrap: anywhere; }
.akari-voice-dict-table tr.akari-voice-dict-overridden { opacity: .48; }
.akari-voice-dict-source { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; color: var(--akari-faint); font-size: 11px; }
.akari-voice-dict-source .theia-button { margin-inline-start: auto; }
.akari-voice-dict-badge { padding: 2px 6px; border: 1px solid var(--akari-line); border-radius: 999px; font-size: 10px; }
.akari-voice-dict-row-edit { cursor: pointer; }
.akari-voice-dict-row-edit:hover { background: var(--akari-elevated); }
.akari-voice-dict-input { box-sizing: border-box; width: 100%; border: 1px solid var(--akari-line); border-radius: 6px; background: var(--akari-bg); color: var(--akari-ink); padding: 6px 8px; font: inherit; resize: none; }
.akari-voice-dict-input:focus { outline: 1px solid var(--akari-accent-light); }
.akari-voice-dict-scopes { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 6px; }
.akari-voice-dict-scope-label { margin-bottom: 5px; color: var(--akari-faint); font-size: 11px; }
.akari-voice-dict-editing, .akari-voice-dict-error { scroll-margin-block: 40px 8px; }
.akari-voice-dict-error td { color: var(--theia-errorForeground); font-size: 11px; padding-top: 3px; }
.akari-voice-dict-error:has(td:empty) { display: none; }
.akari-voice-dict-empty { color: var(--akari-faint); }
.akari-voice-dict-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 14px 20px 16px; }
.akari-voice-dict-footer .akari-voice-dict-check { margin-inline-start: auto; }
.akari-voice-dict-check { display: inline-flex; align-items: center; gap: 5px; color: var(--akari-muted); font-size: 11px; white-space: nowrap; }
.akari-voice-dict-check input { accent-color: var(--akari-accent); }
.akari-voice-dict-options { flex: none; }
.akari-voice-dict-options button { font-size: 11px; padding: 5px 8px; }
.akari-voice-dict-history-reason { color: var(--akari-faint); font-size: 11px; }
.akari-voice-dict-notice { padding: 0 20px; color: var(--theia-errorForeground); font-size: 11px; }
.akari-voice-dict-notice:empty { display: none; }
.akari-voice-dict-history { display: grid; gap: 8px; padding: 8px 0 12px; }
.akari-voice-dict-history-item { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--akari-line-inner); border-radius: 8px; }
.akari-voice-dict-history-item textarea { min-height: 40px; }
.akari-voice-dict-history-item .theia-button { justify-self: start; }
`;
    document.head.append(style);
}

export class VoiceDictionaryDialog extends AbstractDialog<void> {
    protected readonly content = node('div', 'akari-voice-dict');
    protected readonly header = node('div', 'akari-voice-dict-header');
    protected readonly lead = node('p', 'akari-voice-dict-lead', '聞き取った文の言い換え。上から順に当てます。同梱の辞書は消せませんが、自分の辞書で上書きできます。');
    protected readonly scroll = node('div', 'akari-voice-dict-table-scroll');
    protected readonly footer = node('div', 'akari-voice-dict-footer');
    protected readonly notice = node('div', 'akari-voice-dict-notice');
    protected editingId: string | undefined;
    protected draftKind: 'fix' | 'snippet' | undefined;
    protected draftFrom = '';
    protected draftSource: string | undefined;
    protected historyOpen = false;
    protected addOptionsOpen = false;
    protected historyRows: Awaited<ReturnType<AkariVoiceDictionaryService['history']>> = [];
    protected error = '';
    protected userEntries: VoiceEntry[] = [];
    get value(): void { return undefined; }
    protected override handleEnter(_event: KeyboardEvent): boolean { return false; }

    constructor(protected readonly service: AkariVoiceDictionaryService, protected readonly preferences: PreferenceService) {
        super({ title: '辞書' });
        ensureStyles();
        this.node.classList.add('akari-voice-dict-dialog');
        this.node.dataset.akariVoiceDictionaryDialog = 'true';
        this.titleNode.classList.add('akari-voice-dict-heading');
        this.header.append(this.titleNode, this.closeCrossNode);
        this.content.append(this.header, this.lead, this.scroll, this.notice, this.footer);
        this.contentNode.append(this.content);
        document.documentElement.dataset.akariCorrections = String(this.preferences.get<boolean>(CORRECTIONS_KEY, true));
        void this.render();
    }

    protected async render(): Promise<void> {
        const listed = await this.service.list();
        this.userEntries = listed.user;
        if (this.preferences.get<boolean>(HISTORY_KEY, false)) {
            this.historyRows = await this.service.history().catch(() => []);
        } else { this.historyRows = []; this.historyOpen = false; }
        const table = node('table', 'akari-voice-dict-table');
        const head = node('thead');
        const headings = node('tr');
        for (const label of ['聞こえたまま', '言い換え', '出どころ']) headings.append(node('th', undefined, label));
        head.append(headings);
        const body = node('tbody');
        for (const entry of listed.builtin) {
            const overridden = listed.overriddenIds.includes(entry.id) || listed.user.some(item =>
                item.kind === 'fix' && item.from?.some(phrase => entry.from?.includes(phrase)));
            const row = node('tr', overridden ? 'akari-voice-dict-overridden' : undefined);
            row.append(node('td', undefined, entry.from?.join(' / ') ?? ''),
                node('td', undefined, entry.to ?? ''));
            const source = node('td');
            const detail = node('span', 'akari-voice-dict-source', '同梱');
            if (overridden) detail.append(node('span', 'akari-voice-dict-badge', '自分の辞書で上書き'));
            source.append(detail); row.append(source); body.append(row);
        }
        for (const entry of listed.user) {
            if (this.editingId === entry.id) this.appendEditor(body, entry);
            else this.appendUserRow(body, entry);
        }
        if (this.draftKind) this.appendEditor(body, { kind: this.draftKind, from: this.draftFrom ? [this.draftFrom] : [], to: '', trigger: [], expand: '', scope: ['task'], source: this.draftSource });
        if (!listed.builtin.length && !listed.user.length && !this.draftKind) {
            const empty = node('tr');
            const cell = node('td', 'akari-voice-dict-empty', '辞書に項目はありません');
            cell.colSpan = 3; empty.append(cell); body.append(empty);
        }
        table.append(head, body);
        this.scroll.replaceChildren(table);
        if (this.historyOpen) this.appendHistory();
        this.paintFooter();
    }

    protected appendUserRow(body: HTMLElement, entry: VoiceEntry): void {
        const row = node('tr', 'akari-voice-dict-row-edit');
        const from = entry.kind === 'fix' ? entry.from?.join(' / ') : entry.trigger?.join(' / ');
        const to = entry.kind === 'fix' ? entry.to : `（プロンプト『${entry.expand ?? ''}』を差し込む）`;
        row.append(node('td', undefined, from ?? ''), node('td', undefined, to ?? ''));
        const source = node('td');
        const date = localDate(entry.added_at);
        const detail = node('span', 'akari-voice-dict-source', `自分${date ? ` · ${date}` : ''}`);
        const remove = button('消す', () => { void this.remove(entry.id); }, 'quiet small');
        remove.setAttribute('aria-label', `${from ?? 'この項目'}を消す`);
        detail.append(remove); source.append(detail); row.append(source);
        row.tabIndex = 0;
        row.title = '押すと編集できます';
        row.addEventListener('click', event => {
            if ((event.target as HTMLElement).closest('button')) return;
            this.editingId = entry.id; this.error = ''; void this.render();
        });
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter') { this.editingId = entry.id; this.error = ''; void this.render(); }
        });
        body.append(row);
    }

    protected appendEditor(body: HTMLElement, entry: Partial<VoiceEntry>): void {
        const kind = entry.kind ?? 'fix';
        const row = node('tr', 'akari-voice-dict-editing');
        const phrases = node('textarea', 'akari-voice-dict-input');
        phrases.rows = 2;
        phrases.setAttribute('aria-label', kind === 'fix' ? '聞こえたまま（改行で複数）' : '合言葉（改行で複数）');
        phrases.value = (kind === 'fix' ? entry.from : entry.trigger)?.join('\n') ?? '';
        const destination = node('textarea', 'akari-voice-dict-input');
        destination.rows = 2;
        destination.setAttribute('aria-label', kind === 'fix' ? '言い換え' : '差し込むプロンプト');
        destination.value = (kind === 'fix' ? entry.to : entry.expand) ?? '';
        const fromCell = node('td'); fromCell.append(phrases);
        const toCell = node('td'); toCell.append(destination);
        const controls = node('td');
        const scopes: Array<{ value: 'note' | 'task' | 'partner'; input: HTMLInputElement }> = [];
        if (kind === 'snippet') {
            const scopeLine = node('div', 'akari-voice-dict-scopes');
            for (const [value, labelText] of [['note', 'メモ'], ['task', 'タスク'], ['partner', 'パートナー']] as const) {
                const label = node('label', 'akari-voice-dict-check');
                const input = node('input'); input.type = 'checkbox';
                input.checked = (entry.scope ?? ['task']).includes(value);
                label.append(input, node('span', undefined, labelText));
                scopeLine.append(label); scopes.push({ value, input });
            }
            controls.append(node('div', 'akari-voice-dict-scope-label', '宛先'), scopeLine);
        }
        const save = button('確定', () => { void commit(); }, 'secondary small');
        const cancel = button('戻す', () => { this.cancelEdit(); }, 'quiet small');
        controls.append(save, cancel);
        row.append(fromCell, toCell, controls); body.append(row);
        const errorRow = node('tr', 'akari-voice-dict-error');
        const errorCell = node('td', undefined, this.error);
        errorCell.colSpan = 3; errorRow.append(errorCell); body.append(errorRow);
        const showError = (message: string): void => {
            errorCell.textContent = message;
            requestAnimationFrame(() => { if (errorRow.isConnected) errorRow.scrollIntoView({ block: 'nearest' }); });
        };
        if (kind === 'snippet') destination.addEventListener('input', () => {
            const warning = /sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|[A-Za-z0-9]{40,}/u.test(destination.value);
            if (warning) showError('鍵らしき文字列が含まれています');
            else errorCell.textContent = '';
        });
        const commit = async (): Promise<void> => {
            const values = phrases.value.split('\n').map(value => value.trim()).filter(Boolean);
            const resultText = destination.value.trim();
            if (!values.length || !resultText) { showError('聞こえたままと言い換えを入力してください'); return; }
            if (values.some(value => value.length > 120) || resultText.length > (kind === 'snippet' ? 2000 : 4000)) {
                showError('入力が長すぎます'); return;
            }
            if (new Set(values.map(phraseKey)).size !== values.length) { showError('同じ言葉が重複しています'); return; }
            if (this.userEntries.some(item => item.id !== entry.id &&
                values.some(value => (item.kind === 'fix' ? item.from : item.trigger)?.some(phrase => phraseKey(phrase) === phraseKey(value))))) {
                showError('自分の辞書に同じ言葉があります'); return;
            }
            if (kind === 'snippet' && !scopes.some(choice => choice.input.checked)) {
                showError('行き先を選んでください'); return;
            }
            const next: Partial<VoiceEntry> = kind === 'fix'
                ? { ...entry, kind, from: values, to: resultText, source: entry.source ?? 'manual' }
                : { ...entry, kind, trigger: values, expand: resultText,
                    scope: scopes.filter(choice => choice.input.checked).map(choice => choice.value), source: entry.source ?? 'manual' };
            const result = await this.service.upsert(next);
            if (!result.ok) { showError(result.errors?.join('、') ?? '保存できません'); return; }
            this.cancelEdit(false);
            await this.render();
            this.notice.textContent = result.warnings?.join('、') ?? '';
            if (entry.source === 'history' && result.entry) {
                const count = await this.service.countHistoryMatches(result.entry.id);
                this.notice.textContent = `同じ履歴へ当て直した件数: ${count} 件`;
            }
        };
        for (const input of [phrases, destination]) input.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); this.cancelEdit(); }
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); void commit(); }
        });
        requestAnimationFrame(() => {
            if (!row.isConnected) return;
            row.scrollIntoView({ block: 'nearest' });
            phrases.focus({ preventScroll: true });
        });
    }

    protected cancelEdit(repaint = true): void {
        this.editingId = undefined; this.draftKind = undefined; this.draftFrom = ''; this.draftSource = undefined; this.error = '';
        if (repaint) void this.render();
    }

    protected appendHistory(): void {
        const panel = node('div', 'akari-voice-dict-history');
        for (const item of this.historyRows) {
            const card = node('div', 'akari-voice-dict-history-item');
            const raw = node('textarea', 'akari-voice-dict-input');
            raw.value = item.raw; raw.readOnly = true;
            raw.setAttribute('aria-label', '履歴の言葉を選ぶ');
            const pick = button('選んだ語を足す', () => {
                const selected = raw.value.slice(raw.selectionStart, raw.selectionEnd);
                if (!selected) { this.notice.textContent = '足したい言葉を選んでください'; return; }
                this.draftKind = 'fix'; this.draftFrom = selected; this.draftSource = 'history'; this.historyOpen = false; void this.render();
            }, 'quiet small');
            card.append(raw, node('span', 'akari-voice-dict-source', `辞書を当てた形: ${item.text}`), pick);
            panel.append(card);
        }
        panel.append(button('履歴を消す', () => { void this.service.clearHistory().then(() => this.render()); }, 'quiet small'));
        this.scroll.append(panel);
    }

    protected paintFooter(): void {
        this.footer.replaceChildren();
        const add = button('＋ 言い換えを足す', () => {
            this.addOptionsOpen = !this.addOptionsOpen;
            this.paintFooter();
        });
        this.footer.append(add);
        if (this.addOptionsOpen) {
            const options = node('div', 'akari-seg akari-voice-dict-options');
            options.append(button('言い換え', () => { this.draftKind = 'fix'; this.addOptionsOpen = false; this.error = ''; void this.render(); }, 'secondary small'),
                button('定型文', () => { this.draftKind = 'snippet'; this.addOptionsOpen = false; this.error = ''; void this.render(); }, 'secondary small'));
            this.footer.append(options);
        }
        const history = button('聞き取りの履歴から拾う', () => { this.historyOpen = !this.historyOpen; void this.render(); }, 'quiet small');
        const enabled = this.preferences.get<boolean>(HISTORY_KEY, false);
        history.disabled = !enabled || !this.historyRows.length;
        if (history.disabled) history.title = !enabled ? '設定で聞き取りの履歴をオンにしてください' : '拾える履歴はありません';
        this.footer.append(history);
        if (history.disabled) this.footer.append(node('span', 'akari-voice-dict-history-reason',
            !enabled ? '履歴はオフです' : '履歴は空です'));
        const label = node('label', 'akari-voice-dict-check');
        const check = node('input');
        check.type = 'checkbox';
        check.checked = this.preferences.get<boolean>(CORRECTIONS_KEY, true);
        check.onchange = () => {
            document.documentElement.dataset.akariCorrections = String(check.checked);
            void this.preferences.set(CORRECTIONS_KEY, check.checked, PreferenceScope.User);
        };
        label.append(check, node('span', undefined, '直した語を帯に薄く示す'));
        this.footer.append(label);
    }

    protected async remove(id: string): Promise<void> {
        const result = await this.service.remove(id);
        this.notice.textContent = result.ok ? '' : result.errors?.join('、') ?? '削除できません';
        if (result.ok) await this.render();
    }
}
