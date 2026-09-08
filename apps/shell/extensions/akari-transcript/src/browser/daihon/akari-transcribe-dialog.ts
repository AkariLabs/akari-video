import { ApplicationShell, OpenerService, open } from '@theia/core/lib/browser';
import { AbstractDialog, ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { CommandService } from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AkariProjectService, MaterialTranscriptEvent, TranscribeArtifacts, TranscribeOptions } from 'akari-project/lib/common/akari-project-protocol';
import { transcribeEngineAvailability, TranscribeToolStatus, TranscribeConnectionStatus, advanceTranscribeSteps, backendKey, completedColumns, initialEngineSelection, startTranscribeSteps, transcribeExitOptions, transcribeSummary, TranscribeDialogResult, TranscribeExit, TranscribeStepState } from '../../common/transcribe-steps';
import { AKARI_TRANSCRIPT_SEEK_REQUESTED } from '../akari-transcript-commands';

// Radar values: explainers/2026-09-07-transcribe-four-screens-v2-fix2.html.
// Cloud rtf/hourlyUsd: skills/analyze-footage/bin/transcribe-cloud.mjs PROVIDERS.
// Local figures are predictions, shown with dashed radar outlines, never detection results.
export const TRANSCRIBE_ENGINE_CARDS = [
    { id: 'speech-analyzer', label: 'SpeechAnalyzer', place: 'この Mac', hourlyUsd: 0, rtf: 0.08, predicted: true,
        radar: [.95, .75, .8, .3, .8], color: '#4fc3c0', needs: 'macOS 26 + CLT', facts: '句読点あり / フィラーは落ちやすい' },
    { id: 'whisper-cpp', label: 'Whisper · large-v3-turbo', place: 'この Mac', hourlyUsd: 0, rtf: .47, predicted: true,
        radar: [.4, .8, .8, .75, .85], color: '#b08cf0', needs: '同梱バイナリ + モデル', facts: '句読点あり / フィラーを残す' },
    { id: 'cloud:scribe', label: 'ElevenLabs Scribe', place: 'クラウド', hourlyUsd: .40, rtf: .025, predicted: false,
        radar: [.85, .9, .95, .95, .85], color: '#6fa8ff', needs: 'ElevenLabs の鍵・接続確認', facts: '句読点・フィラーを残す' },
    { id: 'cloud:groq', label: 'Groq Whisper', place: 'クラウド', hourlyUsd: .04, rtf: .002, predicted: false,
        radar: [1, .7, .1, .2, .7], color: '#f2b25c', needs: 'Groq の鍵・接続確認 / 25 MB まで', facts: '句読点なし / フィラーは落ちる' }
];
export function transcribeElement<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node;
}
export function transcribeButton(label: string, action: () => void, disabled = false): HTMLButtonElement {
    const button = transcribeElement('button', label); button.type = 'button'; button.disabled = disabled;
    Object.assign(button.style, { padding: '6px 10px', borderRadius: '6px', border: '1px solid #434952', background: '#292e36', color: 'inherit', cursor: disabled ? 'default' : 'pointer' });
    button.addEventListener('click', action); return button;
}

/** The raw preview's seek protocol plus its existing message transport, scoped to this asset.
 * Playback ticks stop the range at the actual media clock (no wall-clock timeout). */
export async function listenTranscribeRange(commands: CommandService, shell: ApplicationShell,
    opener: OpenerService, videoUri: string, start: number, end?: number): Promise<() => void> {
    await open(opener, new URI(videoUri));
    const widget = shell.widgets.find(value => {
        const preview = value as unknown as { akariPreviewVideoUri?: URI; akariPreviewEditUri?: URI };
        return !preview.akariPreviewEditUri && preview.akariPreviewVideoUri?.normalizePath().toString() === videoUri;
    }) as unknown as { sendMessage(message: unknown): void; akariPreviewLastKnownPlaying?: boolean; akariPreviewLastKnownTime?: number; onDidDispose(callback: () => void): { dispose(): void } };
    if (!widget) throw new Error('対象素材のプレビューを開けませんでした');
    if (end === undefined) {
        const result = await commands.executeCommand<string>(AKARI_TRANSCRIPT_SEEK_REQUESTED.id, { videoUri, time: start, captionId: 'transcribe-diff' });
        if (result !== 'seeked') throw new Error('対象素材へシークできませんでした');
        return () => undefined;
    }
    // The host seek is coalesced to rAF. Wait for the media clock to reach the start
    // before playing, otherwise a tick at the previous location could end the range.
    await new Promise<void>((resolve, reject) => {
        const ready = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail?.mediaUri === videoUri && Math.abs(detail.sourceT - start) < .1) finish();
        };
        const finish = (error?: Error) => {
            clearTimeout(timer); window.removeEventListener('akari.preview.rawAnnotationState', ready);
            if (error) reject(error); else resolve();
        };
        const timer = setTimeout(() => finish(new Error('プレビューのシークを確認できませんでした')), 5000);
        window.addEventListener('akari.preview.rawAnnotationState', ready);
        if (widget.akariPreviewLastKnownPlaying) widget.sendMessage({ type: 'akari-preview-toggle-playback' });
        void commands.executeCommand<string>(AKARI_TRANSCRIPT_SEEK_REQUESTED.id, { videoUri, time: start, captionId: 'transcribe-diff' }).then(result => {
            if (result !== 'seeked') finish(new Error('対象素材へシークできませんでした'));
            else if (Math.abs((widget.akariPreviewLastKnownTime ?? -Infinity) - start) < .1) finish();
        }, error => finish(error));
    });
    let disposed = false;
    const stop = () => {
        if (disposed) return;
        disposed = true;
        window.removeEventListener('akari.preview.rawAnnotationState', tick);
        if (widget.akariPreviewLastKnownPlaying) widget.sendMessage({ type: 'akari-preview-toggle-playback' });
        disposeListener.dispose();
    };
    const tick = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.mediaUri === videoUri && detail.sourceT >= end) stop();
    };
    const disposeListener = widget.onDidDispose(stop);
    window.addEventListener('akari.preview.rawAnnotationState', tick);
    if (!widget.akariPreviewLastKnownPlaying) widget.sendMessage({ type: 'akari-preview-toggle-playback' });
    return stop;
}

export class AkariTranscribeDialog extends AbstractDialog<TranscribeDialogResult | undefined> {
    protected artifacts: TranscribeArtifacts = { transcripts: [], diff: null, cuts: null };
    protected selection: { backend: string; compareSet: string[] };
    protected state: TranscribeStepState = { step: 1, engines: {}, completedOrder: [], finished: false };
    protected readonly body = transcribeElement('div');
    protected readonly steps = transcribeElement('nav');
    protected readonly foot = transcribeElement('div');
    protected readonly notice = transcribeElement('p');
    protected readonly seen = new Set<string>();
    protected eventTail = Promise.resolve();
    protected running = false;
    protected result: TranscribeDialogResult | undefined;
    // AbstractDialog wires acceptButton to immediate acceptance on attach; our start button is async.
    protected defaultButton: HTMLButtonElement | undefined;
    protected baselineReady = false;
    protected artifactsLoaded = false;
    protected approved = false;
    protected ready: Promise<void>;
    protected eventFloor = '';
    protected confirming = false;
    protected toolStatus: TranscribeToolStatus[] | undefined;
    protected connectionStatus: TranscribeConnectionStatus[] | undefined;
    protected checkingAvailability = false;

    constructor(protected readonly root: URI, protected readonly relativePath: string,
        protected readonly preferences: PreferenceService, protected readonly service: AkariProjectService,
        protected readonly files: FileService, protected readonly commands: CommandService,
        protected readonly listen: (start: number, end: number) => Promise<void>,
        protected readonly alreadyTranscribed = false) {
        super({ title: '文字起こしして字幕を作る' });
        this.selection = initialEngineSelection(preferences.get('akari.transcribe.backend', 'auto'), preferences.get<string[]>('akari.transcribe.compareSet', []));
        this.node.dataset.akariTranscribeDialog = 'true';
        Object.assign(this.contentNode.parentElement!.style, { width: 'min(1060px, calc(100vw - 48px))', height: 'min(730px, calc(100vh - 48px))', minWidth: '0', borderRadius: '12px', background: '#20242b' });
        Object.assign(this.contentNode.style, { padding: '0', display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', maxHeight: 'none', color: '#e9ecf2' });
        Object.assign(this.steps.style, { display: 'flex', flexWrap: 'wrap', gap: '7px', padding: '14px', borderBottom: '1px solid #434952' });
        Object.assign(this.body.style, { flex: '1', overflow: 'auto', minHeight: '0', padding: '14px' });
        Object.assign(this.foot.style, { display: 'flex', gap: '8px', alignItems: 'center', padding: '14px', flexWrap: 'wrap', borderTop: '1px solid #434952' });
        this.notice.style.margin = '4px 14px'; this.notice.setAttribute('role', 'status');
        this.controlPanel.style.display = 'none';
        this.contentNode.append(this.steps, this.body, this.notice, this.foot);
        this.ready = this.initialize().catch(error => { this.notice.textContent = String(error); });
        this.render();
        void this.refreshAvailability();
    }
    get value(): TranscribeDialogResult | undefined { return this.result; }
    protected override handleEnter(event: KeyboardEvent): boolean {
        if (event.isComposing || event.repeat || event.target instanceof HTMLTextAreaElement || this.running || this.confirming) return false;
        if (event.target instanceof HTMLButtonElement && event.target !== this.defaultButton) return false;
        if (!this.defaultButton || this.defaultButton.disabled) return false;
        this.defaultButton.click();
        return true;
    }
    protected reuse(): void {
        if (!this.baselineReady || this.running || this.confirming) return;
        this.result = transcribeExitOptions('reuse', this.selection);
        void this.accept();
    }
    protected async initialize(): Promise<void> {
        this.artifacts = await this.service.readTranscribeArtifacts({ projectRoot: this.root.toString(), relativePath: this.relativePath });
        this.baselineReady = this.alreadyTranscribed || this.artifacts.transcripts.length > 0;
        this.artifactsLoaded = true;
        this.render();
        this.toDispose.push(await this.files.watch(this.root.resolve('.akari'), { recursive: true, excludes: [] }));
        this.toDispose.push(this.files.onDidFilesChange(event => {
            for (const change of event.changes) {
                if (this.running && this.root.resolve('.akari/events').isEqualOrParent(change.resource) && change.resource.path.ext === '.json') {
                    this.eventTail = this.eventTail.then(() => this.consumeEvent(change.resource)).catch(error => { this.notice.textContent = String(error); });
                }
            }
        }));
        this.render();
    }
    protected async consumeEvent(uri: URI): Promise<void> {
        const event: MaterialTranscriptEvent = JSON.parse((await this.files.readFile(uri)).value.toString());
        if (event.type !== 'material-transcript' || event.relativePath !== this.relativePath || this.seen.has(event.id) || event.id < this.eventFloor) return;
        this.seen.add(event.id);
        this.state = advanceTranscribeSteps(this.state, event);
        if (event.status === 'completed') this.artifacts = await this.service.readTranscribeArtifacts({ projectRoot: this.root.toString(), relativePath: this.relativePath });
        if (event.error) this.notice.textContent = event.error;
        this.render();
    }
    protected render(): void {
        this.node.dataset.step = String(this.state.step);
        this.steps.replaceChildren();
        ['1 エンジン', '2 起こす', '3 差分', '4 注釈・辞書〔先〕', '5 まとめ〔先〕', '› 字幕へ'].forEach((label, index) => {
            const disabled = index >= 3 || (index === 2 ? !this.artifacts.diff : index + 1 > this.state.step) || (index === 0 && this.running);
            const button = transcribeButton(label, () => {
                if (index === 0 && !this.running) this.state.step = 1;
                else if (index === 2 && this.artifacts.diff) this.state.step = 3;
                else if (index === 1) this.state.step = 2;
                this.render();
            }, disabled);
            if (index + 1 === this.state.step) { button.style.borderColor = '#f0832b'; button.setAttribute('aria-current', 'step'); }
            if (index === 3 || index === 4) button.style.borderStyle = 'dashed';
            this.steps.append(button);
        });
        this.body.replaceChildren(); this.foot.replaceChildren();
        this.defaultButton = undefined;
        if (this.state.step === 1) this.renderCards();
        else if (this.state.step === 2) this.renderProgress();
        else this.renderDiff();
        if (this.state.step === 1) {
            this.foot.append(transcribeElement('span', 'この場の選択だけに適用'));
            if (this.baselineReady) {
                this.defaultButton = transcribeButton('このまま字幕へ', () => this.reuse());
                this.defaultButton.style.borderColor = '#f0832b';
                this.foot.append(this.defaultButton, transcribeButton('起こし直す', () => void this.start('redo')),
                    transcribeButton('比べる', () => void this.start('compare'), this.selection.compareSet.length < 2));
            } else {
                this.defaultButton = transcribeButton('起こす ▸', () => void this.start(), !this.artifactsLoaded);
                this.foot.append(this.defaultButton);
            }
        }
        else {
            this.foot.append(transcribeElement('span', this.state.step === 3 ? 'まとめは先の機能' : '先に終わったエンジンから列が埋まります'));
            if ((this.state.finished || this.artifacts.diff) && !this.running) {
                this.foot.append(transcribeButton(`${this.artifacts.transcripts.length} つとも残す（何もしない）`, () => this.close()));
                this.defaultButton = transcribeButton('字幕へ', () => this.reuse(), !this.baselineReady);
                this.foot.append(this.defaultButton);
                if (!this.baselineReady) this.foot.append(transcribeButton('エンジンを選び直す', () => { this.state.step = 1; this.render(); }));
            }
        }
    }
    protected async refreshAvailability(): Promise<void> {
        if (this.checkingAvailability || this.isDisposed) { return; }
        this.checkingAvailability = true;
        this.render();
        await Promise.all([
            this.commands.executeCommand<{ tools: TranscribeToolStatus[] }>('akari.settings.readStatus', '/services/akari-surfaces-new-project')
                .then(result => { this.toolStatus = result?.tools ?? []; }, () => { this.toolStatus = []; }),
            this.commands.executeCommand<{ providers: TranscribeConnectionStatus[] }>('akari.settings.readStatus', '/services/akari-surfaces-connections')
                .then(result => { this.connectionStatus = result?.providers ?? []; }, () => { this.connectionStatus = []; })
        ]);
        this.checkingAvailability = false;
        if (!this.isDisposed) { this.render(); }
    }

    protected renderCards(): void {
        for (const line of transcribeSummary(this.artifacts, this.alreadyTranscribed)) this.body.append(transcribeElement('p', line));
        const auto = transcribeElement('label');
        const radio = transcribeElement('input'); radio.type = 'radio'; radio.name = 'transcribe-engine'; radio.checked = this.selection.backend === 'auto';
        radio.onchange = () => { this.selection.backend = 'auto'; };
        auto.append(radio, 'おまかせ（ローカル優先）'); this.body.append(auto);
        this.body.append(transcribeButton(this.checkingAvailability ? '確認中…' : '確認し直す', () => void this.refreshAvailability(), this.checkingAvailability));
        const cards = transcribeElement('div'); Object.assign(cards.style, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px', marginTop: '14px' });
        for (const engine of TRANSCRIBE_ENGINE_CARDS) {
            const card = transcribeElement('section'); card.dataset.backend = engine.id;
            Object.assign(card.style, { padding: '14px', border: '1px solid #434952', borderRadius: '10px', background: '#292e36', minWidth: '0' });
            card.append(transcribeElement('strong', engine.label));
            const statusLoaded = engine.id.startsWith('cloud:') ? this.connectionStatus !== undefined : this.toolStatus !== undefined;
            if (!statusLoaded) {
                card.append(transcribeElement('p', '確認中…'));
            } else {
                const availability = transcribeEngineAvailability(engine.id, this.toolStatus ?? [], this.connectionStatus ?? []);
                const badge = availability.state === 'needs' || availability.state === 'unconfigured'
                    ? transcribeButton(availability.label, () => {
                        void this.commands.executeCommand('akari.settings.open', availability.state === 'unconfigured' ? 'connections' : 'tools')
                            .then(() => this.refreshAvailability(), error => { this.notice.textContent = String(error); });
                    })
                    : transcribeElement('span', availability.label);
                badge.dataset.akariEngineAvailability = availability.state;
                badge.setAttribute('role', availability.state === 'needs' || availability.state === 'unconfigured' ? 'button' : 'status');
                Object.assign(badge.style, { display: 'inline-block', margin: '6px 0 0 8px', fontSize: '12px', lineHeight: '1.5' });
                card.append(badge);
            }
            const known = this.artifacts.transcripts.some(item => item.backend === backendKey(engine.id));
            card.append(transcribeElement('p', `${known ? '起こした結果あり' : '未確認'} · ${engine.place} · ${engine.hourlyUsd ? `$${engine.hourlyUsd.toFixed(2)} / 時` : '無料'}`));
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 220 130'); svg.style.width = '200px'; svg.setAttribute('aria-label', '速度・精度・句読点・フィラー・日本語の5軸');
            const point = (i: number, scale: number) => [110 + Math.cos(-Math.PI / 2 + i * Math.PI * 2 / 5) * 42 * scale, 65 + Math.sin(-Math.PI / 2 + i * Math.PI * 2 / 5) * 42 * scale];
            for (const scale of [.33, .66, 1]) {
                const polygon = document.createElementNS(svg.namespaceURI, 'polygon'); polygon.setAttribute('points', engine.radar.map((_, i) => point(i, scale).join(',')).join(' ')); polygon.setAttribute('fill', 'none'); polygon.setAttribute('stroke', '#58606d'); svg.append(polygon);
            }
            const polygon = document.createElementNS(svg.namespaceURI, 'polygon'); polygon.setAttribute('points', engine.radar.map((v, i) => point(i, v).join(',')).join(' ')); polygon.setAttribute('fill', engine.color); polygon.setAttribute('fill-opacity', '.2'); polygon.setAttribute('stroke', engine.color); if (engine.predicted) polygon.setAttribute('stroke-dasharray', '4 3'); svg.append(polygon);
            ['速度', '精度', '句読点', 'フィラー', '日本語'].forEach((label, i) => { const text = document.createElementNS(svg.namespaceURI, 'text'); const [x, y] = point(i, 1.4); text.setAttribute('x', String(x)); text.setAttribute('y', String(y)); text.setAttribute('fill', '#b5becb'); text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', '10'); text.textContent = label; svg.append(text); });
            card.append(svg, transcribeElement('div', `${engine.facts}${engine.predicted ? ' / 数値は予測（点線）' : ''}`), transcribeElement('p', `要るもの: ${engine.needs}`));
            const use = transcribeElement('label'), useInput = transcribeElement('input'); useInput.type = 'radio'; useInput.name = 'transcribe-engine'; useInput.checked = this.selection.backend === engine.id;
            useInput.onchange = () => { this.selection.backend = engine.id; }; use.append(useInput, '使う ');
            const compare = transcribeElement('label'), checkbox = transcribeElement('input'); checkbox.type = 'checkbox'; checkbox.checked = this.selection.compareSet.includes(engine.id);
            checkbox.onchange = () => {
                this.selection.compareSet = checkbox.checked ? [...this.selection.compareSet, engine.id] : this.selection.compareSet.filter(id => id !== engine.id);
                const compareButton = Array.from(this.foot.querySelectorAll('button')).find(button => button.textContent === '比べる');
                if (compareButton) compareButton.disabled = this.selection.compareSet.length < 2;
            };
            compare.append(checkbox, '比べるときに使う'); card.append(use, compare); cards.append(card);
        }
        const fal = transcribeElement('section');
        Object.assign(fal.style, { padding: '14px', border: '1px dashed #434952', borderRadius: '10px' });
        fal.append(transcribeElement('strong', 'fal.ai · おすすめ'), transcribeElement('p', '1 つの鍵で画像生成・動画生成・文字起こし'),
            transcribeElement('p', 'クラウド · 従量 · 未計測 / 要るもの: fal.ai の鍵'),
            transcribeButton('設定で登録', () => { void this.commands.executeCommand('akari.settings.open'); }));
        cards.append(fal);
        this.body.append(cards);
    }
    protected renderProgress(): void {
        for (const [backend, status] of Object.entries(this.state.engines)) {
            const transcript = this.artifacts.transcripts.find(item => item.backend === backend);
            this.body.append(transcribeElement('p', `${backend} · ${{ waiting: '待機', transcribing: '起こし中', completed: `完了 · ${transcript?.elapsed_sec?.toFixed(1) ?? '—'} 秒`, failed: '失敗' }[status]}`));
        }
        const columns = transcribeElement('div'); Object.assign(columns.style, { display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Object.keys(this.state.engines).length)}, minmax(0, 1fr))`, gap: '12px' });
        const completed = completedColumns(this.state, this.artifacts.transcripts);
        for (const backend of Object.keys(this.state.engines)) {
            const column = transcribeElement('section'); column.dataset.engineColumn = backend; column.append(transcribeElement('strong', backend));
            const transcript = completed.find(item => item.backend === backend);
            if (transcript) for (const segment of transcript.segments) column.append(transcribeElement('p', `${segment.start.toFixed(1)} · ${segment.text}`));
            else column.append(transcribeElement('p', '…'));
            columns.append(column);
        }
        this.body.append(columns);
    }
    protected renderDiff(): void {
        const diff = this.artifacts.diff;
        if (!diff) { this.body.append(transcribeElement('p', '差分を読み込み中…')); return; }
        this.body.append(transcribeElement('p', `差分 ${diff.items.length} 件 · 一致 ${Math.round(diff.agreement * 100)}%`));
        const table = transcribeElement('table'); Object.assign(table.style, { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' });
        const head = transcribeElement('tr'); for (const label of ['時刻', ...diff.engines, '人の手']) head.append(transcribeElement('th', label)); table.append(head);
        for (const item of diff.items) {
            const row = transcribeElement('tr'); row.append(transcribeElement('td', `${item.start.toFixed(1)}–${item.end.toFixed(1)}`));
            for (const engine of diff.engines) row.append(transcribeElement('td', item.texts[engine] || '—'));
            const actions = transcribeElement('td'); actions.append(transcribeButton('▶ 聞く', () => { void this.listen(item.start, item.end).catch(error => { this.notice.textContent = String(error); }); }), transcribeButton('辞書へ〔先〕', () => undefined, true), transcribeButton('注釈〔先〕', () => undefined, true)); row.append(actions);
            for (const cell of Array.from(row.children) as HTMLElement[]) Object.assign(cell.style, { padding: '10px 6px', borderBottom: '1px solid #434952', verticalAlign: 'top', overflowWrap: 'anywhere' });
            table.append(row);
        }
        this.body.append(table);
    }
    protected async start(exit?: Exclude<TranscribeExit, 'reuse'>): Promise<void> {
        if (this.running || this.confirming) return;
        this.confirming = true;
        try {
        await this.ready;
        const options: TranscribeOptions | undefined = exit ? transcribeExitOptions(exit, this.selection)
            : { ...this.selection, compareSet: [...this.selection.compareSet] };
        if (!options) return;
        const backends = options.compareSet?.length ? options.compareSet : [options.backend || 'auto'];
        const clouds = TRANSCRIBE_ENGINE_CARDS.filter(engine => backends.includes(engine.id) && engine.hourlyUsd);
        if (clouds.length) {
            // Probe is read-only; estimate from source metadata, never from a guessed duration.
            const analysisUri = this.root.resolve(`.akari/sidecars/${this.relativePath}.analysis/analysis.json`);
            let duration: number | undefined;
            try { const analysis = JSON.parse((await this.files.readFile(analysisUri)).value.toString()); duration = analysis.probe?.duration_s; } catch { /* Unknown estimate is explicit. */ }
            const cost = typeof duration === 'number' ? `$${(duration / 3600 * clouds.reduce((sum, engine) => sum + engine.hourlyUsd, 0)).toFixed(4)}` : `$${clouds.reduce((sum, engine) => sum + engine.hourlyUsd, 0).toFixed(2)} / 時（尺未取得）`;
            this.approved = !!await new ConfirmDialog({ title: '音声の送信', msg: `音声を ${clouds.map(engine => engine.label).join('・')} に送ります。約 ${cost}`, ok: '送って起こす', cancel: 'キャンセル' }).open();
            if (!this.approved) return;
        }
        if (this.isDisposed) return;
        if (exit) {
            this.result = transcribeExitOptions(exit, { ...options, approved: this.approved, autoCuts: this.preferences.get('akari.transcribe.autoCuts', true) });
            void this.accept();
            return;
        }
        this.eventFloor = new Date().toISOString().replace(/[:.]/g, '-');
        this.running = true; this.baselineReady = false; this.seen.clear(); this.notice.textContent = '';
        this.state = startTranscribeSteps(backends); this.render();
        try {
            await this.service.transcribeMaterial({ projectRoot: this.root.toString(), relativePath: this.relativePath, ...options, approved: this.approved, autoCuts: this.preferences.get('akari.transcribe.autoCuts', true) });
            this.baselineReady = true;
        } catch (error) { this.notice.textContent = String(error); }
        finally {
            // Scan at RPC completion as well: file watcher delivery may be coalesced or late.
            try {
                const events = await this.files.resolve(this.root.resolve('.akari/events'));
                for (const event of [...(events.children ?? [])].sort((a, b) => a.resource.toString().localeCompare(b.resource.toString()))) if (event.resource.path.ext === '.json') await this.consumeEvent(event.resource);
                await this.eventTail;
                this.artifacts = await this.service.readTranscribeArtifacts({ projectRoot: this.root.toString(), relativePath: this.relativePath });
            } catch (error) { this.notice.textContent = String(error); }
            this.baselineReady ||= this.state.engines[backendKey(backends[0])] === 'completed';
            this.running = false; this.state.finished = true; this.render();
            if (backends.length === 1 && this.baselineReady && !this.isDisposed) { this.result = transcribeExitOptions('reuse', options); void this.accept(); }
        }
        } finally { this.confirming = false; }
    }
}
