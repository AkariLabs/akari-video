import { t } from './vibe-text';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CommandRegistry, CommandService, Disposable, DisposableCollection } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import type { SettingsSectionBodyContribution } from 'akari-surfaces/lib/common/settings-section-body';
import { el, groupCard, segmentedControl, settingRow, settingsNote, statusPill, switchControl } from 'akari-surfaces/lib/browser/settings/settings-ui';
import { AkariEarFrontend } from '../common/ear-frontend';
import type { EarEngineId, EarStatus, EarUtterance } from '../common/ear-protocol';
import { AkariVoiceDictionaryService } from '../common/voice-dictionary-protocol';
import { buildCorrectedSegments } from '../common/corrected-text-model';
import {
    EAR_ENGINE_LABELS, EarCapabilities, effectiveVibeMode, LISTENING_ENGINE_KEY,
    readEngine, readVibeMode, resolveEarEngine, VIBE_MODE_DESCRIPTIONS, VIBE_MODE_KEY,
    VIBE_MODE_LABELS, VibeMode
} from '../common/vibe-mode';
import { EarSession } from './ear-session';
import { ensureCorrectedTextStyles } from './corrected-text';
import { lastKnownListeningMic, rememberListeningMic } from './listening-preferences';

const DISCLOSURE = t('vibe.listening.settings.cloudSpeechDataDisclosure');
const HISTORY_KEY = 'akari.listening.history';
const TRIAL_HINT = t('vibe.listening.settings.testListeningInstruction');

function ensureStyles(): void {
    if (document.getElementById('akari-listening-settings-style')) return;
    const style = el('style');
    style.id = 'akari-listening-settings-style';
    style.textContent = `
[data-akari-settings-dialog] .akari-listening-lead { margin: 0; padding: 8px 16px 2px; color: var(--akari-muted); font-size: 12px; line-height: 1.55; }
[data-akari-settings-dialog] .akari-listening-engines { display: grid; gap: 8px; padding: 12px 16px; }
[data-akari-settings-dialog] button.akari-listening-engine { all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px 12px; border-radius: 9px; border: 1px solid var(--akari-line); background: var(--akari-bg); }
[data-akari-settings-dialog] button.akari-listening-engine:hover:not(:disabled), [data-akari-settings-dialog] button.akari-listening-engine[aria-checked="true"] { border-color: var(--akari-accent); }
[data-akari-settings-dialog] button.akari-listening-engine:disabled { opacity: .55; cursor: default; }
[data-akari-settings-dialog] button.akari-listening-engine:focus-visible { outline: 1px solid var(--akari-accent-light); }
[data-akari-settings-dialog] .akari-listening-radio { width: 15px; height: 15px; border: 1px solid var(--akari-muted); border-radius: 50%; box-sizing: border-box; }
[data-akari-settings-dialog] [aria-checked="true"] .akari-listening-radio { border: 4px solid var(--akari-accent); }
[data-akari-settings-dialog] .akari-listening-engine-name { display: block; color: var(--akari-ink); font-size: 13px; font-weight: 600; }
[data-akari-settings-dialog] .akari-listening-engine-detail { display: block; color: var(--akari-faint); font-size: 11px; line-height: 1.5; }
[data-akari-settings-dialog] .akari-listening-trial { display: grid; gap: 10px; margin: 2px 16px 16px; padding: 12px; border-radius: 10px; background: var(--akari-card); }
[data-akari-settings-dialog] .akari-listening-trial-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
[data-akari-settings-dialog] .akari-listening-mark { width: 8px; height: 8px; border-radius: 50%; background: var(--akari-faint); }
[data-akari-settings-dialog] .akari-listening-mark[data-on="true"] { background: var(--akari-accent); box-shadow: 0 0 6px var(--akari-accent); }
[data-akari-settings-dialog] .akari-listening-trial-state, [data-akari-settings-dialog] .akari-listening-mic { font-size: 12px; color: var(--akari-muted); }
[data-akari-settings-dialog] .akari-listening-mic { margin-inline-start: auto; }
[data-akari-settings-dialog] .akari-listening-meter { height: 6px; overflow: hidden; border-radius: 999px; background: var(--akari-elevated); }
[data-akari-settings-dialog] .akari-listening-meter-fill { width: 100%; height: 100%; background: var(--akari-accent); transform: scaleX(0); transform-origin: left; transition: transform .12s; }
[data-akari-settings-dialog] .akari-listening-output { min-height: 56px; padding: 10px 12px; border: 1px solid var(--akari-line-inner); border-radius: 8px; background: var(--akari-bg); color: var(--akari-muted); font-size: 13px; line-height: 1.6; }
[data-akari-settings-dialog] .akari-listening-trial-foot { margin: 0; color: var(--akari-faint); font-size: 11px; }
[data-akari-settings-dialog] .akari-listening-mode-note { margin-top: 0; }
`;
    document.head.append(style);
}

function button(label: string, click: () => void): HTMLButtonElement {
    const control = el('button', 'akari-set-btn akari-set-btn-ghost akari-set-btn-sm', label);
    control.type = 'button';
    control.addEventListener('click', click);
    return control;
}

export function needsVibeModeConfirmation(previous: VibeMode, next: VibeMode): boolean {
    return previous === 'off' && next !== 'off';
}

@injectable()
export class ListeningSettingsSection implements SettingsSectionBodyContribution {
    readonly sectionId = 'listening';
    @inject(PreferenceService) protected readonly preferences!: PreferenceService;
    @inject(AkariEarFrontend) protected readonly ear!: AkariEarFrontend;
    @inject(EarSession) protected readonly session!: EarSession;
    @inject(AkariVoiceDictionaryService) protected readonly dictionary!: AkariVoiceDictionaryService;
    @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(WindowService) protected readonly windows!: WindowService;

    render(host: HTMLElement): Disposable {
        ensureStyles();
        ensureCorrectedTextStyles();
        const disposables = new DisposableCollection();
        let disposed = false;
        let running = false;
        let stopping = false;
        const session = this.session ?? new EarSession(this.ear, this.preferences);
        let currentEngine: EarEngineId | undefined;
        let voiceAt: number | undefined;
        let latency: string | undefined;
        let mic: EarStatus['mic'] = lastKnownListeningMic;
        let micName = '';
        let capabilities: EarCapabilities = { engines: [] };
        const root = el('div', 'akari-set-listening');
        const listeningCard = el('div');
        const modeCard = el('div');
        const dictionaryCard = el('div');
        const engines = el('div', 'akari-listening-engines');
        const trial = el('div', 'akari-listening-trial');
        const trialHead = el('div', 'akari-listening-trial-head');
        const mark = el('span', 'akari-listening-mark');
        mark.setAttribute('aria-hidden', 'true');
        const trialStatus = el('span', 'akari-listening-trial-state', t('vibe.listening.settings.idleLabel'));
        trialStatus.setAttribute('role', 'status');
        const micLabel = el('span', 'akari-listening-mic');
        const levelTrack = el('div', 'akari-listening-meter');
        const levelFill = el('div', 'akari-listening-meter-fill');
        levelTrack.append(levelFill);
        const output = el('div', 'akari-listening-output', TRIAL_HINT);
        output.setAttribute('aria-live', 'polite');
        const foot = el('p', 'akari-listening-trial-foot', t('vibe.listening.settings.nothingSavedMessage'));
        root.append(listeningCard, modeCard, dictionaryCard);
        host.append(root);

        const paintMic = (): void => {
            micLabel.textContent = mic === 'denied' ? t('vibe.listening.settings.microphonePermissionDeniedText')
                : mic === 'unsupported' ? t('vibe.listening.settings.microphoneUnavailableEnvironmentLabel')
                    : micName ? t('vibe.listening.settings.microphoneWithValueLabel', { value1: micName }) : t('vibe.listening.settings.microphoneNotCheckedNameAppearsAfterPermissionGrantedLabel');
        };
        const findMic = async (): Promise<void> => {
            try {
                const devices = await navigator.mediaDevices?.enumerateDevices();
                if (disposed) return;
                micName = devices?.find(device => device.kind === 'audioinput' && !!device.label)?.label ?? '';
                paintMic();
            } catch { if (!disposed) paintMic(); }
        };
        const paintUtterance = (utterance: EarUtterance): void => {
            output.replaceChildren();
            for (const segment of buildCorrectedSegments(utterance.text, utterance.applied)) {
                if (!segment.applied) { output.append(document.createTextNode(segment.text)); continue; }
                const word = el('span', 'akari-corrected-word', segment.text);
                word.title = t('vibe.listening.settings.asHeardWithOriginalTooltip', { value1: segment.applied.from });
                output.append(word);
            }
        };
        const stopTrial = async (): Promise<void> => {
            if (stopping || !running) return;
            stopping = true;
            trialStatus.textContent = currentEngine === 'record-then-transcribe' ? t('vibe.listening.settings.ongoingTranscribingText') : t('vibe.listening.settings.ongoingStoppingText');
            try {
                await session.stop();
                if (!disposed) trialStatus.textContent = t('vibe.listening.settings.idleText');
            } catch { if (!disposed) trialStatus.textContent = t('vibe.listening.settings.couldNotStopTestListeningError'); }
            running = false;
            stopping = false;
            if (!disposed) paintTrialButton();
        };
        const trialButton = button(t('vibe.listening.settings.testListeningAction'), () => { if (!stopping) void (running ? stopTrial() : startTrial()); });
        const paintTrialButton = (): void => {
            trialButton.textContent = running ? t('vibe.listening.settings.stopText') : t('vibe.listening.settings.testListeningText');
            trialButton.disabled = stopping;
            mark.dataset.on = String(running);
            if (!running) levelFill.style.transform = 'scaleX(0)';
        };
        const startTrial = async (): Promise<void> => {
            if (running || disposed) return;
            if (session.state.state === 'listening' && session.state.purpose !== 'trial') {
                trialStatus.textContent = t('vibe.listening.settings.listeningPanelText');
                return;
            }
            currentEngine = resolveEarEngine(this.preferences, capabilities);
            if (!currentEngine) { trialStatus.textContent = t('vibe.listening.settings.noListeningEngineAvailableText'); return; }
            running = true;
            voiceAt = undefined;
            latency = undefined;
            output.textContent = t('vibe.listening.settings.ongoingListeningText');
            trialStatus.textContent = currentEngine === 'record-then-transcribe' ? t('vibe.listening.settings.transcriptionStartsAfterStopText') : t('vibe.listening.settings.listeningText');
            paintTrialButton();
            try {
                const status = await session.start({ purpose: 'trial', engine: currentEngine });
                if (status.mic === 'ok' || status.mic === 'denied') {
                    mic = status.mic; rememberListeningMic(mic); void findMic();
                }
                if (status.state === 'error') throw new Error(status.message ?? t('vibe.listening.settings.couldNotStartListeningError'));
                if (disposed) { await session.stop(); return; }
            } catch (error) {
                if (error instanceof DOMException && error.name === 'NotAllowedError') {
                    mic = 'denied'; micName = ''; rememberListeningMic(mic); paintMic();
                }
                const message = error instanceof Error ? error.message : t('vibe.listening.settings.couldNotStartTestListeningError');
                await stopTrial();
                trialStatus.textContent = message;
            }
        };
        trialHead.append(trialButton, mark, trialStatus, micLabel);
        trial.append(trialHead, levelTrack, output, foot);
        listeningCard.replaceChildren(groupCard(t('vibe.listening.settings.speechRecognitionLabel'),
            el('p', 'akari-listening-lead', t('vibe.listening.settings.earsUsedByAnnotationsAkariVibeDeviceEnginesPreferredMessage')), engines, trial));

        const paintEngine = (): void => {
            engines.replaceChildren();
            const selected = readEngine(this.preferences);
            const selectedEngine = selected === 'auto' ? resolveEarEngine(this.preferences, capabilities) : selected;
            const definitions = [
                { id: 'auto', label: t('vibe.listening.settings.recognizeMacSpeechAnalyzerDescription'), detail: t('vibe.listening.settings.freeDeviceMacos26LaterJapaneseDescription'), badge: t('vibe.listening.settings.availableDescription'), engine: 'speechanalyzer-live' },
                { id: 'record-then-transcribe', label: t('vibe.listening.settings.recordTranscribeLaterWhisperDescription'), detail: t('vibe.listening.settings.freeDeviceSlowerOlderOsVersionsWindowsDescription'), badge: t('vibe.listening.settings.fallbackDescription'), engine: 'record-then-transcribe' },
                { id: 'cloud', label: t('vibe.listening.settings.cloudApiKeyRequiredDescription'), detail: t('vibe.listening.settings.paidOnlyApprovalDescription'), badge: t('vibe.listening.settings.notConfiguredDescription'), engine: undefined }
            ] as const;
            const cards: HTMLButtonElement[] = [];
            for (const choice of definitions) {
                const capability = capabilities.engines.find(engine => engine.id === choice.engine);
                const reason = choice.id === 'cloud' ? t('vibe.listening.settings.cloudListeningCannotConfiguredYetMessage')
                    : capability?.available ? '' : capability?.reason ?? t('vibe.listening.settings.unavailableEnvironmentLabel');
                const card = el('button', 'akari-listening-engine');
                card.type = 'button';
                card.setAttribute('role', 'radio');
                card.setAttribute('aria-checked', String(choice.id === 'auto'
                    ? selectedEngine === 'speechanalyzer-live' || selectedEngine === undefined : selectedEngine === choice.id));
                card.disabled = !!reason;
                if (reason) card.title = reason;
                const text = el('span');
                text.append(el('span', 'akari-listening-engine-name', choice.label),
                    el('span', 'akari-listening-engine-detail', reason ? `${choice.detail} · ${reason}` : choice.detail));
                card.append(el('span', 'akari-listening-radio'), text,
                    statusPill(reason && choice.id !== 'cloud' ? t('vibe.listening.settings.unavailableLabel') : choice.badge,
                        reason ? 'neutral' : choice.id === 'auto' ? 'ok' : 'neutral'));
                card.addEventListener('click', () => {
                    void this.preferences.set(LISTENING_ENGINE_KEY, choice.id, PreferenceScope.User);
                });
                card.addEventListener('keydown', event => {
                    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                    event.preventDefault();
                    const enabled = cards.filter(item => !item.disabled);
                    const next = enabled[(enabled.indexOf(card) + (event.key === 'ArrowDown' ? 1 : enabled.length - 1)) % enabled.length];
                    next?.focus(); next?.click();
                });
                engines.append(card); cards.push(card);
            }
            engines.setAttribute('role', 'radiogroup');
            engines.setAttribute('aria-label', t('vibe.listening.settings.listeningMethodAriaLabel'));
        };
        const paintMode = (): void => {
            const stored = readVibeMode(this.preferences);
            const companionEnabled = this.preferences.inspect<boolean>('akari.companion.enabled')?.globalValue !== false;
            const liveAvailable = capabilities.engines.some(engine => engine.id === 'speechanalyzer-live' && engine.available);
            const effective = effectiveVibeMode({ mode: stored, companionEnabled, liveAvailable });
            const choices = (['off', 'screen', 'full'] as const).map(value => ({
                value, label: VIBE_MODE_LABELS[value], title: effective.reason ?? VIBE_MODE_DESCRIPTIONS[value], disabled: effective.locked
            }));
            const segment = segmentedControl({ label: t('vibe.listening.settings.voiceControlsLabel'), options: choices, value: effective.mode,
                onChange: value => { void this.selectMode(stored, value).then(() => { if (!disposed) paintMode(); }); }
            });
            const note = settingsNote(effective.reason ?? VIBE_MODE_DESCRIPTIONS[effective.mode]);
            note.classList.add('akari-listening-mode-note');
            modeCard.replaceChildren(groupCard(t('vibe.listening.settings.whereSpokenWordsGoLabel'), settingRow(t('vibe.listening.settings.voiceControlsLabel'), undefined, segment), note));
        };
        const paintDictionary = (): void => {
            const open = button(t('vibe.listening.settings.openDictionaryAction'), () => { void this.commands.executeCommand('akari.voiceDictionary.open'); });
            const available = !!this.commandRegistry.getCommand('akari.voiceDictionary.open');
            open.disabled = !available;
            if (!available) open.title = t('vibe.listening.settings.dictionaryNotReadyOpenTooltip');
            const count = el('span', 'akari-set-row-desc', t('vibe.listening.settings.ongoingCheckingItemCountLabel'));
            void this.dictionary.list().then(listed => {
                if (!disposed) count.textContent = t('vibe.listening.settings.builtYoursWithValuesText', { value1: listed.builtin.length, value2: listed.user.length });
            }).catch(() => { if (!disposed) count.textContent = t('vibe.listening.settings.couldNotCheckItemCountError'); });
            const history = switchControl({
                label: t('vibe.listening.settings.saveListeningHistoryLabel'), checked: this.preferences.get<boolean>(HISTORY_KEY, false),
                onChange: checked => { void this.preferences.set(HISTORY_KEY, checked, PreferenceScope.User); }
            });
            dictionaryCard.replaceChildren(groupCard(t('vibe.listening.settings.dictionaryLabel'),
                settingRow(t('vibe.listening.settings.dictionaryLabel'), undefined, count, open),
                settingRow(t('vibe.listening.settings.saveListeningHistoryLabel'), t('vibe.listening.settings.onlyMacUp200EntriesDaysLabel'), history)));
        };

        paintMic(); void findMic(); paintEngine(); paintMode(); paintDictionary();
        disposables.push(session.onDidChange(status => {
            if (disposed) return;
            if (status.mic === 'ok' || status.mic === 'denied' || status.mic === 'unsupported') {
                mic = status.mic; if (mic !== 'ok') micName = '';
                rememberListeningMic(mic); void findMic();
            }
            if (status.state === 'error' && running) {
                const message = status.message ?? t('vibe.listening.settings.listeningStoppedMessage');
                void stopTrial().then(() => { if (!disposed) trialStatus.textContent = message; });
            }
        }));
        disposables.push(session.onLevel(level => {
            if ((!running && !stopping) || disposed) return;
            levelFill.style.transform = `scaleX(${Math.max(0, Math.min(1, level * 10))})`;
            if (level > 0.01 && voiceAt === undefined) voiceAt = performance.now();
        }));
        disposables.push(session.onUtterance(utterance => {
            if ((!running && !stopping) || disposed) return;
            if (latency === undefined && voiceAt !== undefined) latency = t('vibe.listening.settings.secWithCountLabel', { value1: ((performance.now() - voiceAt) / 1000).toFixed(2) });
            paintUtterance(utterance);
            foot.textContent = t('vibe.listening.settings.nothingSavedWithValuesText', { value1: EAR_ENGINE_LABELS[currentEngine ?? 'auto'], value2: latency ? t('vibe.listening.settings.trialLatency', { latency }) : '' });
        }));
        disposables.push(this.preferences.onPreferenceChanged(change => {
            if (disposed) return;
            if (change.preferenceName === LISTENING_ENGINE_KEY) paintEngine();
            if (change.preferenceName === VIBE_MODE_KEY || change.preferenceName === 'akari.companion.enabled') paintMode();
            if (change.preferenceName === HISTORY_KEY) paintDictionary();
        }));
        void this.ear.capabilities().then(value => {
            if (disposed) return;
            capabilities = value; paintEngine(); paintMode();
        }).catch(() => { if (!disposed) trialStatus.textContent = t('vibe.listening.settings.couldNotCheckListeningEngineError'); });
        return Disposable.create(() => {
            disposed = true;
            disposables.dispose();
            void stopTrial().then(() => { if (!this.session) session.dispose(); });
            root.remove();
        });
    }

    protected async selectMode(previous: VibeMode, next: VibeMode): Promise<void> {
        if (needsVibeModeConfirmation(previous, next)) {
            const confirmed = await new ConfirmDialog({
                title: t('vibe.listening.settings.turnJevTooltip'), msg: DISCLOSURE, ok: t('vibe.listening.settings.turnTooltip'), cancel: t('vibe.listening.settings.cancelTooltip')
            }).open();
            if (!confirmed) return;
        }
        await this.preferences.set(VIBE_MODE_KEY, next, PreferenceScope.User);
    }
}
