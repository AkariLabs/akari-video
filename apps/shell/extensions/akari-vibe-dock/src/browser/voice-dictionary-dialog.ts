import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { AkariVoiceDictionaryService, VoiceEntry } from '../common/voice-dictionary-protocol';

const HISTORY_KEY = 'akari.listening.history';
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
};
const button = (label: string, action: () => void, style = 'secondary'): HTMLButtonElement => {
    const result = node('button', label);
    result.type = 'button';
    result.className = `theia-button ${style}`;
    result.onclick = action;
    return result;
};
const field = (label: string, value = ''): { wrapper: HTMLElement; input: HTMLInputElement } => {
    const wrapper = node('label', label);
    const input = node('input');
    input.value = value;
    wrapper.append(input);
    return { wrapper, input };
};
const multiField = (label: string, value = ''): { wrapper: HTMLElement; input: HTMLTextAreaElement } => {
    const wrapper = node('label', label);
    const input = node('textarea');
    input.value = value;
    wrapper.append(input);
    return { wrapper, input };
};

export class VoiceDictionaryDialog extends AbstractDialog<void> {
    protected readonly content = node('div');
    protected readonly notice = node('p');
    get value(): void { return undefined; }
    protected override handleEnter(_event: KeyboardEvent): boolean { return false; }

    constructor(protected readonly service: AkariVoiceDictionaryService, protected readonly preferences: PreferenceService) {
        super({ title: '声の辞書' });
        this.node.dataset.akariVoiceDictionaryDialog = 'true';
        this.contentNode.append(this.notice, this.content);
        this.controlPanel.style.display = 'none';
        this.content.style.cssText = 'max-height:70vh;overflow:auto;min-width:600px';
        void this.render();
    }

    protected async render(): Promise<void> {
        const listed = await this.service.list();
        this.content.replaceChildren();
        this.content.append(node('h3', '同梱の言葉'));
        for (const entry of listed.builtin) {
            const row = node('div');
            row.append(node('span', `${entry.from?.join('・') ?? ''} → ${entry.to ?? ''} 直した回数 ${entry.hits ?? 0} `),
                node('small', listed.overriddenIds.includes(entry.id) ? '上書き中' : 'アプリに入っています'));
            row.append(button('自分の言い方で上書き', () => this.showEditor({ kind: 'fix', from: entry.from, to: entry.to, source: 'manual' })));
            this.content.append(row);
        }
        this.content.append(node('h3', '自分の言葉'));
        this.content.append(button('言い換えを足す', () => this.showEditor({ kind: 'fix', from: [], to: '' }), 'primary'),
            button('定型文を足す', () => this.showEditor({ kind: 'snippet', trigger: [], expand: '', scope: ['task'] })));
        for (const entry of listed.user) {
            const row = node('div', `${entry.kind === 'fix' ? `${entry.from?.join('・')} → ${entry.to}` : `${entry.trigger?.join('・')} → ${entry.expand}`} 直した回数 ${entry.hits ?? 0} `);
            row.append(button('編集', () => this.showEditor(entry)), button('削除', () => { void this.remove(entry.id); }, 'quiet'));
            this.content.append(row);
        }
        this.content.append(node('h3', '聞き取り履歴'));
        const setting = node('label', '聞き取り履歴を残す');
        const toggle = node('input');
        toggle.type = 'checkbox';
        toggle.checked = this.preferences.get<boolean>(HISTORY_KEY, false);
        toggle.onchange = () => { void this.preferences.set(HISTORY_KEY, toggle.checked, PreferenceScope.User).then(() => this.render()); };
        setting.append(toggle);
        this.content.append(setting, node('p', '話した言葉を、この PC の中だけに最大 200 件・7 日まで残します。送信はしません。辞書に足す語を探すためだけに使います'));
        this.content.append(button('履歴を消す', () => { void this.service.clearHistory().then(() => this.render()); }, 'quiet'));
        if (!toggle.checked) { this.content.append(node('p', '履歴はオフです')); return; }
        for (const item of await this.service.history()) {
            const row = node('div');
            const text = node('textarea');
            text.value = item.raw;
            text.readOnly = true;
            text.setAttribute('aria-label', '履歴の言葉を選ぶ');
            row.append(text, node('p', `辞書を当てた形: ${item.text}`), button('言い換えを足す', () => {
                const selected = text.value.slice(text.selectionStart, text.selectionEnd);
                if (!selected) { this.notice.textContent = '足したい言葉を選んでください'; return; }
                this.showEditor({ kind: 'fix', from: [selected], to: '', source: 'history' }, async id => {
                    const count = await this.service.countHistoryMatches(id);
                    this.notice.textContent = `保存後に同じ履歴へ当て直した件数: ${count} 件`;
                });
            }));
            this.content.append(row);
        }
    }

    protected showEditor(entry: Partial<VoiceEntry>, afterSave?: (id: string) => Promise<void>): void {
        this.content.replaceChildren();
        this.content.append(node('h3', entry.id ? '項目を編集' : '項目を追加'));
        const kind = entry.kind ?? 'fix';
        const phrases = multiField(kind === 'fix' ? '聞こえた形（改行で複数）' : '合言葉（改行で複数）', (kind === 'fix' ? entry.from : entry.trigger)?.join('\n'));
        this.content.append(phrases.wrapper);
        const destination = kind === 'fix' ? field('直した形', entry.to) : multiField('本文', entry.expand);
        this.content.append(destination.wrapper);
        const scopeChoices = (['note', 'task', 'partner'] as const).map((value, index) => {
            const label = node('label', ['メモ', 'タスク', 'パートナー'][index]);
            const input = node('input');
            input.type = 'checkbox';
            input.checked = (entry.scope ?? ['task']).includes(value);
            label.append(input);
            return { value, label, input };
        });
        if (kind === 'snippet') this.content.append(node('p', '行き先'), ...scopeChoices.map(choice => choice.label), node('p', '渡すときはこの全文が送られます'));
        const warning = node('p');
        if (kind === 'snippet') {
            destination.input.oninput = () => { warning.textContent = /sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|[A-Za-z0-9]{40,}/u.test(destination.input.value) ? '鍵らしき文字列が含まれています' : ''; };
            this.content.append(warning);
        }
        this.content.append(button('保存', () => {
            const values = phrases.input.value.split('\n').map(value => value.trim()).filter(Boolean);
            const next: Partial<VoiceEntry> = kind === 'fix'
                ? { ...entry, kind, from: values, to: destination.input.value.trim(), source: entry.source ?? 'manual' }
                : { ...entry, kind, trigger: values, expand: destination.input.value,
                    scope: scopeChoices.filter(choice => choice.input.checked).map(choice => choice.value), source: entry.source ?? 'manual' };
            void this.service.upsert(next).then(async result => {
                if (!result.ok) { this.notice.textContent = result.errors?.join('、') ?? '保存できません'; return; }
                this.notice.textContent = result.warnings?.join('、') ?? '';
                await this.render();
                if (result.entry) await afterSave?.(result.entry.id);
            });
        }, 'primary'), button('戻る', () => { void this.render(); }, 'quiet'));
    }

    protected async remove(id: string): Promise<void> {
        const result = await this.service.remove(id);
        this.notice.textContent = result.ok ? '' : result.errors?.join('、') ?? '削除できません';
        if (result.ok) await this.render();
    }
}
