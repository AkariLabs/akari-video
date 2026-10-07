import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { getCaptionDisplayWordStyle, setCaptionDisplayWordStyle, setSourceSyncGroup, type CaptionDisplayPolicy, type EditV2 } from '@akari-video/edit-store';
import { currentTimelineCaptionsUri, currentTimelineEditUri } from 'akari-annotations/lib/browser/active-timeline';
import { AkariAnnotationsService } from 'akari-annotations/lib/common/akari-annotations-protocol';
import { AkariProjectService, MaterialTranscriptEvent, TranscribeArtifacts } from 'akari-project/lib/common/akari-project-protocol';
import { CAPTION_IMAGE_EXTENSIONS, captionBgmSourceIds, captionSourceEligibility, isCaptionVideo,
    normalizedCaptionPath } from '../../common/caption-source-eligibility';
import { CaptionsApplyPreview, daihonHistoryService, parseCaptionsApplyPreview } from '../../common/captions-button';
import { readCaptionShape } from '../../common/caption-shape';
import { daihonDisplayPolicyForWrite, readDaihonDisplayKnobs } from '../../common/daihon-display-knobs';
import { planSpeechTightApply } from '../../common/daihon-gear';
import { collectDaihonCutCandidates } from '../../common/daihon-cut-candidates';
import { buildDaihonRows, type DaihonCaptionLike } from '../../common/daihon-row-model';
import { parseCaptions } from '../caption-store';
import { analysisTranscriptSummary, popupCanNavigate, popupInitialSourceIds, transcribeEngineAvailability,
    TranscribeConnectionStatus, TranscribeToolStatus } from '../../common/transcribe-steps';

export const TRANSCRIBE_ENGINE_CARDS = [
    { id: 'speech-analyzer', label: 'SpeechAnalyzer', place: 'このパソコン', hourlyUsd: 0, facts: '速い・送信なし' },
    { id: 'whisper-cpp', label: 'Whisper · large-v3-turbo', place: 'このパソコン', hourlyUsd: 0, facts: '句読点に強い・送信なし' },
    { id: 'cloud:scribe', label: 'ElevenLabs Scribe', place: 'クラウド', hourlyUsd: .40, facts: 'フィラーまで拾う' },
    { id: 'cloud:groq', label: 'Groq Whisper', place: 'クラウド', hourlyUsd: .04, facts: '速い' }
];

interface PopupSource {
    id: string; path: string; name: string; status: 'voice' | 'bgm' | 'excluded'; reason?: string;
    duration?: number; summary?: string; hasTranscript: boolean; unlisted?: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
};
const time = (seconds: number): string => {
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
const button = (label: string, action: () => void, disabled = false): HTMLButtonElement => {
    const node = el('button', label);
    node.type = 'button'; node.disabled = disabled;
    Object.assign(node.style, { padding: '9px 14px', borderRadius: '7px', border: '1px solid #58606d',
        background: '#303740', color: '#f1f3f7', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? '.48' : '1' });
    node.onclick = action;
    return node;
};

/** All five entrances use this dialog; each source is applied independently. */
export class AkariTranscribeDialog extends AbstractDialog<void> {
    protected readonly body = el('div');
    protected readonly steps = el('nav');
    protected readonly foot = el('div');
    protected readonly notice = el('p');
    protected editUri: URI | undefined;
    protected unsupportedTimeline = false;
    protected sources: PopupSource[] = [];
    protected videoSourceIds = new Set<string>();
    protected syncChoice = new Map<string, string>();
    protected initialSyncChoice = new Map<string, string>();
    protected selected = new Set<string>();
    protected step: 0 | 1 | 2 | 3 = 0;
    protected reached = 0;
    protected backend = 'auto';
    protected compare = false;
    protected compareSet = new Set<string>();
    protected reuse = true;
    protected running = false;
    protected cancelled = false;
    protected finished = false;
    protected applied = false;
    protected cutCandidateCount = 0;
    protected currentSource: PopupSource | undefined;
    protected readonly completedSources = new Set<string>();
    protected progressStart = 0;
    protected eventFloor = '';
    protected readonly seenEvents = new Set<string>();
    protected readonly engineProgress = new Map<string, string>();
    protected progressTimer: ReturnType<typeof setInterval> | undefined;
    protected preview: CaptionsApplyPreview | undefined;
    protected artifacts: TranscribeArtifacts = { transcripts: [], diff: null, cuts: null };
    protected readonly artifactsBySource = new Map<string, TranscribeArtifacts>();
    protected countCutCandidates(captions: DaihonCaptionLike[]): number {
        return collectDaihonCutCandidates(buildDaihonRows(captions, null), {
            sources: this.selectedSources().map(source => ({ sourceId: source.id,
                cuts: this.artifactsBySource.get(source.id)?.cuts ?? null }))
        }).length;
    }

    protected async transcribedCutRows(): Promise<DaihonCaptionLike[]> {
        const bySource = await Promise.all(this.selectedSources().map(async source => {
            const analysisUri = this.root.resolve(`.akari/sidecars/${source.path}.analysis/analysis.json`);
            type Segment = { start: number; end: number; text: string; words?: DaihonCaptionLike['words'];
                unrecognized?: DaihonCaptionLike['unrecognized'] };
            let segments = this.artifactsBySource.get(source.id)?.transcripts[0]?.segments as Segment[] | undefined;
            try {
                const analysis = JSON.parse((await this.files.readFile(analysisUri)).value.toString()) as {
                    transcript?: Segment[] };
                if (Array.isArray(analysis.transcript)) segments = analysis.transcript;
            } catch { /* Use engine output if the merged transcript is unavailable. */ }
            return (segments ?? []).filter(segment => Number.isFinite(segment.start)
                && Number.isFinite(segment.end) && segment.end > segment.start && !!segment.text?.trim())
                .map((segment, index) => ({ id: `${source.id}:transcript:${index}`, src: source.id,
                    start: segment.start, end: segment.end, text: segment.text, style: null,
                    words: Array.isArray(segment.words) ? segment.words : undefined,
                    unrecognized: Array.isArray(segment.unrecognized)
                        ? segment.unrecognized : undefined }));
        }));
        return bySource.flat();
    }
    protected readonly unregisteredPlacements = new Set<string>();
    protected tools: TranscribeToolStatus[] = [];
    protected connections: TranscribeConnectionStatus[] = [];
    protected availabilityLoaded = false;
    protected chars = 18;
    protected lines: 1 | 2 = 1;
    protected timing: 'full' | 'speech-tight' = 'full';
    protected karaoke = false;
    protected force = false;
    protected showMore = false;
    protected showDetails = false;
    protected readonly ready: Promise<void>;
    protected readonly autoCuts: boolean;

    constructor(protected readonly root: URI, protected readonly initialPath: string | undefined,
        protected readonly preferences: PreferenceService, protected readonly service: AkariProjectService,
        protected readonly annotationsService: AkariAnnotationsService,
        protected readonly files: FileService, protected readonly commands: CommandService,
        protected readonly listen: (start: number, end: number, sourcePath: string) => Promise<void>,
        protected readonly messages: MessageService,
        protected readonly probeHasAudio: (uri: string) => Promise<boolean | undefined>) {
        super({ title: '字幕を作る' });
        this.node.dataset.akariTranscribeDialog = 'true';
        this.node.dataset.akariTranscribeMode = 'popup';
        const frame = this.contentNode.parentElement!;
        Object.assign(frame.style, { width: 'min(760px, calc(100vw - 36px))', height: 'min(690px, calc(100vh - 36px))',
            minWidth: '0', borderRadius: '14px', background: '#20242b' });
        Object.assign(this.contentNode.style, { padding: '0', display: 'flex', flexDirection: 'column', flex: '1',
            minHeight: '0', maxHeight: 'none', color: '#e9ecf2' });
        Object.assign(this.steps.style, { display: 'flex', gap: '0', padding: '0 16px', borderBottom: '1px solid #434952',
            background: '#191e25' });
        Object.assign(this.body.style, { flex: '1', overflow: 'auto', padding: '18px', minHeight: '0' });
        Object.assign(this.foot.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 18px',
            borderTop: '1px solid #434952' });
        this.notice.setAttribute('role', 'status');
        this.notice.style.cssText = 'margin:0 18px;color:#f2b25c;min-height:18px';
        this.controlPanel.style.display = 'none';
        this.contentNode.append(this.steps, this.body, this.notice, this.foot);
        const preferred = this.preferences.get<string>('akari.transcribe.backend', 'auto');
        this.backend = typeof preferred === 'string' ? preferred : 'auto';
        const preferredCompare = this.preferences.get<unknown>('akari.transcribe.compareSet', []);
        this.compareSet = new Set(Array.isArray(preferredCompare) ? preferredCompare.filter((id): id is string => typeof id === 'string') : []);
        this.autoCuts = this.preferences.get<boolean>('akari.transcribe.autoCuts', true) !== false;
        this.ready = this.initialize().catch(error => { this.notice.textContent = String(error); });
        this.render();
    }

    get wasCancelled(): boolean { return this.cancelled; }
    get value(): void { return undefined; }
    protected invalidateRun(): void {
        this.finished = false;
        this.applied = false;
        this.reached = Math.min(this.reached, 1);
        this.preview = undefined;
    }
    protected override handleEnter(event: KeyboardEvent): boolean {
        if (event.isComposing || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return false;
        const primary = this.foot.querySelector<HTMLButtonElement>('[data-primary]');
        if (primary && !primary.disabled) { primary.click(); return true; }
        return false;
    }

    protected async initialize(): Promise<void> {
        this.editUri = currentTimelineEditUri(this.root);
        this.unsupportedTimeline = !/(?:^|\/)edit\.json$/u.test(this.editUri.toString());
        const edit = JSON.parse((await this.files.readFile(this.editUri)).value.toString()) as {
            sources?: Array<{ id: string; path: string; kind?: string }>;
            audio?: { bgm?: { path?: string; source?: string; src?: string } };
            sync_groups?: Array<{ members: Array<{ source: string }> }>;
            tracks?: Array<{ lane?: string; items?: Array<{ role?: string; path?: string; source?: { src?: string; path?: string } }> }>;
        };
        const bgmIds = captionBgmSourceIds(edit);
        const rawSources = (edit.sources ?? []).filter(source => typeof source.id === 'string' && typeof source.path === 'string');
        this.videoSourceIds = new Set((edit.tracks ?? []).filter(track => track.lane === 'visual')
            .flatMap(track => track.items ?? []).map(item => item.source?.src)
            .filter((id): id is string => typeof id === 'string' && rawSources.some(source => source.id === id && isCaptionVideo(source))));
        this.syncChoice.clear();
        for (const group of edit.sync_groups ?? []) for (const member of group.members) {
            const visual = group.members.find(candidate => this.videoSourceIds.has(candidate.source));
            if (visual && member.source !== visual.source) this.syncChoice.set(member.source, visual.source);
        }
        this.initialSyncChoice = new Map(this.syncChoice);
        if (this.initialPath && !rawSources.some(source => normalizedCaptionPath(source.path) === normalizedCaptionPath(this.initialPath))) {
            rawSources.push({ id: '__requested_material__', path: this.initialPath, kind: 'unlisted' });
        }
        const states = await this.service.transcriptStates({ projectRoot: this.root.toString(), relativePaths: rawSources.map(source => source.path) });
        this.sources = await Promise.all(rawSources.map(async source => {
            if (source.id === '__requested_material__') {
                const eligibility = captionSourceEligibility(source, { projectRoot: this.root.toString() });
                return { ...source, name: source.path.replace(/\\/gu, '/').split('/').pop() || source.path,
                    status: eligibility.status, reason: eligibility.status === 'excluded'
                        ? eligibility.reason : 'タイムラインにまだ置いていない素材',
                    hasTranscript: states[source.path] === 'done', unlisted: eligibility.status !== 'excluded' };
            }
            const analysisUri = this.root.resolve(`.akari/sidecars/${source.path}.analysis/analysis.json`);
            let analysis: { probe?: { duration_s?: number; streams?: Array<{ codec_type?: string }> }; transcript?: unknown[] } = {};
            try { analysis = JSON.parse((await this.files.readFile(analysisUri)).value.toString()); } catch { /* New material. */ }
            const hasAudio = isCaptionVideo(source)
                ? Array.isArray(analysis.probe?.streams)
                    ? analysis.probe!.streams!.some(stream => stream.codec_type === 'audio')
                    : await this.probeHasAudio(this.root.resolve(source.path).normalizePath().toString())
                : undefined;
            const eligibility = captionSourceEligibility(source, { projectRoot: this.root.toString(), kind: source.kind,
                hasAudio, isBgm: bgmIds.has(source.id) });
            return { ...source, name: source.path.replace(/\\/gu, '/').split('/').pop() || source.path,
                status: eligibility.status, reason: eligibility.reason,
                duration: analysis.probe?.duration_s, summary: analysisTranscriptSummary(analysis),
                hasTranscript: states[source.path] === 'done' || Array.isArray(analysis.transcript) };
        }));
        let captionSources: string[] = [];
        try {
            const raw = JSON.parse((await this.files.readFile(currentTimelineCaptionsUri(this.root))).value.toString());
            const rows = Array.isArray(raw) ? raw : raw.captions;
            captionSources = Array.isArray(rows) ? rows.map((row: { src?: string }) => row.src).filter((id: string) => !!id) : [];
            const shape = readCaptionShape(raw);
            this.chars = shape.chars; this.lines = shape.lines; this.timing = shape.timing;
            try { this.karaoke = getCaptionDisplayWordStyle(raw) === 'karaoke'; }
            catch { this.karaoke = false; /* Legacy display policies may be incomplete. */ }
        } catch { /* Captions may not exist yet. */ }
        this.selected = new Set(popupInitialSourceIds(this.sources, this.initialPath, captionSources));
        this.showMore = this.sources.some(source => source.status === 'excluded'
            && this.initialPath && normalizedCaptionPath(source.path) === normalizedCaptionPath(this.initialPath));
        this.render();
        void Promise.all([
            this.commands.executeCommand<{ tools: TranscribeToolStatus[] }>('akari.settings.readStatus', '/services/akari-surfaces-new-project')
                .then(result => { this.tools = result?.tools ?? []; }, () => undefined),
            this.commands.executeCommand<{ providers: TranscribeConnectionStatus[] }>('akari.settings.readStatus', '/services/akari-surfaces-connections')
                .then(result => { this.connections = result?.providers ?? []; }, () => undefined)
        ]).then(() => {
            this.availabilityLoaded = true;
            const available = (id: string) => id === 'auto'
                || TRANSCRIBE_ENGINE_CARDS.some(card => card.id === id)
                    && transcribeEngineAvailability(id, this.tools, this.connections).state === 'available';
            if (!available(this.backend)) this.backend = 'auto';
            this.compareSet = new Set([...this.compareSet].filter(available));
            if (!this.isDisposed) this.render();
        });
    }

    protected sourceCard(source: PopupSource): HTMLElement {
        const row = el('label');
        row.dataset.sourceId = source.id;
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', margin: '7px 0',
            border: `1px solid ${this.selected.has(source.id) ? '#f0832b' : '#424955'}`, borderRadius: '9px',
            background: source.status === 'excluded' ? '#24272b' : '#2a3038', opacity: source.status === 'excluded' ? '.65' : '1' });
        const check = el('input'); check.type = 'checkbox'; check.checked = this.selected.has(source.id);
        check.disabled = source.status === 'excluded' || this.running;
        check.onchange = () => {
            if (check.checked) this.selected.add(source.id);
            else this.selected.delete(source.id);
            this.invalidateRun(); this.render();
        };
        const icon = el('span');
        icon.style.cssText = 'width:48px;height:36px;display:grid;place-items:center;color:#58a6ff';
        if (source.status === 'excluded') {
            const extension = normalizedCaptionPath(source.path).match(/\.([a-z0-9]+)$/u)?.[1] ?? '';
            icon.textContent = CAPTION_IMAGE_EXTENSIONS.has(extension) ? '▧' : '▣';
        }
        else icon.innerHTML = '<svg width="42" height="28" viewBox="0 0 42 28" aria-hidden="true"><path d="M1 14h3l2-6 3 12 3-17 3 21 3-13 3 6 3-9 3 13 3-15 3 12 2-4h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        const detail = el('span'); detail.style.flex = '1'; detail.style.minWidth = '0';
        detail.append(el('strong', source.name));
        const subtitle = el('small', source.reason ?? source.path);
        subtitle.style.cssText = `display:block;margin-top:3px;color:${source.status === 'excluded' ? '#f2b25c' : '#aeb7c5'};overflow-wrap:anywhere`;
        detail.append(subtitle);
        const meta = el('span', source.duration === undefined ? '—:—' : time(source.duration));
        meta.style.cssText = 'color:#b6c1ce;text-align:right;white-space:nowrap';
        if (source.hasTranscript) {
            const chip = el('small', `起こし済み ${source.summary?.split(' · ')[0] ?? ''}`);
            chip.style.cssText = 'display:block;margin-top:5px;padding:3px 6px;border-radius:10px;background:#194638;color:#9ce8bc';
            meta.append(chip);
        }
        row.append(check, icon, detail, meta);
        if (source.status === 'voice' && !isCaptionVideo(source) && this.videoSourceIds.size) {
            row.style.flexWrap = 'wrap';
            const syncRow = el('div');
            syncRow.style.cssText = 'flex:0 0 100%;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-left:87px;box-sizing:border-box';
            const syncLabel = el('small', '一緒に切る映像');
            syncLabel.style.color = '#aeb7c5';
            const sync = el('select');
            sync.setAttribute('aria-label', `${source.name} をこの映像と同期`);
            for (const [id, label] of [['', 'なし'], ...[...this.videoSourceIds].map(id =>
                [id, this.sources.find(candidate => candidate.id === id)?.name ?? id])]) {
                const option = el('option', label); option.value = id; sync.append(option);
            }
            sync.value = this.syncChoice.get(source.id) ?? '';
            sync.style.minWidth = '180px';
            sync.onclick = event => event.stopPropagation();
            syncRow.onclick = event => { event.stopPropagation(); event.preventDefault(); };
            sync.onchange = () => {
                if (sync.value) this.syncChoice.set(source.id, sync.value);
                else this.syncChoice.delete(source.id);
            };
            const hint = el('small', '組にしたあと、タイムラインで声をずらして口と合わせてください。合わせた位置のまま一緒に切れます。');
            hint.style.color = '#aeb7c5';
            syncRow.append(syncLabel, sync, hint);
            row.append(syncRow);
        }
        return row;
    }

    protected async saveSyncChoice(audioSource: string, videoSource: string): Promise<boolean> {
        if (!this.editUri) return true;
        const editUri = this.editUri;
        try {
            const before = (await this.files.readFile(editUri)).value.toString();
            const edit = JSON.parse(before) as EditV2;
            const next = setSourceSyncGroup(edit, audioSource, videoSource || undefined);
            const after = `${JSON.stringify(next, null, 2)}\n`;
            if (before !== after) {
                await this.files.writeFile(editUri, BinaryBuffer.fromString(after));
                daihonHistoryService()?.push({ label: videoSource ? '映像と同期' : '同期を解除',
                    undo: async () => void await this.files.writeFile(editUri, BinaryBuffer.fromString(before)),
                    redo: async () => void await this.files.writeFile(editUri, BinaryBuffer.fromString(after)) });
            }
            if (videoSource) this.syncChoice.set(audioSource, videoSource);
            else this.syncChoice.delete(audioSource);
            return true;
        } catch (error) {
            this.notice.textContent = `同期を保存できません: ${error instanceof Error ? error.message : String(error)}`;
            this.render();
            return false;
        }
    }

    protected renderSources(): void {
        this.body.append(el('h3', 'どの素材の声を字幕にしますか'),
            el('p', 'タイムラインに置いた素材のうち、声が入っていそうなものだけ並べています。'));
        if (this.unsupportedTimeline) {
            const reason = el('p', 'このタイムラインには、まだ字幕を作れません（メインのタイムラインで作ってください）');
            reason.setAttribute('role', 'alert'); reason.style.color = '#f2b25c'; this.body.append(reason);
        }
        const voice = this.sources.filter(source => source.status === 'voice');
        for (const source of voice) this.body.append(this.sourceCard(source));
        const others = this.sources.filter(source => source.status !== 'voice');
        if (others.length) {
            const more = el('details'); more.open = this.showMore;
            more.ontoggle = () => { this.showMore = more.open; };
            more.append(el('summary', `ほかの素材 ${others.length} 件（BGM ${others.filter(source => source.status === 'bgm').length} · 対象外 ${others.filter(source => source.status === 'excluded').length}）`));
            for (const source of others) more.append(this.sourceCard(source));
            this.body.append(more);
        }
    }

    // Each build replaces only that source's rows, so selected materials run in source order.
    protected selectedSources(): PopupSource[] { return this.sources.filter(source => this.selected.has(source.id)); }
    protected selectedSource(): PopupSource | undefined { return this.selectedSources()[0]; }
    protected sourceNeedsTranscription(source: PopupSource): boolean {
        return !source.hasTranscript || !this.reuse || this.compare;
    }
    protected needsTranscription(): boolean { return this.selectedSources().some(source => this.sourceNeedsTranscription(source)); }
    protected enginesReady(): boolean {
        if (!this.needsTranscription()) return true;
        if (!this.availabilityLoaded) return false;
        const ids = this.compare ? [...this.compareSet] : [this.backend];
        if (this.compare && ids.length < 2) return false;
        return ids.every(id => {
            if (id === 'auto') return !this.compare && TRANSCRIBE_ENGINE_CARDS.some(card => card.hourlyUsd === 0
                && transcribeEngineAvailability(card.id, this.tools, this.connections).state === 'available');
            return TRANSCRIBE_ENGINE_CARDS.some(card => card.id === id)
                && transcribeEngineAvailability(id, this.tools, this.connections).state === 'available';
        });
    }
    protected selectedClouds(): typeof TRANSCRIBE_ENGINE_CARDS {
        const ids = this.compare ? [...this.compareSet] : [this.backend];
        return TRANSCRIBE_ENGINE_CARDS.filter(engine => ids.includes(engine.id) && engine.hourlyUsd > 0);
    }
    protected renderMethod(): void {
        const selected = this.selectedSources();
        if (selected.some(source => source.hasTranscript)) {
            this.body.append(el('h3', '起こし済みの素材があります'));
            for (const [value, label, detail] of [[true, '前回の起こしを使う', `${selected.find(source => source.hasTranscript)?.summary ?? '起こし済み'}。すぐ終わる`],
                [false, '起こし直す', '手で直した行は守り、それ以外を新しい結果にする']] as const) {
                const row = el('label'); row.style.cssText = 'display:block;padding:8px';
                const radio = el('input'); radio.type = 'radio'; radio.name = 'reuse'; radio.checked = this.reuse === value;
                radio.onchange = () => { this.reuse = value; this.invalidateRun(); this.render(); };
                const body = el('span', ` ${label}`);
                const small = el('small', detail); small.style.cssText = 'display:block;margin-left:23px;color:#aeb7c5';
                body.append(small); row.append(radio, body);
                this.body.append(row);
            }
        }
        if (!this.needsTranscription()) {
            const note = el('small', '前回の起こしを使うので、エンジンは使いません');
            note.style.cssText = 'display:block;margin:10px 0;color:#b6c1ce'; this.body.append(note);
        }
        this.body.append(el('h3', 'どのエンジンで起こしますか'), el('p', '迷ったら「おまかせ」のまま次へ。'));
        const engines = [{ id: 'auto', label: 'おまかせ', facts: 'この機械で使えるものから選ぶ', place: 'ローカル優先', hourlyUsd: 0 }, ...TRANSCRIBE_ENGINE_CARDS];
        const grid = el('div');
        Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' });
        for (const engine of engines) {
            const autoReady = TRANSCRIBE_ENGINE_CARDS.some(card => card.hourlyUsd === 0
                && transcribeEngineAvailability(card.id, this.tools, this.connections).state === 'available');
            const available = engine.id === 'auto' ? autoReady
                ? { state: 'available', label: '使える' }
                : { state: 'needs', label: '準備が要る（ローカルのエンジンがありません）' }
                : transcribeEngineAvailability(engine.id, this.tools, this.connections);
            const disabled = engine.id !== 'auto' && (!this.availabilityLoaded || available.state !== 'available');
            const row = el('label');
            Object.assign(row.style, { display: 'block', padding: '11px 13px', margin: '0', borderRadius: '9px',
                border: `1px solid ${this.backend === engine.id ? '#f0832b' : '#424955'}`,
                background: engine.id === 'auto' ? '#313a43' : '#292f37', opacity: disabled ? '.5' : '1' });
            if (engine.id === 'auto') row.style.gridColumn = '1 / -1';
            const radio = el('input'); radio.type = this.compare ? 'checkbox' : 'radio'; radio.name = 'engine';
            radio.checked = this.compare ? this.compareSet.has(engine.id) : this.backend === engine.id;
            radio.disabled = disabled || this.running || (this.compare && engine.id === 'auto');
            radio.onchange = () => {
                if (this.compare) { if (radio.checked) this.compareSet.add(engine.id); else this.compareSet.delete(engine.id); }
                else this.backend = engine.id;
                this.invalidateRun(); this.render();
            };
            const name = el('strong', ` ${engine.label}`);
            if (engine.id === 'auto') {
                const badge = el('small', 'おすすめ'); badge.style.cssText = 'margin-left:8px;color:#fbbf77'; name.append(badge);
            }
            const detail = el('small', `${engine.facts} · ${engine.place}`);
            detail.style.cssText = 'display:block;margin:4px 0 0 22px;color:#b6c1ce';
            const badge = el('small', this.availabilityLoaded ? available.label : '確認中…');
            badge.style.cssText = `display:inline-block;margin:7px 0 0 22px;padding:3px 7px;border-radius:10px;${disabled || available.state !== 'available'
                ? 'background:#3b3635;color:#d5b8a5' : 'background:#194638;color:#9ce8bc'}`;
            row.append(radio, name, detail, badge);
            grid.append(row);
        }
        this.body.append(grid);
        if (this.needsTranscription() && this.availabilityLoaded && !this.enginesReady()) {
            this.body.append(el('p', '使えるエンジンを選んでください。'));
        }
        const clouds = this.needsTranscription() ? this.selectedClouds() : [];
        if (clouds.length) {
            const transcribed = selected.filter(source => this.sourceNeedsTranscription(source));
            const seconds = transcribed.reduce((sum, source) => sum + (source.duration ?? 0), 0);
            const hourly = clouds.reduce((sum, engine) => sum + engine.hourlyUsd, 0);
            const cost = transcribed.every(source => source.duration !== undefined)
                ? `${transcribed.length} 本 · 約 ${Math.ceil(seconds / 60)} 分で、約 $${(seconds * hourly / 3600).toFixed(2)}`
                : `1 時間あたり $${hourly.toFixed(2)}`;
            const note = el('p', `音声を ${clouds.map(engine => engine.label).join('・')} に送ります。${cost} です。ここで確かめたので、あとで別の確認は出しません。`);
            note.style.cssText = 'padding:11px;border:1px solid #b98638;border-radius:7px;color:#f1cb91';
            note.dataset.akariCloudCost = cost;
            this.body.append(note);
        }
        const details = el('details'); details.open = this.showDetails;
        details.ontoggle = () => { this.showDetails = details.open; };
        details.append(el('summary', '詳しく'));
        const compare = el('label'); compare.style.cssText = 'display:block;padding:10px';
        const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = this.compare;
        toggle.onchange = () => {
            this.compare = toggle.checked;
            if (this.compare && this.backend !== 'auto') this.compareSet.add(this.backend);
            this.invalidateRun(); this.render();
        };
        compare.append(toggle, ' 2 つ以上のエンジンで起こして比べる'); details.append(compare);
        this.body.append(details);
    }

    protected renderProgress(): void {
        this.body.append(el('h3', '起こしています'));
        this.body.append(el('p', 'このポップアップを閉じても続きます。終わったら右下に知らせが出ます。'));
        for (const source of this.selectedSources()) {
            const row = el('div'); row.style.cssText = 'padding:10px 0;border-bottom:1px solid #424955';
            const done = this.completedSources.has(source.id);
            const label = el('div', `${source.name} · ${done ? '完了' : source === this.currentSource ? this.progressText() : '待機中'}`);
            if (source === this.currentSource) label.dataset.akariTranscribeProgress = 'true';
            const bar = el('progress'); bar.max = 1;
            if (done) bar.value = 1;
            else if (source !== this.currentSource) bar.value = 0;
            bar.style.cssText = 'width:100%;height:8px;accent-color:#f0832b';
            row.append(label, bar); this.body.append(row);
        }
        if (this.currentSource) {
            const backends = this.compare ? [...this.compareSet] : [this.backend];
            const columns = el('div');
            Object.assign(columns.style, { display: 'grid', gridTemplateColumns: `repeat(${backends.length}, minmax(0, 1fr))`, gap: '8px' });
            for (const backend of backends) {
                const column = el('section');
                column.style.cssText = 'padding:10px;border:1px solid #424955;border-radius:8px;min-width:0';
                column.append(el('strong', TRANSCRIBE_ENGINE_CARDS.find(engine => engine.id === backend)?.label ?? backend),
                    el('p', this.engineProgress.get(backend) ?? '待機中'));
                const transcript = this.artifacts.transcripts.find(item => item.backend === backend.replace(/:/g, '-'));
                for (const line of transcript?.segments.slice(-4) ?? []) column.append(el('p', line.text));
                columns.append(column);
            }
            this.body.append(columns);
        }
    }
    protected progressText(): string {
        return `${time((Date.now() - this.progressStart) / 1000)} / ${this.currentSource?.duration === undefined ? '—:—' : time(this.currentSource.duration)}`;
    }

    protected renderFinish(): void {
        this.body.append(el('h3', '仕上げ'));
        if (this.finished) this.body.append(el('p', `カット候補 ${this.cutCandidateCount} 件 · この段階では切っていません。`));
        if (this.notice.textContent) {
            const error = el('p', this.notice.textContent);
            error.setAttribute('role', 'alert'); error.style.color = '#f2b25c';
            this.body.append(error);
        }
        if (this.preview) {
            const metrics = el('div');
            metrics.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0 18px';
            for (const [label, count] of [['新しい行', this.preview.added], ['変わる行', this.preview.changed],
                ['手で直した行（守る）', this.preview.protected], ['消える行', this.preview.removed]] as const) {
                const tile = el('div'); tile.style.cssText = 'padding:12px;background:#2a3038;border:1px solid #424955;border-radius:8px';
                const number = el('strong', String(count)); number.style.cssText = 'display:block;font-size:25px;color:#f2b25c';
                const caption = el('small', label); caption.style.color = '#b6c1ce';
                tile.append(number, caption); metrics.append(tile);
            }
            this.body.append(metrics);
        } else if (this.selectedSources().some(source => source.unlisted)) {
            this.body.append(el('p', 'タイムラインにない素材の差分は、配置後に計算します。'));
        }
        if (this.artifacts.diff) {
            const diff = this.artifacts.diff;
            this.body.append(el('p', `差分 ${diff.items.length} 件 · 一致 ${Math.round(diff.agreement * 100)}%`));
            const table = el('table'); table.style.width = '100%';
            const header = el('tr'); ['時刻', ...diff.engines, '確認'].forEach(label => header.append(el('th', label))); table.append(header);
            for (const item of diff.items) {
                const row = el('tr'); row.append(el('td', `${item.start.toFixed(1)}–${item.end.toFixed(1)}`));
                for (const engine of diff.engines) row.append(el('td', item.texts[engine] || '—'));
                const listen = el('td'); listen.append(button('▶ 聞く', () => {
                    void this.listen(item.start, item.end, this.currentSource?.path ?? this.selectedSources()[0]?.path ?? '')
                        .catch(error => { this.notice.textContent = String(error); });
                }));
                row.append(listen);
                table.append(row);
            }
            this.body.append(table);
        }
        if (this.applied) return;
        this.body.append(el('h3', '字幕の形'));
        const group = (label: string): HTMLElement => { const node = el('section'); node.style.margin = '13px 0'; node.append(el('strong', label)); return node; };
        const chars = group('1 行の文字数');
        const range = el('input'); range.type = 'range'; range.min = '5'; range.max = '28'; range.value = String(this.chars);
        const value = el('span', ` ${this.chars} 字`);
        range.oninput = () => { this.chars = Number(range.value); value.textContent = ` ${this.chars} 字`; this.updateExample(); };
        chars.append(el('br'), range, value); this.body.append(chars);
        const lines = group('行数');
        for (const count of [1, 2] as const) {
            const choice = button(`${count} 行`, () => { this.lines = count; this.render(); });
            choice.style.marginRight = '8px'; choice.setAttribute('aria-pressed', String(this.lines === count));
            if (this.lines === count) choice.style.borderColor = '#f0832b';
            lines.append(choice);
        }
        this.body.append(lines);
        const timing = group('表示タイミング');
        for (const [key, label] of [['full', '余韻あり'], ['speech-tight', '発話ぴったり']] as const) {
            const choice = button(label, () => { this.timing = key; this.render(); });
            choice.style.marginRight = '8px'; choice.setAttribute('aria-pressed', String(this.timing === key));
            if (this.timing === key) choice.style.borderColor = '#f0832b';
            timing.append(choice);
        }
        this.body.append(timing);
        const karaoke = group('カラオケ表示');
        const karaokeLabel = el('label');
        karaokeLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer';
        const karaokeToggle = el('input'); karaokeToggle.type = 'checkbox'; karaokeToggle.checked = this.karaoke;
        karaokeToggle.onchange = () => { this.karaoke = karaokeToggle.checked; this.updateExample(); };
        karaokeLabel.append(karaokeToggle, el('span', '読み上げに合わせて文字の色が変わる'));
        karaoke.append(karaokeLabel, el('small', '行ごとの ⚙ でも切り替えられます。'));
        this.body.append(karaoke);
        const example = el('p'); example.dataset.akariCaptionExample = 'true';
        example.style.cssText = 'max-width:420px;padding:14px;background:#141920;border-radius:8px;line-height:1.6';
        this.body.append(example); this.updateExample();
        const afterNote = el('small', 'あとから台本の「表示 ▾」で変えられます。');
        afterNote.style.color = '#aeb7c5'; this.body.append(afterNote);
        if (this.preview?.protected) {
            const force = group('手で直した行');
            for (const [value, label] of [[false, '守る（おすすめ）'], [true, '上書きする']] as const) {
                const choice = el('label'); choice.style.marginRight = '16px';
                const radio = el('input'); radio.type = 'radio'; radio.name = 'force'; radio.checked = this.force === value;
                radio.onchange = () => { this.force = value; };
                choice.append(radio, ` ${label}`); force.append(choice);
            }
            this.body.append(force);
        }
    }
    protected updateExample(): void {
        const sample = '先週届いたばかりなんですけど箱がすごく小さくて';
        const shown = sample.slice(0, this.chars * this.lines);
        const example = this.body.querySelector<HTMLElement>('[data-akari-caption-example]');
        if (!example) return;
        example.replaceChildren();
        for (let i = 0; i < shown.length; i += this.chars) {
            const line = el('div');
            const part = shown.slice(i, i + this.chars);
            if (this.karaoke) {
                const colored = el('span', part.slice(0, Math.ceil(part.length / 2)));
                colored.style.color = '#f0832b';
                line.append(colored, el('span', part.slice(Math.ceil(part.length / 2))));
            } else line.textContent = part;
            example.append(line);
        }
    }

    protected render(): void {
        if (this.isDisposed) return;
        this.node.dataset.step = String(this.step + 1);
        this.steps.replaceChildren(); this.body.replaceChildren(); this.foot.replaceChildren();
        ['素材', '起こし方', '起こす', '仕上げ'].forEach((name, index) => {
            const control = button(`${index < this.step ? '✓' : index + 1} ${name}`, () => {
                if (popupCanNavigate(index, this.reached, this.running)) { this.step = index as 0 | 1 | 2 | 3; this.render(); }
            }, !popupCanNavigate(index, this.reached, this.running));
            Object.assign(control.style, { flex: '1', border: 'none', borderBottom: index === this.step ? '2px solid #f0832b' : '2px solid transparent',
                borderRadius: '0', background: 'transparent', padding: '13px 5px' });
            if (index === this.step) control.setAttribute('aria-current', 'step');
            this.steps.append(control);
        });
        if (this.step === 0) this.renderSources();
        else if (this.step === 1) this.renderMethod();
        else if (this.step === 2) this.renderProgress();
        else this.renderFinish();
        const spacer = el('span'); spacer.style.flex = '1';
        if (this.step === 0) {
            const selected = this.selectedSources();
            const duration = selected.reduce((sum, source) => sum + (source.duration ?? 0), 0);
            this.foot.append(el('span', `${selected.length} 本を選択 · 計 ${time(duration)}`), spacer);
            const next = button('次へ', () => { void (async () => {
                next.disabled = true;
                for (const source of this.sources.filter(candidate => candidate.status === 'voice'
                    && !isCaptionVideo(candidate) && this.videoSourceIds.size)) {
                    const choice = this.syncChoice.get(source.id) ?? '';
                    if (choice !== (this.initialSyncChoice.get(source.id) ?? '')
                        && !await this.saveSyncChoice(source.id, choice)) return;
                }
                this.step = 1; this.reached = Math.max(this.reached, 1); this.render();
            })(); },
                !selected.length || this.unsupportedTimeline);
            next.dataset.primary = 'true'; this.foot.append(next);
        } else if (this.step === 1) {
            this.foot.append(button('戻る', () => { this.step = 0; this.render(); }), spacer);
            const start = button('起こす', () => void this.start(), !this.selected.size || this.unsupportedTimeline
                || !this.enginesReady());
            start.dataset.primary = 'true'; this.foot.append(start);
        } else if (this.step === 2) {
            this.foot.append(el('span', this.finished ? '起こしが終わりました' : '起こし中…'), spacer);
            if (this.running) this.foot.append(button('中止', () => void this.cancel()));
            else if (this.finished) {
                const next = button('仕上げへ', () => { this.step = 3; this.reached = 3; this.render(); });
                next.dataset.primary = 'true'; this.foot.append(next);
            } else this.foot.append(button('起こし方へ戻る', () => { this.step = 1; this.render(); }));
        } else if (this.applied) {
            this.foot.append(el('span', '台本に反映しました · ⌘Z で元に戻せる'), spacer);
            if (this.cutCandidateCount > 0) this.foot.append(button('カットを整える…', () => {
                this.close(); void this.commands.executeCommand('akari.cuts.open');
            }));
            this.foot.append(button('台本を見る', () => { void this.commands.executeCommand('akari.daihon.open'); this.close(); }));
        } else {
            this.foot.append(button('戻る', () => { this.step = 2; this.render(); }), spacer);
            const unlisted = this.selectedSources().filter(source => source.unlisted);
            const apply = button(unlisted.length ? 'タイムラインに置いて差分を確認' : '台本に反映',
                () => { if (unlisted.length) void this.prepareUnlisted(); else void this.apply(); },
                !this.finished || this.unsupportedTimeline || unlisted.some(source => this.unregisteredPlacements.has(source.path))
                    || !unlisted.length && !this.preview);
            apply.dataset.primary = 'true'; this.foot.append(apply);
        }
    }

    protected async start(): Promise<void> {
        if (this.running || this.unsupportedTimeline || !this.selectedSource() || !this.enginesReady()) return;
        await this.ready;
        this.running = true; this.finished = false; this.cancelled = false;
        this.completedSources.clear();
        this.step = 2; this.reached = 2; this.notice.textContent = '';
        this.render();
        const options = { backend: this.backend, compareSet: this.compare ? [...this.compareSet] : [],
            approved: this.needsTranscription() && this.selectedClouds().length > 0, autoCuts: this.autoCuts };
        try {
            for (const source of this.selectedSources()) {
                if (this.cancelled) break;
                this.currentSource = source;
                this.progressStart = Date.now();
                this.eventFloor = new Date().toISOString().replace(/[:.]/g, '-');
                this.seenEvents.clear(); this.engineProgress.clear();
                this.render();
                this.progressTimer = setInterval(() => {
                    const progress = this.body.querySelector<HTMLElement>('[data-akari-transcribe-progress]');
                    if (progress) progress.textContent = `${this.currentSource?.name ?? '準備中'} · ${this.progressText()}`;
                    void this.pollProgress();
                }, 1000);
                if (this.sourceNeedsTranscription(source)) {
                    await this.service.transcribeMaterial({ projectRoot: this.root.toString(), relativePath: source.path, ...options });
                }
                source.hasTranscript = true;
                this.completedSources.add(source.id);
                await this.pollProgress();
                this.artifacts = await this.service.readTranscribeArtifacts({ projectRoot: this.root.toString(), relativePath: source.path });
                this.artifactsBySource.set(source.id, this.artifacts);
                clearInterval(this.progressTimer); this.progressTimer = undefined;
            }
            if (!this.cancelled) {
                await this.refreshPreview();
                this.cutCandidateCount = this.countCutCandidates(await this.transcribedCutRows());
                this.finished = true; this.step = 3; this.reached = 3;
                if (this.isDisposed) void this.messages.info('起こしが終わりました（まだ台本には入っていません）', '仕上げを開く')
                    .then(action => { if (action === '仕上げを開く') void this.reopenFinish().catch(error => {
                        void this.messages.error(String(error), { timeout: 0 });
                    }); });
            }
        } catch (error) {
            this.notice.textContent = error instanceof Error ? error.message : String(error);
            if (this.isDisposed && !this.cancelled) void this.messages.error(`字幕を作れません: ${this.notice.textContent}`, { timeout: 0 });
        }
        finally {
            clearInterval(this.progressTimer); this.progressTimer = undefined;
            this.running = false; if (!this.isDisposed) this.render();
        }
    }

    protected async reopenFinish(): Promise<void> {
        const selectedPaths = new Set(this.selectedSources().map(source => normalizedCaptionPath(source.path)));
        const dialog = new AkariTranscribeDialog(this.root, this.initialPath, this.preferences, this.service,
            this.annotationsService, this.files, this.commands, this.listen, this.messages, this.probeHasAudio);
        await dialog.ready;
        dialog.selected = new Set(dialog.sources.filter(source => selectedPaths.has(normalizedCaptionPath(source.path))).map(source => source.id));
        dialog.artifactsBySource.clear();
        for (const source of dialog.sources) {
            const original = this.sources.find(item => normalizedCaptionPath(item.path) === normalizedCaptionPath(source.path));
            const artifacts = original ? this.artifactsBySource.get(original.id) : undefined;
            if (artifacts) dialog.artifactsBySource.set(source.id, artifacts);
        }
        dialog.artifacts = this.artifacts;
        dialog.cutCandidateCount = this.cutCandidateCount;
        await dialog.refreshPreview();
        dialog.finished = true; dialog.step = 3; dialog.reached = 3;
        dialog.render();
        void dialog.open();
    }

    protected async pollProgress(): Promise<void> {
        if (!this.currentSource) return;
        try {
            const events = await this.files.resolve(this.root.resolve('.akari/events'));
            for (const file of events.children ?? []) {
                if (file.resource.path.ext !== '.json'
                    || !file.resource.toString().split('/').pop()?.includes('-material-transcript-')) continue;
                const event = JSON.parse((await this.files.readFile(file.resource)).value.toString()) as MaterialTranscriptEvent;
                if (event.type !== 'material-transcript' || event.relativePath !== this.currentSource.path
                    || event.id < this.eventFloor || this.seenEvents.has(event.id)) continue;
                this.seenEvents.add(event.id);
                if (event.backend) this.engineProgress.set(event.backend,
                    event.status === 'completed' ? '完了' : event.status === 'failed' ? '失敗' : '起こし中');
                if (event.error) this.notice.textContent = event.error;
            }
            if (!this.isDisposed && this.step === 2) this.render();
        } catch { /* Progress files are optional; the service promise still decides completion. */ }
    }

    protected async refreshPreview(): Promise<void> {
        if (!this.editUri || this.unsupportedTimeline) return;
        const selected = this.selectedSources();
        if (!selected.length || selected.some(source => source.unlisted)) { this.preview = undefined; return; }
        const total: CaptionsApplyPreview = { added: 0, changed: 0, protected: 0, removed: 0, total: 0 };
        const legacyIds = new Set<string>();
        try {
            const raw = JSON.parse((await this.files.readFile(currentTimelineCaptionsUri(this.root))).value.toString());
            const rows = Array.isArray(raw) ? raw : raw.captions;
            if (Array.isArray(rows)) for (const row of rows as Array<{ id?: string; src?: string | null; edited?: boolean }>) {
                if (row?.src == null && row.edited !== true && row.id) legacyIds.add(row.id);
            }
        } catch { /* First captions file. */ }
        for (const [index, source] of selected.entries()) {
            const value = await this.service.buildCaptions({ projectRoot: this.root.toString(), editUri: this.editUri.toString(),
                source: source.id, dryRun: true });
            const item = parseCaptionsApplyPreview(value);
            if (!item) { this.preview = undefined; return; }
            const removedIds = (value as { ids?: { removed?: string[] } }).ids?.removed ?? [];
            const repeatedLegacy = index > 0 ? removedIds.filter(id => legacyIds.has(id)).length : 0;
            for (const key of ['added', 'changed', 'protected', 'removed', 'total'] as const) {
                total[key] += key === 'removed' ? Math.max(0, item.removed - repeatedLegacy) : item[key];
            }
        }
        this.preview = total;
    }

    protected async prepareUnlisted(): Promise<void> {
        if (!this.finished || !this.editUri || this.unsupportedTimeline) return;
        const unlisted = this.selectedSources().filter(source => source.unlisted);
        if (unlisted.some(source => this.unregisteredPlacements.has(source.path))) return;
        try {
            for (const source of unlisted) {
                const video = isCaptionVideo(source);
                await this.commands.executeCommand('akari.timeline.addMaterialAtPlayhead', {
                    relativePath: source.path, kind: video ? 'video' : 'audio', ...(!video ? { voiceTrack: true } : {})
                });
                const edit = JSON.parse((await this.files.readFile(this.editUri)).value.toString()) as {
                    sources?: Array<{ id: string; path: string }> };
                const id = edit.sources?.find(item => normalizedCaptionPath(item.path) === normalizedCaptionPath(source.path))?.id;
                if (!id) {
                    this.unregisteredPlacements.add(source.path);
                    throw new Error('台本の素材一覧に登録されませんでした。タイムラインに置いた素材は残っています。');
                }
                this.selected.delete(source.id); this.selected.add(id);
                const artifacts = this.artifactsBySource.get(source.id);
                if (artifacts) { this.artifactsBySource.delete(source.id); this.artifactsBySource.set(id, artifacts); }
                source.id = id; source.unlisted = false; source.reason = undefined;
            }
            await this.refreshPreview();
            if (!this.preview) throw new Error('差分を確認できませんでした。タイムラインに置いた素材は残っています。');
            this.render();
        } catch (error) { this.notice.textContent = error instanceof Error ? error.message : String(error); this.render(); }
    }

    protected async apply(): Promise<void> {
        if (!this.finished || this.applied || !this.editUri || this.unsupportedTimeline) return;
        if (this.selectedSources().some(source => source.unlisted)) {
            this.notice.textContent = this.selectedSources().some(source => this.unregisteredPlacements.has(source.path))
                ? '台本の素材一覧に登録されませんでした。タイムラインに置いた素材は残っています。'
                : 'タイムラインにない素材の差分を先に確認してください。';
            this.render(); return;
        }
        if (!this.preview) {
            this.notice.textContent = '差分を確認できませんでした。台本への反映を止めました。';
            this.render(); return;
        }
        this.notice.textContent = '';
        try {
            const captionsUri = currentTimelineCaptionsUri(this.root);
            let before: string | undefined;
            try { before = (await this.files.readFile(captionsUri)).value.toString(); } catch { /* First captions file. */ }
            for (const source of this.selectedSources()) {
                const result = await this.service.buildCaptions({ projectRoot: this.root.toString(), editUri: this.editUri.toString(),
                    source: source.id, force: this.force });
                if (result.needsForce) {
                    this.notice.textContent = '手で直した行を上書きする場合は「上書きする」を選んでください。';
                    this.render(); return;
                }
                const afterSource = (await this.files.readFile(captionsUri)).value.toString();
                this.recordCaptionsHistory(captionsUri, before, afterSource, `台本へ反映 · ${source.name}`);
                before = afterSource;
            }
            const raw = JSON.parse((await this.files.readFile(captionsUri)).value.toString()) as {
                captions?: Array<{ id?: string; start?: number; end?: number; words?: Array<{ start: number; end: number }>;
                    display_timing?: 'full' | 'speech-tight' }>;
            };
            const captionsUriString = captionsUri.toString();
            const projectRootUri = this.root.toString();
            const policy = daihonDisplayPolicyForWrite(raw, { maxLineUnits: this.chars, lines: this.lines,
                wrap: readDaihonDisplayKnobs(raw).wrap });
            const displayPolicy = setCaptionDisplayWordStyle({ display_policy: policy },
                this.karaoke ? 'karaoke' : 'none').display_policy as CaptionDisplayPolicy;
            await this.annotationsService.setCaptionDisplayPolicy({
                captionsUri: captionsUriString, projectRootUri, displayPolicy
            });
            const rows = Array.isArray(raw) ? raw : raw.captions;
            const timed = (Array.isArray(rows) ? rows : []).filter(row => typeof row?.id === 'string'
                && Array.isArray(row.words) && row.words.length > 0).map(row => ({
                id: row.id!, start: row.start, end: row.end, words: row.words,
                displayTiming: row.display_timing === 'speech-tight' ? 'speech-tight' as const : 'full' as const
            }));
            for (const captionId of planSpeechTightApply(timed, this.timing).targets) {
                await this.annotationsService.setCaptionFields({
                    captionsUri: captionsUriString, projectRootUri, captionId, displayTiming: this.timing
                });
            }
            const after = (await this.files.readFile(captionsUri)).value.toString();
            this.recordCaptionsHistory(captionsUri, before, after, '字幕の形を設定');
            const parsed = parseCaptions(after);
            this.cutCandidateCount = this.countCutCandidates(parsed.captions as DaihonCaptionLike[]);
            this.applied = true; this.render();
            if (this.isDisposed) void this.messages.info('字幕ができました', '台本を開く').then(action => {
                if (action === '台本を開く') void this.commands.executeCommand('akari.daihon.open');
            });
        } catch (error) {
            this.notice.textContent = error instanceof Error ? error.message : String(error); this.render();
            if (this.isDisposed) void this.messages.error(`台本に反映できません: ${this.notice.textContent}`, { timeout: 0 });
        }
    }

    protected recordCaptionsHistory(uri: URI, before: string | undefined, after: string, label: string): void {
        if (before === after) return;
        daihonHistoryService()?.push({ label,
            undo: async () => before === undefined ? this.files.delete(uri)
                : void await this.files.writeFile(uri, BinaryBuffer.fromString(before)),
            redo: async () => void await this.files.writeFile(uri, BinaryBuffer.fromString(after)) });
    }

    protected async cancel(): Promise<void> {
        this.cancelled = true;
        if (this.currentSource) await this.service.cancelTranscribe({ projectRoot: this.root.toString(), relativePath: this.currentSource.path });
        this.notice.textContent = '文字起こしを中止しました';
    }
}
