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
import { EarRecorder } from './ear-recorder';
import { ensureCorrectedTextStyles } from './corrected-text';
import { lastKnownListeningMic, rememberListeningMic } from './listening-preferences';

const DISCLOSURE = '話した内容と編集中の動画の構成（字幕は先頭 20 文字まで）を、あなたの OpenRouter キーとともに AKARI のサーバー経由で送ります';
const HISTORY_KEY = 'akari.listening.history';
const TRIAL_HINT = '「試し聞き」を押して、何か話してください。聞き取った文がここに出ます。';

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
        let started = false;
        let recorder: EarRecorder | undefined;
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
        const trialStatus = el('span', 'akari-listening-trial-state', '待機中');
        trialStatus.setAttribute('role', 'status');
        const micLabel = el('span', 'akari-listening-mic');
        const levelTrack = el('div', 'akari-listening-meter');
        const levelFill = el('div', 'akari-listening-meter-fill');
        levelTrack.append(levelFill);
        const output = el('div', 'akari-listening-output', TRIAL_HINT);
        output.setAttribute('aria-live', 'polite');
        const foot = el('p', 'akari-listening-trial-foot', '何も保存しません');
        root.append(listeningCard, modeCard, dictionaryCard);
        host.append(root);

        const paintMic = (): void => {
            micLabel.textContent = mic === 'denied' ? 'マイク: 許可がありません'
                : mic === 'unsupported' ? 'マイク: この環境では使えません'
                    : micName ? `マイク: ${micName}` : 'マイク: 未確認（許可後に名前を表示）';
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
                word.title = `聞こえたまま: ${segment.applied.from}`;
                output.append(word);
            }
        };
        const stopTrial = async (): Promise<void> => {
            if (stopping || (!running && !recorder)) return;
            stopping = true;
            trialStatus.textContent = currentEngine === 'record-then-transcribe' ? '文字にしています…' : '停止しています…';
            try {
                try { if (recorder) await recorder.stop(); }
                finally {
                    recorder = undefined;
                    if (started) { await this.ear.stop(); started = false; }
                }
                if (!disposed) trialStatus.textContent = '待機中';
            } catch { if (!disposed) trialStatus.textContent = '試し聞きを止められませんでした'; }
            running = false;
            stopping = false;
            if (!disposed) paintTrialButton();
        };
        const trialButton = button('試し聞き', () => { if (!stopping) void (running ? stopTrial() : startTrial()); });
        const paintTrialButton = (): void => {
            trialButton.textContent = running ? '止める' : '試し聞き';
            trialButton.disabled = stopping;
            mark.dataset.on = String(running);
            if (!running) levelFill.style.transform = 'scaleX(0)';
        };
        const startTrial = async (): Promise<void> => {
            if (running || disposed) return;
            currentEngine = resolveEarEngine(this.preferences, capabilities);
            if (!currentEngine) { trialStatus.textContent = '使える聞き取りエンジンがありません'; return; }
            running = true;
            voiceAt = undefined;
            latency = undefined;
            output.textContent = '聞いています…';
            trialStatus.textContent = currentEngine === 'record-then-transcribe' ? '止めたあとで文字にします' : '聞いています';
            paintTrialButton();
            try {
                const status = await this.ear.start({ purpose: 'trial', engine: currentEngine });
                if (status.mic === 'ok' || status.mic === 'denied') {
                    mic = status.mic; rememberListeningMic(mic); void findMic();
                }
                if (status.state === 'error') throw new Error(status.message ?? '聞き取りを始められませんでした');
                started = true;
                if (disposed) { await this.ear.stop(); started = false; return; }
                if (currentEngine === 'record-then-transcribe') {
                    recorder = new EarRecorder(this.ear);
                    await recorder.start();
                }
            } catch (error) {
                if (error instanceof DOMException && error.name === 'NotAllowedError') {
                    mic = 'denied'; micName = ''; rememberListeningMic(mic); paintMic();
                }
                const message = error instanceof Error ? error.message : '試し聞きを始められませんでした';
                await stopTrial();
                trialStatus.textContent = message;
            }
        };
        trialHead.append(trialButton, mark, trialStatus, micLabel);
        trial.append(trialHead, levelTrack, output, foot);
        listeningCard.replaceChildren(groupCard('話したことの聞き取り',
            el('p', 'akari-listening-lead', '注釈と AKARI バイブが使う耳。端末内で動くものを優先します。'), engines, trial));

        const paintEngine = (): void => {
            engines.replaceChildren();
            const selected = readEngine(this.preferences);
            const selectedEngine = selected === 'auto' ? resolveEarEngine(this.preferences, capabilities) : selected;
            const definitions = [
                { id: 'auto', label: 'この Mac で聞き取る（Speech Analyzer）', detail: '無料 · 端末内 · macOS 26 以降 · 日本語', badge: '使えます', engine: 'speechanalyzer-live' },
                { id: 'record-then-transcribe', label: '録音して後で起こす（whisper）', detail: '無料 · 端末内 · 少し遅い · 古い OS / Windows はこちら', badge: '予備', engine: 'record-then-transcribe' },
                { id: 'cloud', label: 'クラウド（要 API キー）', detail: '有料 · 承認したときだけ', badge: '未設定', engine: undefined }
            ] as const;
            const cards: HTMLButtonElement[] = [];
            for (const choice of definitions) {
                const capability = capabilities.engines.find(engine => engine.id === choice.engine);
                const reason = choice.id === 'cloud' ? 'クラウドの聞き取りはまだ設定できません'
                    : capability?.available ? '' : capability?.reason ?? 'この環境では使えません';
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
                    statusPill(reason && choice.id !== 'cloud' ? '使えません' : choice.badge,
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
            engines.setAttribute('aria-label', '聞き取りのやり方');
        };
        const paintMode = (): void => {
            const stored = readVibeMode(this.preferences);
            const companionEnabled = this.preferences.inspect<boolean>('akari.companion.enabled')?.globalValue !== false;
            const liveAvailable = capabilities.engines.some(engine => engine.id === 'speechanalyzer-live' && engine.available);
            const effective = effectiveVibeMode({ mode: stored, companionEnabled, liveAvailable });
            const choices = (['off', 'screen', 'full'] as const).map(value => ({
                value, label: VIBE_MODE_LABELS[value], title: effective.reason ?? VIBE_MODE_DESCRIPTIONS[value], disabled: effective.locked
            }));
            const segment = segmentedControl({ label: '声でできること', options: choices, value: effective.mode,
                onChange: value => { void this.selectMode(stored, value).then(() => { if (!disposed) paintMode(); }); }
            });
            const note = settingsNote(effective.reason ?? VIBE_MODE_DESCRIPTIONS[effective.mode]);
            note.classList.add('akari-listening-mode-note');
            modeCard.replaceChildren(groupCard('話したことの行き先', settingRow('声でできること', undefined, segment), note));
        };
        const paintDictionary = (): void => {
            const open = button('辞書を開く', () => { void this.commands.executeCommand('akari.voiceDictionary.open'); });
            const available = !!this.commandRegistry.getCommand('akari.voiceDictionary.open');
            open.disabled = !available;
            if (!available) open.title = '辞書を開く準備ができていません';
            const count = el('span', 'akari-set-row-desc', '件数を確認中…');
            void this.dictionary.list().then(listed => {
                if (!disposed) count.textContent = `同梱 ${listed.builtin.length} / 自分 ${listed.user.length}`;
            }).catch(() => { if (!disposed) count.textContent = '件数を確認できません'; });
            const history = switchControl({
                label: '聞き取りの履歴を残す', checked: this.preferences.get<boolean>(HISTORY_KEY, false),
                onChange: checked => { void this.preferences.set(HISTORY_KEY, checked, PreferenceScope.User); }
            });
            dictionaryCard.replaceChildren(groupCard('辞書',
                settingRow('辞書', undefined, count, open),
                settingRow('聞き取りの履歴を残す', 'この Mac の中だけ・200 件か 7 日', history)));
        };

        paintMic(); void findMic(); paintEngine(); paintMode(); paintDictionary();
        disposables.push(this.ear.onStatus(status => {
            if (disposed) return;
            if (status.mic === 'ok' || status.mic === 'denied' || status.mic === 'unsupported') {
                mic = status.mic; if (mic !== 'ok') micName = '';
                rememberListeningMic(mic); void findMic();
            }
            if (status.state === 'error' && running) {
                const message = status.message ?? '聞き取りが止まりました';
                void stopTrial().then(() => { if (!disposed) trialStatus.textContent = message; });
            }
        }));
        disposables.push(this.ear.onLevel(level => {
            if ((!running && !stopping) || disposed) return;
            levelFill.style.transform = `scaleX(${Math.max(0, Math.min(1, level * 10))})`;
            if (level > 0.01 && voiceAt === undefined) voiceAt = performance.now();
        }));
        disposables.push(this.ear.onUtterance(utterance => {
            if ((!running && !stopping) || disposed) return;
            if (latency === undefined && voiceAt !== undefined) latency = `${((performance.now() - voiceAt) / 1000).toFixed(2)} 秒`;
            paintUtterance(utterance);
            foot.textContent = `何も保存しません · ${EAR_ENGINE_LABELS[currentEngine ?? 'auto']}${latency ? ` · 声から文字まで ${latency}` : ''}`;
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
        }).catch(() => { if (!disposed) trialStatus.textContent = '聞き取りエンジンを確認できませんでした'; });
        return Disposable.create(() => {
            disposed = true;
            disposables.dispose();
            void stopTrial();
            root.remove();
        });
    }

    protected async selectMode(previous: VibeMode, next: VibeMode): Promise<void> {
        if (needsVibeModeConfirmation(previous, next)) {
            const confirmed = await new ConfirmDialog({
                title: 'Jev をオンにしますか？', msg: DISCLOSURE, ok: 'オンにする', cancel: 'キャンセル'
            }).open();
            if (!confirmed) return;
        }
        await this.preferences.set(VIBE_MODE_KEY, next, PreferenceScope.User);
    }
}
