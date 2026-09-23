import URI from '@theia/core/lib/common/uri';
import { AbstractDialog, ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import type { AkariAnnotationsService, NarrationEngine, VoiceCheckResult, VoiceEngine, VoiceScript } from '../../common/akari-annotations-protocol';
import { VOICE_STEPS, voiceCanNext, voiceCheckReason, voiceCheckRows, voiceCopyDefaults, voiceId, voiceNextStep,
    voiceShouldDiscardProfileForRecording, type VoiceStep } from '../../common/voice-clone-model';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
};
const MIC_ERROR = 'マイクが使えません。システム設定 → プライバシー → マイク で AKARI を許可するか、録音ファイルを落としてください。';
const TRY_TEXT = 'こんにちは。今日は新しい機能を紹介します。';

export class AkariVoiceCloneDialog extends AbstractDialog<string | undefined> {
    protected readonly body = el('div');
    protected readonly note = el('div');
    protected readonly footer = el('div');
    protected readonly next = el('button', '次へ');
    protected readonly back = el('button', '戻る');
    protected step: VoiceStep = 'consent';
    protected scripts: VoiceScript[] = [];
    protected script: VoiceScript['id'] = 'quick-v1';
    protected audioPath?: string;
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

    constructor(protected readonly service: AkariAnnotationsService, protected readonly files: FileService,
        protected readonly preferences: PreferenceService, protected readonly avatar: string,
        avatarDisplayName?: string) {
        super({ title: '自分の声をつくる' });
        this.label = `${avatarDisplayName || avatar}（ナレーション）`;
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
            const [scripts, profiles, engines] = await Promise.all([
                this.service.voiceScripts(), this.service.voiceProfiles(), this.service.listNarrationEngines('', this.irodoriUrl())
            ]);
            this.scripts = scripts.scripts;
            this.existingIds = profiles.profiles.map(profile => profile.id);
            this.engines = engines.engines;
            this.render();
        } catch (error) { this.note.textContent = String(error); }
    }
    protected updateButtons(): void {
        this.back.disabled = this.step === 'consent' || this.busy;
        this.next.disabled = !voiceCanNext(this.step, { consentSelf: this.consentSelf, audioPath: this.audioPath,
            check: this.check, busy: this.busy, label: this.label });
        this.next.textContent = this.step === 'save' ? '保存する' : this.step === 'copy' ?
            (this.selected.length ? 'この場所でつくる' : '録音だけ保存') : '次へ';
    }
    protected render(): void {
        this.body.replaceChildren();
        const title = el('h2', `${VOICE_STEPS.indexOf(this.step) + 1} / 6  ${{
            consent: '同意', record: '読んで録る', check: '録音を確かめる', copy: 'どこでつくる',
            compare: '試して聞き比べ', save: '保存'
        }[this.step]}`);
        this.body.append(title);
        if (this.step === 'consent') this.renderConsent();
        if (this.step === 'record') this.renderRecord();
        if (this.step === 'check') this.renderCheck();
        if (this.step === 'copy') this.renderCopy();
        if (this.step === 'compare') this.renderCompare();
        if (this.step === 'save') this.renderSave();
        this.note.textContent = this.error ?? (this.busy ? '処理中…' : `${VOICE_STEPS.indexOf(this.step) + 1} / 6`);
        this.updateButtons();
    }
    protected renderConsent(): void {
        this.body.append(el('p', '録るのはあなた自身の声だけです。他の人の声・動画から切り出した声は使えません。'));
        const self = el('input'); self.type = 'checkbox'; self.checked = this.consentSelf; self.dataset.voiceConsentSelf = 'true';
        self.addEventListener('change', () => { this.consentSelf = self.checked; this.updateButtons(); });
        const cloud = el('input'); cloud.type = 'checkbox'; cloud.checked = this.consentCloud; cloud.dataset.voiceConsentCloud = 'true';
        cloud.addEventListener('change', () => { this.consentCloud = cloud.checked; this.updateButtons(); });
        const row1 = el('label'); row1.append(self, ' これから録るのは私本人の声で、私の声の読み上げに使うことに同意します');
        const row2 = el('label'); row2.append(cloud, ' クラウドでつくるなら録音が fal.ai に送られると理解しています');
        this.body.append(row1, row2, el('small', '同意は日時と一緒に声の記録に残ります。'));
    }
    protected renderRecord(): void {
        this.body.append(el('p', 'いつものナレーションの声で、ゆっくり読んでください。約 20 秒。'));
        const script = this.scripts.find(item => item.id === this.script)?.text ?? '原稿を読み込んでいます…';
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
        const select = el('select'); select.setAttribute('aria-label', 'マイクを選択'); select.dataset.voiceMicrophone = 'true';
        const option = el('option', '既定のマイク'); option.value = ''; select.append(option);
        void navigator.mediaDevices?.enumerateDevices?.().then(devices => {
            for (const device of devices.filter(value => value.kind === 'audioinput')) {
                const item = el('option', device.label || 'マイク'); item.value = device.deviceId; select.append(item);
            }
        }).catch(() => {});
        this.body.append(select);
        const row = el('div'); Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const rec = el('button', this.recorder?.state === 'recording' ? '■ 止める' : '● 録音する'); rec.dataset.voiceRecord = 'true';
        rec.disabled = !this.consentSelf;
        rec.addEventListener('click', () => { if (this.recorder?.state === 'recording') this.stopRecording(); else void this.startRecording(select.value); });
        const meter = el('progress'); meter.max = 100; meter.value = this.meterPeak; meter.dataset.voiceMeter = 'true';
        const clock = el('span', `${Math.floor(this.elapsed / 60).toString().padStart(2, '0')}:${(this.elapsed % 60).toString().padStart(2, '0')}`); clock.dataset.voiceElapsed = 'true';
        row.append(rec, meter, clock); this.body.append(row);
        if (this.audioPath) { const again = el('button', '録り直す'); again.addEventListener('click', () => void this.resetRecording()); this.body.append(again); }
        const drop = el('div', '録音ファイルをここに落とす（m4a / wav / mp3 / webm）'); drop.dataset.voiceDrop = 'true';
        Object.assign(drop.style, { padding: '20px', border: '2px dashed #777', borderRadius: '8px', cursor: 'pointer' });
        const input = el('input'); input.type = 'file'; input.accept = '.m4a,.wav,.mp3,.webm'; input.style.display = 'none';
        input.addEventListener('change', () => { if (input.files?.[0]) void this.useFile(input.files[0]); });
        drop.addEventListener('click', () => input.click()); drop.addEventListener('dragover', event => event.preventDefault());
        drop.addEventListener('drop', event => { event.preventDefault(); if (event.dataTransfer?.files[0]) void this.useFile(event.dataTransfer.files[0]); });
        this.body.append(drop, input);
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
        if (!['m4a', 'wav', 'mp3', 'webm'].includes(extension ?? '')) { this.error = 'm4a / wav / mp3 / webm を選んでください。'; this.render(); return; }
        await this.useBlob(file, extension as 'm4a' | 'wav' | 'mp3' | 'webm');
    }
    protected async useBlob(blob: Blob, extension: 'm4a' | 'wav' | 'mp3' | 'webm'): Promise<void> {
        this.busy = true; this.updateButtons();
        try {
            const bytes = [...new Uint8Array(await blob.arrayBuffer())];
            const result = await this.service.voiceSaveRecording({ bytes, extension });
            this.tempPaths.push(result.path);
            if (voiceShouldDiscardProfileForRecording(this.profile, this.extending)) {
                await this.service.voiceDiscard({ profile: this.profile, tempPaths: [], irodoriUrl: this.irodoriUrl() });
                this.profile = undefined; this.copied = []; this.selected = [];
                this.clearGenerated();
            }
            this.audioPath = result.path; this.check = undefined;
            if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = URL.createObjectURL(blob);
        } catch (error) { this.error = String(error); }
        finally { this.busy = false; this.render(); }
    }
    protected renderCheck(): void {
        this.body.append(el('p', '録った音声を、この PC の中だけで確かめます（どこにも送りません）。'));
        if (this.check) {
            for (const row of voiceCheckRows(this.check)) {
                const item = el('div', `${row.mark}  ${row.label}: ${row.detail}`); item.dataset.voiceCheck = row.label;
                item.style.padding = '8px'; this.body.append(item);
            }
            if (!this.check.pass) this.body.append(el('p', voiceCheckReason(this.check)));
            if (this.check.checks.script.ok === 'unavailable') this.body.append(el('p', 'この PC では聞き取りができないため、クラウドでは作れません（自分の PC なら作れます）'));
        }
        if (this.audioUrl) { const audio = el('audio'); audio.controls = true; audio.src = this.audioUrl; audio.dataset.voiceOriginal = 'true'; this.body.append(audio); }
        const retry = el('button', '録り直す'); retry.addEventListener('click', () => { void this.resetRecording(); this.step = 'record'; this.render(); }); this.body.append(retry);
    }
    protected renderCopy(): void {
        const options: Array<{ engine: VoiceEngine; title: string; note: string; available: boolean }> = [
            { engine: 'irodori', title: '自分の PC でつくる · 彩 · 無料 · お試し', note: this.irodoriUrl(),
                available: this.engines.some(item => item.id === 'irodori' && item.availability.state === 'available') },
            { engine: 'fal-qwen3', title: 'クラウドでつくる · fal.ai', note: '声づくり 約 $0.01 · 読み上げ $0.09 / 1000 字',
                available: this.engines.some(item => item.id === 'fal-qwen3' && item.availability.state === 'available')
                    && this.consentCloud && this.check?.checks.script.ok === true }
        ];
        for (const option of options) {
            const card = el('label'); card.dataset.voiceEngine = option.engine;
            Object.assign(card.style, { display: 'block', padding: '12px', border: '1px solid #777', borderRadius: '8px', opacity: option.available ? '1' : '.55' });
            const input = el('input'); input.type = 'checkbox'; input.value = option.engine;
            input.checked = this.selected.includes(option.engine); input.disabled = !option.available;
            input.addEventListener('change', () => { this.selected = input.checked ? [...this.selected, option.engine] : this.selected.filter(item => item !== option.engine); this.updateButtons(); });
            card.append(input, ` ${option.title}`, el('div', option.available ? option.note : 'つながりません・同意か照合を確認してください'));
            this.body.append(card);
        }
        this.body.append(el('small', '使える作り手は最初からチェック済みです。両方選ぶこともできます。'));
    }
    protected renderCompare(): void {
        this.body.append(el('p', '同じ文を、録った声と作った声で聞き比べます。'));
        const text = el('input'); text.type = 'text'; text.value = this.tryText; text.setAttribute('aria-label', '試す文'); text.style.width = '100%';
        text.addEventListener('input', () => { this.tryText = text.value; }); this.body.append(text);
        if (this.audioUrl) { const title = el('div', 'A 録った声'); const audio = el('audio'); audio.controls = true; audio.src = this.audioUrl; this.body.append(title, audio); }
        for (const engine of this.copied) {
            const card = el('div', `B 作った声（${engine === 'irodori' ? '彩' : 'fal.ai'}）`);
            card.dataset.voiceCompare = engine;
            const audio = el('audio'); audio.controls = true; audio.src = this.generated[engine] ?? ''; card.append(audio);
            const button = el('button', '試す'); button.addEventListener('click', () => void this.tryEngine(engine)); card.append(button); this.body.append(card);
        }
        const retry = el('button', 'もう一度つくる'); retry.addEventListener('click', () => { this.step = 'copy'; this.render(); });
        const extended = el('button', 'もっと似せる（60 秒の原稿を追加で録る）'); extended.addEventListener('click', () => void this.restartWithScript('extended-v1'));
        const reRecord = el('button', '似ていないので録り直す'); reRecord.addEventListener('click', () => void this.restartWithScript('quick-v1'));
        this.body.append(retry, extended, reRecord);
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
        const label = el('input'); label.type = 'text'; label.value = this.label; label.setAttribute('aria-label', '名前');
        label.addEventListener('input', () => { this.label = label.value; this.updateButtons(); });
        this.body.append(el('label', '名前'), label);
        const id = this.profile ?? voiceId(this.label, this.existingIds, `${this.avatar}-narration`);
        this.body.append(el('div', `保存先: ~/.akari/avatars/${this.avatar}/voice/${id}/`),
            el('div', '正本: 録音 ref-recording.wav・同意と照合の記録'),
            el('div', `写し: ${this.copied.join('・') || 'なし（録音だけ）'}`),
            el('div', '消すとき: 設定「読み上げ」→ 自分の声 → 消す。fal 側の声は残ります。'));
    }
    protected async advance(): Promise<void> {
        if (!voiceCanNext(this.step, { consentSelf: this.consentSelf, audioPath: this.audioPath, check: this.check, busy: this.busy, label: this.label })) return;
        this.busy = true; this.updateButtons();
        this.error = undefined;
        try {
            if (this.step === 'record') {
                this.check = await this.service.voiceCheck({ audioPath: this.audioPath!, script: this.script });
                this.step = 'check';
            } else if (this.step === 'check') {
                if (this.extending && this.profile) {
                    const updated = await this.service.voiceExtend({ profile: this.profile, audioPath: this.audioPath! });
                    const audio = await this.files.readFile(URI.fromFilePath(updated.path));
                    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
                    this.audioUrl = URL.createObjectURL(new Blob([audio.value.buffer as ArrayBuffer], { type: 'audio/wav' }));
                    this.extending = false;
                }
                const defaults = voiceCopyDefaults({ irodoriAvailable: this.engines.some(item => item.id === 'irodori' && item.availability.state === 'available'),
                    falAvailable: this.engines.some(item => item.id === 'fal-qwen3' && item.availability.state === 'available'),
                    consentCloud: this.consentCloud, scriptOk: this.check!.checks.script.ok });
                this.selected = defaults; this.step = 'copy';
            } else if (this.step === 'copy') {
                if (this.selected.includes('fal-qwen3')) {
                    const approved = await new ConfirmDialog({ title: '費用承認', msg: 'fal.ai に録音を送って声をつくります。見積 約 $0.01。続けますか？', ok: '費用承認する', cancel: 'キャンセル' }).open();
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
                    this.note.textContent = `${engine} の写しを作っています…`;
                    await this.service.voiceCopy({ profile: this.profile, engine, irodoriUrl: this.irodoriUrl(), approved: engine === 'fal-qwen3' });
                    this.copied.push(engine);
                }
                this.step = voiceNextStep('copy', 1, this.copied.length);
                for (const engine of this.copied) await this.tryEngine(engine);
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
                const ok = await new ConfirmDialog({ title: '費用承認', msg: 'fal.ai で試しの音声を作ります。読み上げ $0.09 / 1000 字。続けますか？', ok: '費用承認する', cancel: 'キャンセル' }).open();
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
