import { t } from './vibe-text';
import { formatDate } from '@akari-video/i18n';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ContributionProvider, Disposable, Emitter, Event, MessageService } from '@theia/core/lib/common';
import { CommandService } from '@theia/core/lib/common/command';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { VibeDockContext, VibeDockTabContribution } from '../common/vibe-dock-tab';
import { VibeDockState } from '../common/vibe-dock-state';
import { AkariEarFrontend } from '../common/ear-frontend';
import type { EarStatus, EarUtterance } from '../common/ear-protocol';
import { EAR_ENGINE_LABELS, EarCapabilities, effectiveVibeMode, readEngine, readVibeMode, resolveEarEngine, VIBE_MODE_LABELS } from '../common/vibe-mode';
import { lastKnownListeningMic, rememberListeningMic } from './listening-preferences';
import { AkariVoiceDictionaryService } from '../common/voice-dictionary-protocol';
import { AkariAnnotationsService } from 'akari-annotations/lib/common/akari-annotations-protocol';
import { ReviewModel } from 'akari-annotations/lib/browser/review-model';
import { renderCorrectedText } from './corrected-text';

export const VibeDockTabContributionSymbol = Symbol('VibeDockTabContribution');

@injectable()
export class NowVibeDockTab implements VibeDockTabContribution {
    readonly id = 'now';
    readonly label = t('vibe.dock.tabs.nowLabel');
    readonly icon = 'now';
    readonly order = 0;
    @inject(VibeDockState) protected readonly state!: VibeDockState;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(AkariVoiceDictionaryService) protected readonly dictionary!: AkariVoiceDictionaryService;
    @inject(AkariAnnotationsService) protected readonly annotations!: AkariAnnotationsService;
    @inject(ReviewModel) protected readonly review!: ReviewModel;
    protected taskNotice?: Disposable;
    protected readonly entries: Array<{ text: string; at: string; kind: string; target?: string;
        utterance?: Pick<EarUtterance, 'raw' | 'text' | 'applied'>; taskState?: 'pending' | 'saving' | 'done';
        saveState?: 'no-project' | 'failed'; entryId?: string; undone?: boolean; undo?: () => void; subdued?: boolean }> = [];
    protected partial = '';
    protected paintView: (() => void) | undefined;

    acceptUtterance(utterance: EarUtterance, sourceT: number, subdued = false): void {
        if (!utterance.final) {
            this.partial = utterance.text;
            this.paintView?.();
            return;
        }
        this.partial = '';
        if (!utterance.text.trim()) { this.paintView?.(); return; }
        const pointed = this.state.consumePointed();
        const entry = { text: utterance.text, at: formatDate(new Date(), { kind: 'time', options: { hour: '2-digit', minute: '2-digit' } }),
            kind: t('vibe.dock.tabs.noteLabel'), target: pointed?.target, utterance: {
                raw: utterance.raw, text: utterance.text, applied: [...utterance.applied]
            }, taskState: 'pending' as const, saveState: undefined as 'no-project' | 'failed' | undefined, subdued };
        this.entries.push(entry);
        if (this.entries.length > 200) this.entries.splice(0, this.entries.length - 200);
        this.paintView?.();
        const location = this.review.location;
        if (!location) { entry.saveState = 'no-project'; this.paintView?.(); return; }
        void this.annotations.createAnnotation({
            reviewUri: location.reviewUri.toString(), projectRootUri: location.root.toString(),
            src: null, sourceT, sourceRange: null, timelineT: null,
            target: pointed ? `ui:${pointed.target}` : null, intent: 'voice', text: utterance.text
        }).then(result => {
            if (!result.committed) entry.saveState = 'failed';
            this.paintView?.();
        }).catch(() => { entry.saveState = 'failed'; this.paintView?.(); });
    }

    clearPartial(): void { this.partial = ''; this.paintView?.(); }
    acceptAction(label: string, kind: '操作' | 'タスク', entryId: string, undo?: () => void): void {
        this.partial = '';
        this.entries.push({ text: label, at: formatDate(new Date(), { kind: 'time', options: { hour: '2-digit', minute: '2-digit' } }),
            kind: kind === '操作' ? t('vibe.dock.tabs.actionLabel') : t('vibe.dock.tabs.taskLabel'), entryId, undo });
        if (this.entries.length > 200) this.entries.splice(0, this.entries.length - 200);
        this.paintView?.();
    }
    markActionUndone(entryId: string): void {
        const entry = this.entries.find(item => item.entryId === entryId);
        if (entry) { entry.undone = true; this.paintView?.(); }
    }
    markActionRedone(entryId: string): void {
        const entry = this.entries.find(item => item.entryId === entryId);
        if (entry) { entry.undone = false; this.paintView?.(); }
    }
    /** 作成が実際に成功した後だけ、全タブ共通の状況行へ知らせる。 */
    showTaskCreated(): void {
        this.taskNotice?.dispose();
        const notice = this.state.status.set(t('vibe.dock.tabs.createdTaskMessage'), 'info');
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
            if (!this.entries.length && !this.partial) {
                const empty = document.createElement('div');
                empty.className = 'akari-vibe-utt akari-vibe-empty';
                empty.textContent = t('vibe.dock.tabs.turnLightSeeWhatSayHereText');
                stream.append(empty);
            }
            for (const entry of this.entries) {
                const card = document.createElement('div');
                card.className = 'akari-vibe-utt';
                if (entry.subdued) card.style.opacity = '0.65';
                if (entry.undone) card.className += ' akari-vibe-utt-undone';
                const text = document.createElement('span');
                if (entry.undone) text.style.textDecoration = 'line-through';
                if (entry.utterance) renderCorrectedText(text, entry.utterance, {
                    onRevert: id => { void this.dictionary.revert(id); },
                    onOpen: id => { void this.commands.executeCommand('akari.voiceDictionary.open', { entryId: id }); }
                });
                else text.textContent = entry.text;
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
                if (entry.utterance) {
                    const content = document.createElement('div');
                    content.className = 'akari-vibe-utt-content';
                    content.append(text);
                    const action = document.createElement('button');
                    action.className = 'theia-button quiet small';
                    action.type = 'button';
                    action.textContent = entry.taskState === 'done' ? t('vibe.dock.tabs.taskCreatedText') : t('vibe.dock.tabs.createTaskText');
                    action.disabled = entry.taskState !== 'pending';
                    action.addEventListener('click', () => {
                        if (entry.taskState !== 'pending') return;
                        entry.taskState = 'saving'; paint();
                        void this.commands.executeCommand<{ id: string }>('akari.tasks.create', {
                            text: entry.utterance!.text, via: 'voice', ...(entry.target ? { target: `ui:${entry.target}` } : {})
                        }).then(created => {
                            if (!created?.id) throw new Error(t('vibe.dock.tabs.couldNotCreateTaskError'));
                            entry.taskState = 'done';
                            this.showTaskCreated();
                            this.paintView?.();
                        }).catch(error => {
                            entry.taskState = 'pending';
                            this.messages.error(t('vibe.dock.tabs.couldNotCreateTaskWithDetailError', { value1: String(error) }));
                            this.paintView?.();
                        });
                    });
                    content.append(action);
                    card.append(content, meta);
                    if (entry.saveState) {
                        const note = document.createElement('small');
                        note.className = 'akari-vibe-save-note';
                        note.textContent = entry.saveState === 'no-project' ? t('vibe.dock.tabs.openProjectSaveText') : t('vibe.dock.tabs.couldNotSaveError');
                        card.append(note);
                    }
                } else {
                    card.append(text, meta);
                    if (entry.undo && !entry.undone) {
                        const undo = document.createElement('button');
                        undo.className = 'theia-button quiet small';
                        undo.type = 'button';
                        undo.textContent = t('vibe.dock.tabs.undoText');
                        undo.addEventListener('click', () => entry.undo?.());
                        card.append(undo);
                    }
                }
                stream.append(card);
            }
            if (this.partial) {
                const live = document.createElement('div');
                live.className = 'akari-vibe-utt akari-vibe-live';
                live.textContent = this.partial;
                stream.append(live);
            }
        };
        this.paintView = paint;
        paint();
        const typein = document.createElement('div');
        typein.className = 'akari-vibe-typein';
        const input = document.createElement('input');
        input.className = 'theia-input';
        input.placeholder = t('vibe.dock.tabs.canTypeTooPressEnterCreateTaskPlaceholder');
        input.setAttribute('aria-label', t('vibe.dock.tabs.taskContentAriaLabel'));
        const submit = (mode: 'task' | 'send'): void => {
            if (!input.value.trim()) return;
            const text = input.value;
            const target = this.state.pointedTarget?.target;
            this.state.submitInstruction(text, mode);
            this.entries.push({ text, at: formatDate(new Date(), { kind: 'time', options: { hour: '2-digit', minute: '2-digit' } }),
                kind: mode === 'task' ? t('vibe.dock.tabs.taskLabel') : t('vibe.dock.tabs.immediatelyLabel'), target });
            if (this.entries.length > 200) this.entries.splice(0, this.entries.length - 200);
            paint();
            input.value = '';
        };
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.isComposing) submit('task');
        });
        const task = document.createElement('button');
        task.className = 'theia-button secondary small';
        task.textContent = t('vibe.dock.tabs.taskText');
        task.title = t('vibe.dock.tabs.createTaskTooltip');
        task.setAttribute('aria-label', t('vibe.dock.tabs.createTaskAriaLabel'));
        task.addEventListener('click', () => submit('task'));
        const send = document.createElement('button');
        send.className = 'theia-button quiet small';
        send.textContent = t('vibe.dock.tabs.immediatelyText');
        send.title = t('vibe.dock.tabs.askNowTooltip');
        send.setAttribute('aria-label', t('vibe.dock.tabs.askNowAriaLabel'));
        send.addEventListener('click', () => submit('send'));
        typein.append(input, task, send);
        root.append(stream, typein);
        host.append(root);
        return Disposable.create(() => { if (this.paintView === paint) this.paintView = undefined; host.replaceChildren(); });
    }
}

@injectable()
export class SettingsVibeDockTab implements VibeDockTabContribution {
    readonly id = 'settings';
    readonly label = t('vibe.dock.tabs.settingsLabel');
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
        summary.setAttribute('aria-label', t('vibe.dock.tabs.settingsSummaryAriaLabel'));
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
                row(t('vibe.dock.tabs.listeningWithValueLabel', { value1: engineLabel }), '›', 'akari.settings.open'),
                row(t('vibe.dock.tabs.controlScreenJevLabel'), VIBE_MODE_LABELS[mode.mode], 'akari.settings.open'),
                row(t('vibe.dock.tabs.dictionaryLabel'), dictionaryCount === undefined ? '…' : String(dictionaryCount), 'akari.voiceDictionary.open')
            );
            summary.title = t('vibe.dock.tabs.microphoneWithValueTooltip', { value1: mic === 'ok' ? t('vibe.dock.tabs.microphoneAllowed') : mic === 'denied' ? t('vibe.dock.tabs.microphoneDenied') : t('vibe.dock.tabs.microphoneUnchecked') });
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
