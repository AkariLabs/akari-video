import { t } from '@akari-video/i18n';
import URI from '@theia/core/lib/common/uri';
import { AbstractDialog, ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import type { AkariAnnotationsService, NarrationEngine, VoiceCheckResult, VoiceEngine, VoiceScript } from '../../common/akari-annotations-protocol';
import { VOICE_STEPS, voiceCanNext, voiceGeminiConsentReady, voiceCheckReason, voiceCheckRows, voiceCopyDefaults, voiceId, voiceNextStep,
    geminiConsentStatus, geminiWatermarkNotice,
    voiceShouldDiscardProfileForRecording, voiceStorageDisplay, type VoiceStep } from '../../common/voice-clone-model';
import { falKeyAvailable } from '../../common/read-aloud-model';
import { createGeminiConsentPrompt } from './gemini-consent-step';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
};
const MIC_ERROR = t('annotationscommon.voiceCloneDialog.message.canTUseMicrophoneTurnOffAkari');
const TRY_TEXT = t('annotationscommon.voiceCloneDialog.message.helloTodayWeWillIntroduceNewFeatures');

export class AkariVoiceCloneDialog extends AbstractDialog<string | undefined> {
    protected readonly body = el('div');
    protected readonly note = el('div');
    protected readonly footer = el('div');
    protected readonly next = el('button', t('annotationscommon.voiceCloneDialog.label.next'));
    protected readonly back = el('button', t('annotationscommon.voiceCloneDialog.action.back'));
    protected step: VoiceStep = 'consent';
    protected scripts: VoiceScript[] = [];
    protected script: VoiceScript['id'] = 'quick-v1';
    protected audioPath?: string;
    protected consentAudioPath?: string;
    protected consentCheck?: VoiceCheckResult;
    protected audioUrl?: string;
    protected check?: VoiceCheckResult;
    protected engines: NarrationEngine[] = [];
    protected selected: VoiceEngine[] = [];
    protected copied: VoiceEngine[] = [];
    protected generated: Partial<Record<VoiceEngine, string>> = {};
    protected tempPaths: string[] = [];
    protected existingIds: string[] = [];
    protected profile?: string;
    protected saved = false;
    protected busy = false;
    protected consentSelf = false;
    protected consentCloud = false;
    protected label: string;
    protected tryText = TRY_TEXT;
    protected recorder?: MediaRecorder;
    protected stream?: MediaStream;
    protected context?: AudioContext;
    protected timer?: number;
    protected meterTimer?: number;
    protected elapsed = 0;
    protected meterPeak = 0;
    protected error?: string;
    protected extending = false;
    protected storage = { root: '', home: '' };
    protected staleWarning = '';

    constructor(protected readonly service: AkariAnnotationsService, protected readonly files: FileService,
        protected readonly preferences: PreferenceService, protected readonly avatar: string,
        avatarDisplayName?: string) {
        super({ title: t('annotationscommon.voiceCloneDialog.title.makeOwnVoice') });
        this.label = t('annotationscommon.voiceCloneDialog.label.narration', { avatarName: avatarDisplayName || avatar });
        this.node.dataset.akariVoiceCloneDialog = 'true';
        this.node.dataset.voiceAvatar = avatar;
        this.controlPanel.style.display = 'none';
        Object.assign(this.contentNode.parentElement!.style, { width: 'min(650px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', borderRadius: '12px' });
        Object.assign(this.contentNode.style, { padding: '0', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 70px)' });
        Object.assign(this.body.style, { padding: '18px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' });
        Object.assign(this.footer.style, { padding: '12px 18px', borderTop: '1px solid #666', display: 'flex', gap: '8px' });
        this.note.style.flex = '1';
        this.next.dataset.voiceNext = 'true';
        this.back.dataset.voiceBack = 'true';
        this.back.addEventListener('click', () => { if (this.step !== 'consent' && !this.busy) {
            this.step = voiceNextStep(this.step, -1, this.copied.length); this.render();
        } });
        this.next.addEventListener('click', () => void this.advance());
        this.footer.append(this.note, this.back, this.next);
        this.contentNode.append(this.body, this.footer);
        this.toDispose.push({ dispose: () => {
            this.stopCapture();
            if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
            for (const url of Object.values(this.generated)) if (url) URL.revokeObjectURL(url);
            if (!this.saved) void this.service.voiceDiscard({ profile: this.profile, tempPaths: this.tempPaths, irodoriUrl: this.irodoriUrl() });
            else void this.service.voiceDiscard({ tempPaths: this.tempPaths });
        } });
        this.render();
        void this.load();
    }

    get value(): string | undefined { return this.saved ? this.profile : undefined; }
    protected override handleEnter(_event: KeyboardEvent): boolean { return false; }
    protected irodoriUrl(): string { return this.preferences.get<string>('akari.narration.irodoriUrl', 'http://127.0.0.1:8088'); }
    protected async load(): Promise<void> {
        try {
            const [scripts, profiles, engines, storage] = await Promise.all([
                this.service.voiceScripts(), this.service.voiceProfiles(), this.service.listNarrationEngines('', this.irodoriUrl()), this.service.voiceStorageRoot()
            ]);
            this.storage = storage;
            this.scripts = scripts.scripts;
            this.existingIds = profiles.profiles.map(profile => profile.id);
            this.engines = engines.engines;
            this.render();
        } catch (error) { this.note.textContent = String(error); }
    }
    protected updateButtons(): void {
        this.back.disabled = this.step === 'consent' || this.busy;
        this.next.disabled = !voiceCanNext(this.step, { consentSelf: this.consentSelf, audioPath: this.audioPath,
            check: this.check, consentAudioPath: this.consentAudioPath, consentCheck: this.consentCheck, busy: this.busy, label: this.label });
        this.next.textContent = this.step === 'save' ? t('annotationscommon.voiceCloneDialog.action.saveVoice') : this.step === 'copy' ?
            (this.selected.length ? t('annotationscommon.voiceCloneDialog.action.createPlace') : t('annotationscommon.voiceCloneDialog.action.saveRecordingOnly')) : t('annotationscommon.voiceCloneDialog.label.next');
    }
    protected render(): void {
        this.body.replaceChildren();
        const total = this.selected.includes('gemini-3.8-flash-tts') ? 7 : 6;
        const current = VOICE_STEPS.indexOf(this.step) + 1 - (this.step === 'gemini-consent' || VOICE_STEPS.indexOf(this.step) < 4 ? 0 : total === 6 ? 1 : 0);
        const title = el('h2', `${current} / ${total}  ${{
            consent: t('annotationscommon.voiceCloneDialog.label.consent'), record: t('annotationscommon.voiceCloneDialog.action.readRead'), check: t('annotationscommon.voiceCloneDialog.action.makeSureRecord'), copy: t('annotationscommon.voiceCloneDialog.label.whereMake'),
            'gemini-consent': t('annotationscommon.voiceCloneDialog.label.google'), compare: t('annotationscommon.voiceCloneDialog.action.tryCompare'), save: t('annotationscommon.voiceCloneDialog.action.saveLabel')
        }[this.step]}`);
        this.body.append(title);
        if (this.step === 'consent') this.renderConsent();
        if (this.step === 'record') this.renderRecord();
        if (this.step === 'check') this.renderCheck();
        if (this.step === 'copy') this.renderCopy();
        if (this.step === 'gemini-consent') this.renderGeminiConsent();
        if (this.step === 'compare') this.renderCompare();
        if (this.step === 'save') this.renderSave();
        this.note.textContent = this.error ?? (this.busy ? t('annotationscommon.voiceCloneDialog.status.processing') : `${current} / ${total}`);
        this.updateButtons();
    }
    protected renderConsent(): void {
        this.body.append(el('p', t('annotationscommon.voiceCloneDialog.message.canTUseVoicesFromOthers')));
        const self = el('input'); self.type = 'checkbox'; self.checked = this.consentSelf; self.dataset.voiceConsentSelf = 'true';
        self.addEventListener('change', () => { this.consentSelf = self.checked; this.updateButtons(); });
        const cloud = el('input'); cloud.type = 'checkbox'; cloud.checked = this.consentCloud; cloud.dataset.voiceConsentCloud = 'true';
        cloud.addEventListener('change', () => { this.consentCloud = cloud.checked; this.updateButtons(); });
        const row1 = el('label'); row1.append(self, t('annotationscommon.voiceCloneDialog.consent.ownVoice'));
        const row2 = el('label'); row2.append(cloud, t('annotationscommon.voiceCloneDialog.consent.cloudTransfer'));
        this.body.append(row1, row2, el('small', t('annotationscommon.voiceCloneDialog.message.agreeRemainsRecordVoiceDateTime')));
    }
    protected renderRecord(consent = false): void {
        if (consent) this.body.append(createGeminiConsentPrompt());
        else {
            this.body.append(el('p', t('annotationscommon.voiceCloneDialog.action.readSlowlyUsualVoiceNarrationAbout20')));
            const script = this.scripts.find(item => item.id === this.script)?.text ?? t('annotationscommon.voiceCloneDialog.action.readLatestVersion');
            const box = el('div'); box.dataset.voiceScript = 'true';
            Object.assign(box.style, { fontSize: '18px', lineHeight: '1.8', padding: '16px', border: '1px solid #777', borderRadius: '8px' });
            const parts = script.split(/(?<=。)/u).filter(Boolean);
            for (const [index, part] of parts.entries()) {
                const span = el('span', part); span.dataset.voiceSentence = String(index);
                if (this.recorder?.state === 'recording' && index === Math.min(parts.length - 1, Math.floor(this.elapsed / (this.script === 'quick-v1' ? 5 : 8)))) {
                    span.style.background = '#77652b';
                }
                box.append(span);
            }
            this.body.append(box);
        }
        const select = el('select'); select.setAttribute('aria-label', t('annotationscommon.voiceCloneDialog.action.selectMicrophone')); select.dataset.voiceMicrophone = 'true';
        const option = el('option', t('annotationscommon.voiceCloneDialog.label.defaultMicrophone')); option.value = ''; select.append(option);
        void navigator.mediaDevices?.enumerateDevices?.().then(devices => {
            for (const device of devices.filter(value => value.kind === 'audioinput')) {
                const item = el('option', device.label || t('annotationscommon.voiceCloneDialog.label.microphone')); item.value = device.deviceId; select.append(item);
            }
        }).catch(() => {});
        this.body.append(select);
        const row = el('div'); Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const rec = el('button', this.recorder?.state === 'recording' ? t('annotationscommon.voiceCloneDialog.label.stop') : t('annotationscommon.voiceCloneDialog.label.record')); rec.dataset.voiceRecord = 'true';
        rec.disabled = !this.consentSelf;
        rec.addEventListener('click', () => { if (this.recorder?.state === 'recording') this.stopRecording(); else void this.startRecording(select.value); });
        const meter = el('progress'); meter.max = 100; meter.value = this.meterPeak; meter.dataset.voiceMeter = 'true';
        const clock = el('span', `${Math.floor(this.elapsed / 60).toString().padStart(2, '0')}:${(this.elapsed % 60).toString().padStart(2, '0')}`); clock.dataset.voiceElapsed = 'true';
        row.append(rec, meter, clock); this.body.append(row);
        if (consent ? this.consentAudioPath : this.audioPath) { const again = el('button', t('annotationscommon.voiceCloneDialog.label.recording')); again.addEventListener('click', () => {
            if (consent) { this.consentAudioPath = undefined; this.consentCheck = undefined; this.render(); }
            else void this.resetRecording();
        }); this.body.append(again); }
        const drop = el('div', t('annotationscommon.voiceCloneDialog.label.dropRecordingFile')); drop.dataset.voiceDrop = 'true';
        Object.assign(drop.style, { padding: '20px', border: '2px dashed #777', borderRadius: '8px', cursor: 'pointer' });
        const input = el('input'); input.type = 'file'; input.accept = '.m4a,.wav,.mp3,.webm'; input.style.display = 'none';
        input.addEventListener('change', () => { if (input.files?.[0]) void this.useFile(input.files[0]); });
        drop.addEventListener('click', () => input.click()); drop.addEventListener('dragover', event => event.preventDefault());
        drop.addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer?.files[0]) void this.useFile(event.dataTransfer.files[0]); });
        this.body.append(drop, input);
    }
    protected renderGeminiConsent(): void {
        this.renderRecord(true);
        if (this.consentCheck) this.body.append(el('p', geminiConsentStatus(this.consentCheck)));
    }
    protected async startRecording(deviceId: string): Promise<void> {
        try {
            if (window.electronAkariPreview?.askForMicrophoneAccess && !await window.electronAkariPreview.askForMicrophoneAccess()) throw new Error(MIC_ERROR);
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
                ...(deviceId ? { deviceId: { exact: deviceId } } : {}), autoGainControl: false,
                echoCancellation: false, noiseSuppression: false
            } });
            this.context = new AudioContext();
            const source = this.context.createMediaStreamSource(this.stream);
            const analyser = this.context.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
            const silent = this.context.createGain(); silent.gain.value = 0; analyser.connect(silent); silent.connect(this.context.destination);
            const samples = new Uint8Array(analyser.fftSize);
            this.meterTimer = window.setInterval(() => {
                analyser.getByteTimeDomainData(samples);
                this.meterPeak = Math.round(Math.max(...samples.map(value => Math.abs(value - 128))) / 128 * 100);
                const meter = this.body.querySelector<HTMLProgressElement>('[data-voice-meter]'); if (meter) meter.value = this.meterPeak;
            }, 100);
            const chunks: Blob[] = [];
            this.recorder = new MediaRecorder(this.stream);
            this.recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            this.recorder.onstop = () => { void this.useBlob(new Blob(chunks, { type: this.recorder?.mimeType || 'audio/webm' }), 'webm'); };
            this.recorder.start(); this.elapsed = 0;
            this.timer = window.setInterval(() => { this.elapsed++; this.render(); }, 1000);
            this.render();
        } catch { this.stopCapture(); this.error = MIC_ERROR; this.render(); }
    }
    protected stopRecording(): void { this.recorder?.stop(); this.stopCapture(false); this.render(); }
    protected stopCapture(stopRecorder = true): void {
        if (stopRecorder && this.recorder?.state === 'recording') this.recorder.stop();
        if (this.timer) window.clearInterval(this.timer);
        if (this.meterTimer) window.clearInterval(this.meterTimer);
        this.timer = undefined; this.meterTimer = undefined;
        this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
        void this.context?.close(); this.context = undefined; this.meterPeak = 0;
    }
    protected async resetRecording(): Promise<void> {
        this.audioPath = undefined; this.check = undefined; this.elapsed = 0;
        if (this.audioUrl) URL.revokeObjectURL(this.audioUrl); this.audioUrl = undefined;
        this.render();
    }
    protected async useFile(file: File): Promise<void> {
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (!['m4a', 'wav', 'mp3', 'webm'].includes(extension ?? '')) { this.error = t('annotationscommon.voiceCloneDialog.message.selectRecordingFormat'); this.render(); return; }
        await this.useBlob(file, extension as 'm4a' | 'wav' | 'mp3' | 'webm');
    }
    protected async useBlob(blob: Blob, extension: 'm4a' | 'wav' | 'mp3' | 'webm'): Promise<void> {
        this.busy = true; this.updateButtons();
        let token: string | undefined;
        try {
            ({ token } = await this.service.voiceBeginRecording(extension));
            // 分割して渡し、数 MB の録音を単一の JSON 配列にしない。
            for (let offset = 0; offset < blob.size; offset += 192 * 1024) {
                const bytes = new Uint8Array(await blob.slice(offset, offset + 192 * 1024).arrayBuffer());
                let binary = '';
                for (const byte of bytes) binary += String.fromCharCode(byte);
                await this.service.voiceAppendRecording({ token: token!, chunk: btoa(binary) });
            }
            const result = await this.service.voiceFinishRecording(token!);
            token = undefined;
            this.tempPaths.push(result.path);
            if (this.step !== 'gemini-consent' && voiceShouldDiscardProfileForRecording(this.profile, this.extending)) {
                await this.service.voiceDiscard({ profile: this.profile, tempPaths: [], irodoriUrl: this.irodoriUrl() });
                this.profile = undefined; this.copied = []; this.selected = [];
                this.clearGenerated();
            }
            if (this.step === 'gemini-consent') { this.consentAudioPath = result.path; this.consentCheck = undefined; }
            else { this.audioPath = result.path; this.check = undefined; }
            if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = URL.createObjectURL(blob);
        } catch (error) { if (token) await this.service.voiceAbortRecording(token); this.error = String(error); }
        finally { this.busy = false; this.render(); }
    }
    protected renderCheck(): void {
        this.body.append(el('p', t('annotationscommon.voiceCloneDialog.action.checkRecordedAudioOnlyPcNoMatter')));
        if (this.check) {
            for (const row of voiceCheckRows(this.check)) {
                const item = el('div', `${row.mark}  ${row.label}: ${row.detail}`); item.dataset.voiceCheck = row.label;
                item.style.padding = '8px'; this.body.append(item);
            }
            if (!this.check.pass) this.body.append(el('p', voiceCheckReason(this.check)));
            if (this.check.checks.script.ok === 'unavailable') this.body.append(el('p', t('annotationscommon.voiceCloneDialog.label.pcCanNotBeHeardSoCan')));
        }
        if (this.audioUrl) { const audio = el('audio'); audio.controls = true; audio.src = this.audioUrl; audio.dataset.voiceOriginal = 'true'; this.body.append(audio); }
        const retry = el('button', t('annotationscommon.voiceCloneDialog.label.recording')); retry.addEventListener('click', () => { void this.resetRecording(); this.step = 'record'; this.render(); }); this.body.append(retry);
    }
    protected renderCopy(): void {
        const options: Array<{ engine: VoiceEngine; title: string; note: string; available: boolean }> = [
            { engine: 'irodori', title: t('annotationscommon.voiceCloneDialog.title.createPcColorFreeTrial'), note: this.irodoriUrl(),
                available: this.engines.some(item => item.id === 'irodori' && item.availability.state === 'available') },
            { engine: 'fal-qwen3', title: t('annotationscommon.voiceCloneDialog.title.cloud'), note: t('annotationscommon.voiceCloneDialog.label.voicemakingAboutReadUp0091000'),
                available: falKeyAvailable(this.engines.find(item => item.id === 'fal-qwen3'))
                    && this.consentCloud && this.check?.checks.script.ok === true },
            { engine: 'gemini-3.8-flash-tts', title: t('annotationscommon.voiceCloneDialog.title.googleGemini38'), note: t('annotationscommon.voiceCloneDialog.label.noQuoteVoicemakingOralConsentRecordingRequired'),
                available: this.engines.some(item => item.id === 'gemini-3.8-flash-tts' && item.availability.state !== 'unconfigured')
                    && this.consentCloud && this.check?.checks.script.ok === true && (this.check?.checks.duration.value_s ?? 0) >= 10 }
        ];
        for (const option of options) {
            const card = el('label'); card.dataset.voiceEngine = option.engine;
            Object.assign(card.style, { display: 'block', padding: '12px', border: '1px solid #777', borderRadius: '8px', opacity: option.available ? '1' : '.55' });
            const input = el('input'); input.type = 'checkbox'; input.value = option.engine;
            input.checked = this.selected.includes(option.engine); input.disabled = !option.available;
            input.addEventListener('change', () => { this.selected = input.checked ? [...this.selected, option.engine] : this.selected.filter(item => item !== option.engine); this.render(); });
            card.append(input, ` ${option.title}`, el('div', option.available ? option.note : t('annotationscommon.voiceCloneDialog.message.checkConsentAgreement')));
            if (option.engine === 'gemini-3.8-flash-tts') card.append(el('div', geminiWatermarkNotice()));
            this.body.append(card);
        }
        this.body.append(el('small', t('annotationscommon.voiceCloneDialog.message.canChooseBothThem')));
    }
    protected renderCompare(): void {
        this.body.append(el('p', t('annotationscommon.voiceCloneDialog.message.compareSameSentenceVoiceWasWritten')));
        const text = el('input'); text.type = 'text'; text.value = this.tryText; text.setAttribute('aria-label', t('annotationscommon.voiceCloneDialog.label.sampleText')); text.style.width = '100%';
        text.addEventListener('input', () => { this.tryText = text.value; }); this.body.append(text);
        if (this.audioUrl) { const card = el('div'); card.append(el('div', t('annotationscommon.voiceCloneDialog.label.voicesIWrote'))); const row = el('div');
            Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });
            const audio = el('audio'); audio.controls = true; audio.src = this.audioUrl; row.append(audio); card.append(row); this.body.append(card); }
        for (const engine of this.copied) {
            const card = el('div', t('annotationscommon.voiceCloneDialog.label.bVoicesCreated', { engine: engine === 'irodori' ? t('annotationscommon.voiceCloneDialog.label.irodoriPc') : engine === 'fal-qwen3' ? t('annotationscommon.voiceCloneDialog.label.cloud') : 'Google Gemini 3.8' }));
            card.dataset.voiceCompare = engine;
            const row = el('div'); Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });
            const audio = el('audio'); audio.controls = true; audio.src = this.generated[engine] ?? ''; row.append(audio);
            if (engine !== 'gemini-3.8-flash-tts') { const button = el('button', t('annotationscommon.voiceCloneDialog.action.try')); button.addEventListener('click', () => void this.tryEngine(engine)); row.append(button); }
            card.append(row); this.body.append(card);
        }
        const retry = el('button', t('annotationscommon.voiceCloneDialog.action.makeAgain')); retry.addEventListener('click', () => { this.step = 'copy'; this.render(); });
        const extended = el('button', t('annotationscommon.voiceCloneDialog.action.makeMoreSimilarRecording60SecondsTime')); extended.addEventListener('click', () => void this.restartWithScript('extended-v1'));
        const reRecord = el('button', t('annotationscommon.voiceCloneDialog.action.rerecordMismatch')); reRecord.addEventListener('click', () => void this.restartWithScript('quick-v1'));
        this.body.append(retry, extended, reRecord);
        if (this.staleWarning) {
            const warning = el('div', t('annotationscommon.voiceCloneDialog.confirm.regenerateOutdatedCopy'));
            const remake = el('button', t('annotationscommon.voiceCloneDialog.action.makeCopy')); remake.addEventListener('click', () => { this.step = 'copy'; this.render(); });
            warning.append(remake); this.body.append(warning);
        }
    }
    protected async restartWithScript(script: VoiceScript['id']): Promise<void> {
        this.busy = true; this.updateButtons();
        try {
            if (script === 'quick-v1' && this.profile) await this.service.voiceDiscard({ profile: this.profile, tempPaths: [], irodoriUrl: this.irodoriUrl() });
            if (script === 'quick-v1') this.profile = undefined;
            this.extending = script === 'extended-v1'; this.copied = []; this.selected = [];
            this.clearGenerated();
            this.script = script; this.step = 'record'; await this.resetRecording();
        } catch (error) { this.error = String(error); }
        finally { this.busy = false; this.render(); }
    }
    protected clearGenerated(): void {
        for (const url of Object.values(this.generated)) if (url) URL.revokeObjectURL(url);
        this.generated = {};
    }
    protected renderSave(): void {
        const label = el('input'); label.type = 'text'; label.value = this.label; label.setAttribute('aria-label', t('annotationscommon.voiceCloneDialog.label.name'));
        label.addEventListener('input', () => { this.label = label.value; this.updateButtons(); });
        this.body.append(el('label', t('annotationscommon.voiceCloneDialog.label.name')), label);
        const id = this.profile ?? voiceId(this.label, this.existingIds, `${this.avatar}-narration`);
        const display = voiceStorageDisplay(this.storage.root, this.storage.home, this.avatar, id);
        this.body.append(el('div', t('annotationscommon.voiceCloneDialog.action.saveWithValue', { display: display })),
            el('div', t('annotationscommon.voiceCloneDialog.recording.sourceOfTruth')),
            el('div', t('annotationscommon.voiceCloneDialog.label.voiceCopies', { engines: this.copied.map(engine => engine === 'irodori' ? t('annotationscommon.voiceCloneDialog.label.irodoriPc') : engine === 'fal-qwen3' ? t('annotationscommon.voiceCloneDialog.label.cloud') : 'Google Gemini 3.8').join(t('annotationscommon.voiceCloneDialog.separator.engines')) || t('annotationscommon.voiceCloneDialog.label.noneOnlyRecording') })),
            el('div', t('annotationscommon.voiceCloneDialog.message.whenTurnOffSetReadVoiceRemove')));
    }
    protected async advance(): Promise<void> {
        if (!voiceCanNext(this.step, { consentSelf: this.consentSelf, audioPath: this.audioPath, check: this.check,
            consentAudioPath: this.consentAudioPath, consentCheck: this.consentCheck, busy: this.busy, label: this.label })) return;
        this.busy = true; this.updateButtons();
        this.error = undefined;
        try {
            if (this.step === 'record') {
                this.check = await this.service.voiceCheck({ audioPath: this.audioPath!, script: this.script });
                this.step = 'check';
            } else if (this.step === 'check') {
                if (this.extending && this.profile) {
                    const updated = await this.service.voiceExtend({ profile: this.profile, audioPath: this.audioPath! });
                    this.staleWarning = updated.warnings?.length ? t('annotationscommon.voiceCloneDialog.confirm.regenerateOutdatedCopy') : '';
                    const audio = await this.files.readFile(URI.fromFilePath(updated.path));
                    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
                    this.audioUrl = URL.createObjectURL(new Blob([audio.value.buffer as ArrayBuffer], { type: 'audio/wav' }));
                    this.extending = false;
                }
                const defaults = voiceCopyDefaults({ irodoriAvailable: this.engines.some(item => item.id === 'irodori' && item.availability.state === 'available'),
                    falAvailable: falKeyAvailable(this.engines.find(item => item.id === 'fal-qwen3')),
                    consentCloud: this.consentCloud, scriptOk: this.check!.checks.script.ok });
                this.selected = defaults; this.step = 'copy';
            } else if (this.step === 'copy' || this.step === 'gemini-consent') {
                if (this.step === 'copy' && this.selected.includes('gemini-3.8-flash-tts') && !voiceGeminiConsentReady(this.consentCheck)) {
                    this.step = 'gemini-consent'; return;
                }
                if (this.step === 'gemini-consent' && !voiceGeminiConsentReady(this.consentCheck)) {
                    this.consentCheck = await this.service.voiceCheck({ audioPath: this.consentAudioPath!, script: 'consent-gemini' }); return;
                }
                if (this.selected.includes('fal-qwen3')) {
                    const approved = await new ConfirmDialog({ title: t('annotationscommon.voiceCloneDialog.title.costApproval'), msg: t('annotationscommon.voiceCloneDialog.message.sendRecordingFalAiGetVoiceQuotation'), ok: t('annotationscommon.voiceCloneDialog.label.costApproval'), cancel: t('annotationscommon.voiceCloneDialog.action.cancel') }).open();
                    if (!approved) return;
                }
                if (this.selected.includes('gemini-3.8-flash-tts')) {
                    const approved = await new ConfirmDialog({ title: t('annotationscommon.voiceCloneDialog.title.costApproval'), msg: t('annotationscommon.voiceCloneDialog.consent.googleVoiceCreation'), ok: t('annotationscommon.voiceCloneDialog.label.costApproval'), cancel: t('annotationscommon.voiceCloneDialog.action.cancel') }).open();
                    if (!approved) return;
                }
                if (!this.profile) {
                    const id = voiceId(this.label, this.existingIds, `${this.avatar}-narration`);
                    const created = await this.service.voiceCreate({ avatar: this.avatar, id, label: this.label,
                        audioPath: this.audioPath!, script: this.script, consentSelf: this.consentSelf, consentCloud: this.consentCloud });
                    this.profile = created.profile;
                }
                this.copied = [];
                for (const engine of this.selected) {
                    this.note.textContent = t('annotationscommon.voiceCloneDialog.status.creatingVoiceCopy', { engine: engine === 'irodori' ? t('annotationscommon.voiceCloneDialog.label.irodoriPc') : engine === 'fal-qwen3' ? t('annotationscommon.voiceCloneDialog.label.cloud') : 'Google Gemini 3.8' });
                    await this.service.voiceCopy({ profile: this.profile, engine, irodoriUrl: this.irodoriUrl(),
                        consentAudioPath: engine === 'gemini-3.8-flash-tts' ? this.consentAudioPath : undefined, approved: engine !== 'irodori' });
                    this.copied.push(engine);
                }
                this.step = voiceNextStep('copy', 1, this.copied.length);
                for (const engine of this.copied) if (engine !== 'gemini-3.8-flash-tts') await this.tryEngine(engine);
            } else if (this.step === 'save') {
                await this.service.voiceFinalize({ profile: this.profile!, label: this.label });
                this.saved = true; this.close(); return;
            } else this.step = voiceNextStep(this.step, 1);
        } catch (error) { this.error = String(error); return; }
        finally { this.busy = false; this.render(); }
    }
    protected async tryEngine(engine: VoiceEngine): Promise<void> {
        if (!this.profile || !this.tryText.trim()) return;
        try {
            if (engine === 'fal-qwen3') {
                const ok = await new ConfirmDialog({ title: t('annotationscommon.voiceCloneDialog.title.costApproval'), msg: t('annotationscommon.voiceCloneDialog.action.makeSampleVoiceFalAiReadUp'), ok: t('annotationscommon.voiceCloneDialog.label.costApproval'), cancel: t('annotationscommon.voiceCloneDialog.action.cancel') }).open();
                if (!ok) return;
            }
            const result = await this.service.voiceTry({ profile: this.profile, engine, text: this.tryText,
                irodoriUrl: this.irodoriUrl(), approved: engine === 'fal-qwen3' });
            this.tempPaths.push(result.path);
            const data = await this.files.readFile(URI.fromFilePath(result.path));
            if (this.generated[engine]) URL.revokeObjectURL(this.generated[engine]!);
            this.generated[engine] = URL.createObjectURL(new Blob([data.value.buffer], { type: engine === 'irodori' ? 'audio/wav' : 'audio/mpeg' }));
            this.render();
        } catch (error) { this.error = String(error); this.render(); }
    }
}
