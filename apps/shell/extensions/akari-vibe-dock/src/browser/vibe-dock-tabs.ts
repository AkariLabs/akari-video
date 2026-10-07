import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ContributionProvider, Disposable, Emitter, Event } from '@theia/core/lib/common';
import { CommandService } from '@theia/core/lib/common/command';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';
import { VibeDockState } from '../common/vibe-dock-state';
import { AkariEarFrontend } from '../common/ear-frontend';
import type { EarStatus } from '../common/ear-protocol';
import { EAR_ENGINE_LABELS, EarCapabilities, effectiveVibeMode, readEngine, readVibeMode, resolveEarEngine, VIBE_MODE_LABELS } from '../common/vibe-mode';
import { lastKnownListeningMic, rememberListeningMic } from './listening-preferences';
import { AkariVoiceDictionaryService } from '../common/voice-dictionary-protocol';

export const VibeDockTabContributionSymbol = Symbol('VibeDockTabContribution');

@injectable()
export class NowVibeDockTab implements VibeDockTabContribution {
    readonly id = 'now';
    readonly label = 'いま';
    readonly icon = 'now';
    readonly order = 0;
    @inject(VibeDockState) protected readonly state!: VibeDockState;
    protected taskNotice?: Disposable;
    protected readonly entries: Array<{ text: string; at: string; kind: string; target?: string }> = [];
    /** 作成が実際に成功した後だけ、全タブ共通の状況行へ知らせる。 */
    showTaskCreated(): void {
        this.taskNotice?.dispose();
        const notice = this.state.status.set('タスクにしました。', 'info');
        this.taskNotice = notice;
        setTimeout(() => { if (this.taskNotice === notice) this.taskNotice = undefined; notice.dispose(); }, 4000);
    }
    render(host: HTMLElement, _ctx: VibeDockContext): Disposable {
        host.replaceChildren();
        const root = document.createElement('div');
        root.className = 'akari-vibe-now';
        const stream = document.createElement('div');
        stream.className = 'akari-vibe-now-stream';
        const paint = (): void => {
            stream.replaceChildren();
            if (!this.entries.length) {
                const empty = document.createElement('div');
                empty.className = 'akari-vibe-utt akari-vibe-empty';
                empty.textContent = '（明かりをつけると、ここに話したことが流れます）';
                stream.append(empty);
            }
            for (const entry of this.entries) {
                const card = document.createElement('div');
                card.className = 'akari-vibe-utt';
                const text = document.createElement('span');
                text.textContent = entry.text;
                const meta = document.createElement('span');
                meta.className = 'akari-vibe-utt-meta';
                if (entry.target) {
                    const target = document.createElement('span');
                    target.className = 'akari-vibe-target';
                    target.textContent = entry.target;
                    meta.append(target);
                }
                const time = document.createElement('span');
                time.textContent = entry.at;
                const kind = document.createElement('span');
                kind.textContent = entry.kind;
                meta.append(time, kind);
                card.append(text, meta);
                stream.append(card);
            }
        };
        paint();
        const typein = document.createElement('div');
        typein.className = 'akari-vibe-typein';
        const input = document.createElement('input');
        input.className = 'theia-input';
        input.placeholder = '打ってもいい。Enter でタスクにする';
        input.setAttribute('aria-label', 'タスクの内容');
        const submit = (mode: 'task' | 'send'): void => {
            if (!input.value.trim()) return;
            const text = input.value;
            const target = this.state.pointedTarget?.target;
            this.state.submitInstruction(text, mode);
            this.entries.push({ text, at: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
                kind: mode === 'task' ? 'タスク' : 'すぐ', target });
            paint();
            input.value = '';
        };
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) submit('task');
        });
        const task = document.createElement('button');
        task.className = 'theia-button secondary small';
        task.textContent = 'タスク';
        task.title = 'タスクにする';
        task.setAttribute('aria-label', 'タスクにする');
        task.addEventListener('click', () => submit('task'));
        const send = document.createElement('button');
        send.className = 'theia-button quiet small';
        send.textContent = 'すぐ';
        send.title = 'すぐ頼む';
        send.setAttribute('aria-label', 'すぐ頼む');
        send.addEventListener('click', () => submit('send'));
        typein.append(input, task, send);
        root.append(stream, typein);
        host.append(root);
        return Disposable.create(() => host.replaceChildren());
    }
}

@injectable()
export class SettingsVibeDockTab implements VibeDockTabContribution {
    readonly id = 'settings';
    readonly label = '設定';
    readonly icon = 'settings';
    readonly order = 100;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(AkariEarFrontend) protected readonly ear!: AkariEarFrontend;
    @inject(AkariVoiceDictionaryService) protected readonly dictionary!: AkariVoiceDictionaryService;
    render(host: HTMLElement, _ctx: VibeDockContext): Disposable {
        host.replaceChildren();
        let disposed = false;
        let capabilities: EarCapabilities = { engines: [] };
        let mic: EarStatus['mic'] = lastKnownListeningMic;
        const summary = document.createElement('div');
        summary.setAttribute('aria-label', '設定の要約');
        host.append(summary);
        let dictionaryCount: number | undefined;
        const row = (label: string, value: string, command: string): HTMLElement => {
            const button = document.createElement('button');
            button.className = 'akari-vibe-nav';
            button.title = label;
            button.setAttribute('aria-label', label);
            const name = document.createElement('span');
            name.textContent = label;
            const suffix = document.createElement('small');
            suffix.textContent = value;
            button.append(name, suffix);
            button.addEventListener('click', () => void this.commands.executeCommand(command, ...(command === 'akari.settings.open' ? [{ section: 'listening' }] : [])));
            return button;
        };
        const paint = (): void => {
            const engine = resolveEarEngine(this.preferences, capabilities);
            const engineLabel = readEngine(this.preferences) === 'auto' && !engine ? EAR_ENGINE_LABELS.auto
                : engine ? EAR_ENGINE_LABELS[engine] : EAR_ENGINE_LABELS[readEngine(this.preferences)];
            const mode = effectiveVibeMode({
                mode: readVibeMode(this.preferences),
                companionEnabled: this.preferences.inspect<boolean>('akari.companion.enabled')?.globalValue !== false,
                liveAvailable: capabilities.engines.some(value => value.id === 'speechanalyzer-live' && value.available)
            });
            summary.replaceChildren(
                row(`聞き取り: ${engineLabel}`, '›', 'akari.settings.open'),
                row('Jev で画面を動かす', VIBE_MODE_LABELS[mode.mode], 'akari.settings.open'),
                row('辞書', dictionaryCount === undefined ? '…' : String(dictionaryCount), 'akari.voiceDictionary.open')
            );
            summary.title = `マイク: ${mic === 'ok' ? '許可あり' : mic === 'denied' ? '許可なし' : '未確認'}`;
        };
        paint();
        const statusSubscription = this.ear.onStatus(status => {
            if (status.mic === 'ok' || status.mic === 'denied') {
                mic = status.mic; rememberListeningMic(mic); if (!disposed) paint();
            }
        });
        const preferenceSubscription = this.preferences.onPreferenceChanged(change => {
            if (['akari.listening.engine', 'akari.vibe.mode', 'akari.companion.enabled'].includes(change.preferenceName) && !disposed) { paint(); }
        });
        void this.ear.capabilities().then(value => { if (!disposed) { capabilities = value; paint(); } });
        void this.dictionary.list().then(value => { if (!disposed) { dictionaryCount = value.user.length; paint(); } }).catch(() => undefined);
        return Disposable.create(() => {
            disposed = true;
            statusSubscription.dispose();
            preferenceSubscription.dispose();
            host.replaceChildren();
        });
    }
}

export function selectVibeDockTabs(contributions: readonly VibeDockTabContribution[]): VibeDockTabContribution[] {
    return contributions.filter(tab => tab.isAvailable?.() !== false).sort((a, b) => a.order - b.order);
}

@injectable()
export class VibeDockTabs {
    @inject(ContributionProvider) @named(VibeDockTabContributionSymbol)
    protected readonly provider!: ContributionProvider<VibeDockTabContribution>;
    protected readonly changeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changeEmitter.event;
    protected badges = '';
    list(): VibeDockTabContribution[] { return selectVibeDockTabs(this.provider.getContributions()); }
    refreshBadges(): void {
        const badges = JSON.stringify(this.list().map(tab => [tab.id, tab.badge?.()]));
        if (badges !== this.badges) {
            this.badges = badges;
            this.changeEmitter.fire();
        }
    }
}
