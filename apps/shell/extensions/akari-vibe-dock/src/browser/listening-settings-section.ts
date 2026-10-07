import { inject, injectable } from '@theia/core/shared/inversify';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CommandRegistry, CommandService, Disposable, DisposableCollection } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import type { SettingsSectionBodyContribution } from 'akari-surfaces/lib/common/settings-section-body';
import { dropdown, el, groupCard, segmentedControl, settingRow, settingsNote, statusPill } from 'akari-surfaces/lib/browser/settings/settings-ui';
import { AkariEarFrontend } from '../common/ear-frontend';
import type { EarEngineId, EarStatus } from '../common/ear-protocol';
import {
    EAR_ENGINE_LABELS, EarCapabilities, effectiveVibeMode, LISTENING_ENGINE_KEY,
    readEngine, readVibeMode, resolveEarEngine, VIBE_MODE_DESCRIPTIONS, VIBE_MODE_KEY,
    VIBE_MODE_LABELS, VibeMode
} from '../common/vibe-mode';
import { EarRecorder } from './ear-recorder';
import { lastKnownListeningMic, rememberListeningMic } from './listening-preferences';

const DISCLOSURE = '話した内容と編集中の動画の構成（字幕は先頭 20 文字まで）を、あなたの OpenRouter キーとともに AKARI のサーバー経由で送ります';

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
    @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(WindowService) protected readonly windows!: WindowService;

    render(host: HTMLElement): Disposable {
        const disposables = new DisposableCollection();
        let disposed = false;
        let running = false;
        let stopping = false;
        let started = false;
        let recorder: EarRecorder | undefined;
        let currentEngine: EarEngineId | undefined;
        let voiceAt: number | undefined;
        let firstUtterance = false;
        let mic: EarStatus['mic'] = lastKnownListeningMic;
        let capabilities: EarCapabilities = { engines: [] };
        const root = el('div', 'akari-set-listening');
        const trialCard = el('div');
        const engineCard = el('div');
        const micCard = el('div');
        const modeCard = el('div');
        const dictionaryCard = el('div');
        const levelTrack = el('div', 'akari-set-listening-meter');
        levelTrack.style.cssText = 'height:8px;overflow:hidden;background:var(--akari-button-secondary);border-radius:8px';
        const levelFill = el('div', 'akari-set-listening-meter-fill');
        levelFill.style.cssText = 'height:100%;width:100%;background:var(--akari-accent);transform:scaleX(0);transform-origin:left';
        levelTrack.append(levelFill);
        const trialStatus = settingsNote('まだ試していません');
        const partial = settingsNote('途中経過: —');
        const final = settingsNote('確定した文字: —');
        const usedEngine = settingsNote('聞き取りエンジン: —');
        const latency = settingsNote('声から文字まで: —');
        root.append(trialCard, engineCard, micCard, modeCard, dictionaryCard);
        host.append(root);

        const stopTrial = async (): Promise<void> => {
            if (stopping || (!running && !recorder)) { return; }
            stopping = true;
            trialStatus.textContent = currentEngine === 'record-then-transcribe' ? '文字にしています…' : '停止しています…';
            try {
                try { if (recorder) { await recorder.stop(); } }
                finally {
                    recorder = undefined;
                    if (started) { await this.ear.stop(); started = false; }
                }
                if (!disposed) { trialStatus.textContent = '停止しました'; }
            } catch {
                if (!disposed) { trialStatus.textContent = '試し聞きを止められませんでした'; }
            }
            running = false;
            stopping = false;
            if (!disposed) { paintTrialButton(); }
        };
        const trialButton = button('話してみる', () => { if (!stopping) { void (running ? stopTrial() : startTrial()); } });
        const paintTrialButton = (): void => { trialButton.textContent = running ? '止める' : '話してみる'; trialButton.disabled = stopping; };
        const startTrial = async (): Promise<void> => {
            if (running || disposed) { return; }
            currentEngine = resolveEarEngine(this.preferences, capabilities);
            if (!currentEngine) { trialStatus.textContent = '使える聞き取りエンジンがありません'; return; }
            running = true;
            voiceAt = undefined;
            firstUtterance = false;
            partial.textContent = '途中経過: —';
            final.textContent = '確定した文字: —';
            latency.textContent = '声から文字まで: —';
            usedEngine.textContent = `聞き取りエンジン: ${EAR_ENGINE_LABELS[currentEngine]}`;
            trialStatus.textContent = currentEngine === 'record-then-transcribe'
                ? '止めたあとで文字にします' : '話してください';
            paintTrialButton();
            try {
                const status = await this.ear.start({ purpose: 'trial', engine: currentEngine });
                if (status.mic === 'ok' || status.mic === 'denied') {
                    mic = status.mic;
                    rememberListeningMic(mic);
                    paintMic();
                }
                if (status.state === 'error') { throw new Error(status.message ?? '聞き取りを始められませんでした'); }
                started = true;
                if (disposed) { await this.ear.stop(); started = false; return; }
                if (currentEngine === 'record-then-transcribe') {
                    recorder = new EarRecorder(this.ear);
                    await recorder.start();
                }
            } catch (error) {
                if (error instanceof DOMException && error.name === 'NotAllowedError') {
                    mic = 'denied'; rememberListeningMic(mic); paintMic();
                }
                trialStatus.textContent = error instanceof Error ? error.message : '試し聞きを始められませんでした';
                await stopTrial();
            }
        };
        trialCard.replaceChildren(groupCard('試し聞き', settingRow('話してみる', '試した声は保存しません', trialButton),
            levelTrack, trialStatus, partial, final, usedEngine, latency));

        const paintMic = (): void => {
            const label = mic === 'ok' ? '許可あり' : mic === 'denied' ? '許可なし' : '未確認';
            const controls: Node[] = [statusPill(label, mic === 'ok' ? 'ok' : mic === 'denied' ? 'warn' : 'neutral')];
            if (mic === 'denied') {
                controls.push(button('システム設定を開く', () => this.windows.openNewWindow(
                    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone', { external: true }
                )));
            }
            micCard.replaceChildren(groupCard('マイクの状態', settingRow('マイク', undefined, ...controls)));
        };
        const paintEngine = (): void => {
            const choices = [{ value: 'auto' as const, label: 'おまかせ' }, ...capabilities.engines.map(engine => ({
                value: engine.id, label: EAR_ENGINE_LABELS[engine.id], disabled: !engine.available,
                description: !engine.available ? engine.reason ?? 'この環境では使えません' : undefined
            }))];
            engineCard.replaceChildren(groupCard('聞き取りエンジン', settingRow('エンジン', '使えるものを選びます', dropdown({
                label: '聞き取りエンジン', options: choices, value: readEngine(this.preferences),
                onChange: value => { void this.preferences.set(LISTENING_ENGINE_KEY, value, PreferenceScope.User); }
            }))));
        };
        const paintMode = (): void => {
            const stored = readVibeMode(this.preferences);
            const companionEnabled = this.preferences.inspect<boolean>('akari.companion.enabled')?.globalValue !== false;
            const liveAvailable = capabilities.engines.some(engine => engine.id === 'speechanalyzer-live' && engine.available);
            const effective = effectiveVibeMode({ mode: stored, companionEnabled, liveAvailable });
            const choices = (['off', 'screen', 'full'] as const).map(value => ({
                value, label: VIBE_MODE_LABELS[value], title: VIBE_MODE_DESCRIPTIONS[value], disabled: effective.locked
            }));
            const segment = segmentedControl({ label: 'Jev のモード', options: choices, value: effective.mode,
                onChange: value => { void this.selectMode(stored, value).then(() => { if (!disposed) paintMode(); }); }
            });
            modeCard.replaceChildren(groupCard('Jev のモード', settingRow('声でできること', undefined, segment),
                ...(['off', 'screen', 'full'] as const).map(value => settingsNote(`${VIBE_MODE_LABELS[value]}: ${VIBE_MODE_DESCRIPTIONS[value]}`)),
                ...(effective.reason ? [settingsNote(effective.reason)] : [])));
        };
        const paintDictionary = (): void => {
            const open = button('開く', () => { void this.commands.executeCommand('akari.voiceDictionary.open'); });
            const available = !!this.commandRegistry.getCommand('akari.voiceDictionary.open');
            open.disabled = !available;
            dictionaryCard.replaceChildren(groupCard('辞書', settingRow('声の辞書', available ? undefined : '準備中', open)));
        };

        paintMic(); paintEngine(); paintMode(); paintDictionary();
        disposables.push(this.ear.onStatus(status => {
            if (disposed) { return; }
            if (status.mic === 'ok' || status.mic === 'denied') {
                mic = status.mic; rememberListeningMic(mic); paintMic();
            }
            if (status.state === 'error' && running) { trialStatus.textContent = status.message ?? '聞き取りが止まりました'; void stopTrial(); }
        }));
        disposables.push(this.ear.onLevel(level => {
            if ((!running && !stopping) || disposed) { return; }
            levelFill.style.transform = `scaleX(${Math.max(0, Math.min(1, level * 10))})`;
            if (level > 0.01 && voiceAt === undefined) { voiceAt = performance.now(); }
        }));
        disposables.push(this.ear.onUtterance(utterance => {
            if ((!running && !stopping) || disposed) { return; }
            if (!firstUtterance) {
                firstUtterance = true;
                if (voiceAt !== undefined) { latency.textContent = `声から文字まで: ${((performance.now() - voiceAt) / 1000).toFixed(2)} 秒`; }
            }
            if (utterance.final) { final.textContent = `確定した文字: ${utterance.text}`; }
            else { partial.textContent = `途中経過: ${utterance.text}`; }
        }));
        disposables.push(this.preferences.onPreferenceChanged(change => {
            if (disposed) { return; }
            if (change.preferenceName === LISTENING_ENGINE_KEY) { paintEngine(); }
            if (change.preferenceName === VIBE_MODE_KEY || change.preferenceName === 'akari.companion.enabled') { paintMode(); }
        }));
        void this.ear.capabilities().then(value => {
            if (disposed) { return; }
            capabilities = value;
            paintEngine(); paintMode();
        }).catch(() => { if (!disposed) { trialStatus.textContent = '聞き取りエンジンを確認できませんでした'; } });
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
            if (!confirmed) { return; }
        }
        await this.preferences.set(VIBE_MODE_KEY, next, PreferenceScope.User);
    }
}
