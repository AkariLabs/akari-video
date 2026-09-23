import URI from '@theia/core/lib/common/uri';
import { AbstractDialog, ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { CommandService } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { AkariAnnotationsService, GenerateNarrationResult, NarrationEngine, NarrationVoice } from '../../common/akari-annotations-protocol';
import { compareNarrationDuration, narrationEstimate, readAloudPreviewPlan, selectReadAloudEngine, selectReadAloudVoice } from '../../common/read-aloud-model';

export interface ReadAloudTarget {
    captionIds: string[]; captionId?: string; text: string; start: number; end?: number;
    frameSeconds?: number; timeDomain?: 'source' | 'output'; projectRootUri: string;
}
export interface ReadAloudPlacement { result: GenerateNarrationResult; script: string; reading: string; t: number;
    captionId?: string; extendEnd?: number }

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, content?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); if (content !== undefined) node.textContent = content; return node;
};

export class AkariReadAloudDialog extends AbstractDialog<ReadAloudPlacement | undefined> {
    protected readonly body = element('div');
    protected readonly cards = element('div');
    protected readonly voiceSelect = element('select');
    protected readonly reading = element('textarea');
    protected readonly freeScript = element('textarea');
    protected readonly speed = element('input');
    protected readonly speedRow = element('label');
    protected readonly styleInput = element('input');
    protected readonly styleRow = element('label');
    protected readonly estimate = element('div');
    protected readonly resultNode = element('div');
    protected readonly notice = element('div');
    protected readonly foot = element('div');
    protected readonly footnote = element('span');
    protected readonly previewButton = element('button', '▶ 試聴');
    protected readonly placeButton = element('button', '置く');
    protected engines: NarrationEngine[] = [];
    protected engine?: NarrationEngine;
    protected voices: NarrationVoice[] = [];
    protected result?: GenerateNarrationResult;
    protected audioUrl?: string;
    protected running = false;
    protected overflowChoice: 'extend' | 'retry' | 'keep' = 'extend';
    protected placement?: ReadAloudPlacement;

    constructor(protected readonly target: ReadAloudTarget, protected readonly service: AkariAnnotationsService,
        protected readonly files: FileService, protected readonly preferences: PreferenceService,
        protected readonly commands: CommandService,
        protected readonly onPlace: (placement: ReadAloudPlacement) => Promise<void>) {
        super({ title: '読み上げ' });
        this.node.dataset.akariReadAloudDialog = 'true';
        this.controlPanel.style.display = 'none';
        Object.assign(this.contentNode.parentElement!.style, { width: 'min(760px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 40px)', borderRadius: '12px' });
        Object.assign(this.contentNode.style, { padding: '0', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: 'calc(100vh - 80px)' });
        Object.assign(this.body.style, { padding: '16px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' });
        Object.assign(this.cards.style, { display: 'flex', gap: '8px' });
        this.body.append(element('h2', target.captionId ? '読み上げ — この 1 行' : '読み上げ — 自由入力'));
        if (target.captionIds.length > 1) this.body.append(element('p', '先頭の 1 行だけ。まとめて作るは次の版'));
        if (target.captionId) {
            this.body.append(element('div', target.text), element('small', '表示は字幕のまま。読みだけ直す'));
            this.reading.value = target.text;
        } else {
            this.freeScript.placeholder = '読ませたい文を打つ';
            this.freeScript.setAttribute('aria-label', '読ませたい文を打つ');
            this.body.append(this.freeScript);
            this.freeScript.addEventListener('input', () => { this.invalidate(); this.updateEstimate(); });
        }
        this.body.append(this.cards);
        this.voiceSelect.setAttribute('aria-label', '声');
        this.voiceSelect.addEventListener('change', () => { this.invalidate(); this.updateEstimate(); void this.saveVoice(); });
        this.body.append(element('label', '声'), this.voiceSelect);
        this.speed.type = 'range'; this.speed.min = '0.5'; this.speed.max = '2'; this.speed.step = '0.05'; this.speed.value = '1';
        this.speedRow.append(element('span', '速さ '), this.speed, element('span', '1.00×'));
        this.speed.addEventListener('input', () => { this.speedRow.lastElementChild!.textContent = `${Number(this.speed.value).toFixed(2)}×`; this.invalidate(); });
        this.body.append(this.speedRow);
        this.styleInput.placeholder = '話し方の指示（任意）'; this.styleInput.setAttribute('aria-label', '話し方の指示（任意）');
        this.styleRow.append(element('span', '話し方の指示（任意） '), this.styleInput);
        this.styleInput.addEventListener('input', () => this.invalidate());
        this.body.append(this.styleRow);
        this.reading.placeholder = '読み原稿'; this.reading.setAttribute('aria-label', '読み原稿');
        this.reading.addEventListener('input', () => { this.invalidate(); this.updateEstimate(); });
        this.body.append(element('label', '読み原稿'), this.reading, this.estimate, this.resultNode, this.notice);
        Object.assign(this.foot.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderTop: '1px solid #555' });
        this.footnote.style.flex = '1';
        this.previewButton.dataset.readAloudAction = 'preview';
        this.placeButton.dataset.readAloudAction = 'place';
        this.previewButton.disabled = true;
        this.previewButton.addEventListener('click', () => void this.preview());
        this.placeButton.disabled = true;
        this.placeButton.addEventListener('click', () => void this.place());
        this.foot.append(this.footnote, this.previewButton, this.placeButton);
        this.contentNode.append(this.body, this.foot);
        this.toDispose.push({ dispose: () => {
            if (this.running) void this.service.cancelNarration(this.target.projectRootUri);
            if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
        } });
        void this.refreshEngines();
    }

    get value(): ReadAloudPlacement | undefined { return this.placement; }
    protected override handleEnter(_event: KeyboardEvent): boolean { return false; }
    protected script(): string { return this.target.captionId ? this.target.text : this.freeScript.value; }
    protected readingText(): string { return this.reading.value.trim() || this.script(); }
    protected invalidate(): void { this.result = undefined; this.placeButton.disabled = true; this.resultNode.replaceChildren(); }

    protected async refreshEngines(): Promise<void> {
        try {
            const response = await this.service.listNarrationEngines(this.target.projectRootUri);
            this.engines = response.engines.filter(engine => ['voicevox', 'gemini-tts', 'irodori'].includes(engine.id));
            const preferred = this.preferences.get<string>('akari.narration.engine', 'voicevox');
            const selected = selectReadAloudEngine(this.engines, preferred);
            this.cards.replaceChildren();
            for (const engine of this.engines) {
                const card = element('section'); card.dataset.engine = engine.id;
                Object.assign(card.style, { flex: '1', padding: '10px', border: '1px solid #777', borderRadius: '8px', opacity: engine.availability.state === 'unsupported' ? '.5' : '1' });
                const radio = element('input'); radio.type = 'radio'; radio.name = 'read-aloud-engine'; radio.value = engine.id;
                radio.disabled = engine.availability.state !== 'available'
                    && !(engine.id === 'voicevox' && engine.availability.state === 'needs');
                radio.checked = selected?.id === engine.id;
                radio.addEventListener('change', () => void this.chooseEngine(engine));
                card.append(radio, element('strong', engine.label), element('div', engine.place === 'local' ? 'この Mac · 無料' :
                    `クラウド · fal.ai 経由 · $${engine.price?.usd_per_1000_chars ?? 0} / 1000 字${engine.price?.verified === false ? '（暫定）' : ''}`));
                const badge = engine.availability.state === 'needs' || engine.availability.state === 'unconfigured'
                    ? element('button', engine.availability.label) : element('span', engine.availability.label);
                badge.dataset.availability = engine.availability.state;
                if (badge instanceof HTMLButtonElement) badge.addEventListener('click', () => {
                    void this.commands.executeCommand('akari.settings.open', engine.availability.state === 'unconfigured' ? 'connections' : 'tools')
                        .then(() => this.refreshEngines());
                });
                card.append(badge); this.cards.append(card);
            }
            if (selected) await this.chooseEngine(selected);
        } catch (error) { this.notice.textContent = String(error); }
    }

    protected async chooseEngine(engine: NarrationEngine): Promise<void> {
        if (engine.availability.state !== 'available'
            && !(engine.id === 'voicevox' && engine.availability.state === 'needs')) return;
        this.engine = engine; this.invalidate();
        this.previewButton.disabled = true;
        this.cards.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach(radio => { radio.checked = radio.value === engine.id; });
        this.speedRow.style.display = engine.supports?.speed ? '' : 'none';
        this.styleRow.style.display = engine.supports?.style ? '' : 'none';
        const plan = readAloudPreviewPlan(engine, this.readingText());
        this.previewButton.textContent = plan.buttonLabel;
        this.footnote.textContent = plan.footnote;
        await this.preferences.set('akari.narration.engine', engine.id, PreferenceScope.User);
        try {
            const response = await this.service.listNarrationVoices(this.target.projectRootUri, engine.id);
            if (this.engine !== engine) return;
            this.voices = response.voices;
            this.voiceSelect.replaceChildren(...response.voices.map(voice => {
                const option = element('option', voice.label); option.value = voice.id; return option;
            }));
            const saved = this.preferences.get<Record<string, string>>('akari.narration.voice', {});
            this.voiceSelect.value = selectReadAloudVoice(response.voices, saved[engine.id])?.id ?? '';
            this.previewButton.disabled = !this.voiceSelect.value;
            this.updateEstimate();
        } catch (error) { this.notice.textContent = String(error); }
    }
    protected async saveVoice(): Promise<void> {
        if (!this.engine) return;
        const saved = this.preferences.get<Record<string, string>>('akari.narration.voice', {});
        await this.preferences.set('akari.narration.voice', { ...saved, [this.engine.id]: this.voiceSelect.value }, PreferenceScope.User);
    }
    protected updateEstimate(): void {
        if (!this.engine) return;
        const quote = narrationEstimate(this.engine, this.readingText());
        const voice = this.voices.find(item => item.id === this.voiceSelect.value);
        this.estimate.textContent = `${this.engine.label} · 対象 1 行 · ${quote.chars} 字 · ${quote.label}${this.engine.id === 'voicevox' && voice?.group ? ` · クレジット VOICEVOX:${voice.group}` : ''}`;
    }

    protected async preview(): Promise<void> {
        if (!this.engine || this.running || !this.script().trim()) return;
        const engine = this.engine;
        const reading = this.readingText();
        const plan = readAloudPreviewPlan(engine, reading);
        let approved = false;
        if (plan.needsApproval) {
            approved = await new ConfirmDialog(plan.confirm!).open();
            if (!approved) return;
        }
        this.running = true; this.previewButton.disabled = true; this.previewButton.textContent = '生成中…'; this.notice.textContent = '';
        try {
            const result = await this.service.generateNarration({ projectRootUri: this.target.projectRootUri,
                engine: engine.id, voice: this.voiceSelect.value, speed: engine.supports?.speed ? Number(this.speed.value) : undefined,
                style: engine.supports?.style ? this.styleInput.value : undefined, script: this.script(), reading,
                captionId: this.target.captionId ?? null, t: this.target.start, approved });
            if (result.status !== 'ok' || !result.path || result.duration_s === undefined) throw new Error('音声を生成できませんでした。');
            this.result = result;
            const file = await this.files.readFile(new URI(this.target.projectRootUri).resolve(result.path));
            if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = URL.createObjectURL(new Blob([file.value.buffer as ArrayBuffer], { type: result.path.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }));
            const audio = element('audio'); audio.controls = true; audio.src = this.audioUrl;
            const duration = result.duration_s;
            const frame = this.target.frameSeconds;
            const comparison = compareNarrationDuration(frame, duration, this.target.timeDomain, !!engine.supports?.speed);
            if (comparison.overflow === 0) this.overflowChoice = 'keep';
            this.resultNode.replaceChildren(audio, element('div', `字幕の枠 ${frame === undefined ? '—' : frame.toFixed(1) + ' s'} · できた音声 ${duration.toFixed(1)} s`));
            if (comparison.overflow > 0) {
                this.resultNode.append(element('div', `はみ出し +${comparison.overflow.toFixed(1)} s`));
                const options = element('div');
                const add = (choice: 'extend' | 'retry' | 'keep', label: string, disabled: boolean, title?: string): void => {
                    const line = element('label'); const radio = element('input'); radio.type = 'radio'; radio.name = 'read-aloud-overflow';
                    radio.value = choice; radio.disabled = disabled; radio.checked = choice === (comparison.extendEnabled ? 'extend' : 'keep');
                    if (title) line.title = title;
                    radio.addEventListener('change', () => { this.overflowChoice = choice; });
                    line.append(radio, element('span', label)); options.append(line);
                };
                this.overflowChoice = comparison.extendEnabled ? 'extend' : 'keep';
                add('extend', `字幕の枠を ${duration.toFixed(1)} s に伸ばす（既定）`, !comparison.extendEnabled,
                    this.target.timeDomain === 'source' ? '話した言葉の行は伸ばせません' : undefined);
                if (engine.supports?.speed) add('retry', `${comparison.recommendedSpeed.toFixed(2)}× で作り直す`, !comparison.retryEnabled);
                add('keep', 'そのまま置く（はみ出しは QC に残す）', false);
                this.resultNode.append(options);
            }
            this.placeButton.disabled = false;
        } catch (error) { this.notice.textContent = String(error); }
        finally { this.running = false; this.previewButton.disabled = false; this.previewButton.textContent = plan.buttonLabel; }
    }

    protected async place(): Promise<void> {
        if (!this.result || this.running) return;
        if (this.overflowChoice === 'retry') {
            const frame = this.target.frameSeconds ?? 0;
            const recommended = compareNarrationDuration(frame, this.result.duration_s ?? 0, this.target.timeDomain, true).recommendedSpeed;
            this.speed.value = String(recommended); this.invalidate(); await this.preview(); return;
        }
        this.placeButton.disabled = true;
        const placement: ReadAloudPlacement = { result: this.result, script: this.script(), reading: this.readingText(),
            t: this.target.start, captionId: this.target.captionId,
            ...(this.overflowChoice === 'extend' && this.target.end !== undefined && this.target.timeDomain === 'output'
                && (this.result.duration_s ?? 0) > (this.target.frameSeconds ?? Infinity)
                ? { extendEnd: this.target.start + (this.result.duration_s ?? 0) } : {}) };
        try { await this.onPlace(placement); this.placement = placement; await this.accept(); }
        catch (error) { this.notice.textContent = String(error); this.placeButton.disabled = false; }
    }
}
