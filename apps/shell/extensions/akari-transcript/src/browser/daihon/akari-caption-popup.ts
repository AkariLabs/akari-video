import { t } from '../transcript-text';
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
    TranscribeConnectionStatus, TranscribeToolStatus, channelPeopleLocation, ChannelPerson, mergeSpeakerDictionary,
    orderChannelPeople, parseChannelPeople, captionPopupStepNames, channelPersonVoiceSampleCount, clearVoicesDecided, mergeVoicesDecided,
    analysisHasSpeakers, parseVoicesSidecar, speakerReviewRows, speakerTranscribeOptions, SpeakerCount, SpeakerReviewRow,
    voiceEngineReady, voiceGateBlocks, voiceInstallFailure, speakerFallbackMessage,
    VOICE_ENGINE_DOWNLOAD_MB, SPEAKER_COLORS } from '../../common/transcribe-steps';

export const TRANSCRIBE_ENGINE_CARDS = [
    { id: 'speech-analyzer', label: 'SpeechAnalyzer', place: t('transcript.captionPopup.dialog.computerDescription'), hourlyUsd: 0, facts: t('transcript.captionPopup.dialog.fastNoUploadDescription') },
    { id: 'whisper-cpp', label: 'Whisper · large-v3-turbo', place: t('transcript.captionPopup.dialog.computerDescription'), hourlyUsd: 0, facts: t('transcript.captionPopup.dialog.goodPunctuationNoUploadDescription') },
    { id: 'cloud:scribe', label: 'ElevenLabs Scribe', place: t('transcript.captionPopup.dialog.cloudDescription'), hourlyUsd: .40, facts: t('transcript.captionPopup.dialog.capturesFillerWordsDescription') },
    { id: 'cloud:groq', label: 'Groq Whisper', place: t('transcript.captionPopup.dialog.cloudDescription'), hourlyUsd: .04, facts: t('transcript.captionPopup.dialog.fastDescription') }
];

interface PopupSource {
    id: string; path: string; name: string; status: 'voice' | 'bgm' | 'excluded'; reason?: string;
    duration?: number; summary?: string; hasTranscript: boolean; hasSpeakers?: boolean; unlisted?: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (tag === 'input') node.style.accentColor = 'var(--akari-accent)';
    return node;
};
const time = (seconds: number): string => {
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
const button = (label: string, action: () => void, disabled = false): HTMLButtonElement => {
    const node = el('button', label);
    node.type = 'button'; node.disabled = disabled;
    node.className = 'theia-button secondary';
    node.onclick = action;
    return node;
};
const plainButton = (label: string, action: () => void, disabled = false): HTMLButtonElement => {
    const node = el('button', label);
    node.type = 'button'; node.disabled = disabled;
    Object.assign(node.style, { padding: '9px 14px', borderRadius: '7px',
        border: '1px solid var(--akari-line)', background: 'var(--akari-card)', color: 'var(--akari-ink)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? '.48' : '1' });
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
    protected step = 0;
    protected reached = 0;
    protected split = false;
    protected speakerCount: SpeakerCount = 'auto';
    protected identify = false;
    protected excludedPeople = new Set<string>();
    protected people: ChannelPerson[] = [];
    protected peopleSource = '';
    protected installingVoice = false;
    protected voiceInstallError = '';
    protected speakerRows = new Map<string, SpeakerReviewRow[]>();
    protected speakerFallbacks = new Map<string, string>();
    protected speakerDictionary: Record<string, { name: string; person?: string }> = {};
    protected expandedSpeaker = '';
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
        super({ title: t('transcript.captionPopup.dialog.createCaptionsTooltip') });
        this.node.dataset.akariTranscribeDialog = 'true';
        this.node.dataset.akariTranscribeMode = 'popup';
        const frame = this.contentNode.parentElement!;
        Object.assign(frame.style, { width: 'min(760px, calc(100vw - 36px))', height: 'min(690px, calc(100vh - 36px))',
            minWidth: '0', borderRadius: '14px', background: 'var(--akari-bg)' });
        Object.assign(this.contentNode.style, { padding: '0', display: 'flex', flexDirection: 'column', flex: '1',
            minHeight: '0', maxHeight: 'none', color: 'var(--akari-ink)' });
        Object.assign(this.steps.style, { display: 'flex', gap: '0', padding: '0 16px', borderBottom: '1px solid var(--akari-line-inner)',
            background: 'var(--akari-card)' });
        Object.assign(this.body.style, { flex: '1', overflow: 'auto', padding: '18px', minHeight: '0' });
        Object.assign(this.foot.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 18px',
            borderTop: '1px solid var(--akari-line-inner)' });
        this.notice.setAttribute('role', 'status');
        this.notice.style.cssText = 'margin:0 18px;color:var(--akari-warning);min-height:18px';
        this.controlPanel.style.display = 'none';
        this.contentNode.append(this.steps, this.body, this.notice, this.foot);
        const preferred = this.preferences.get<string>('akari.transcribe.backend', 'auto');
        this.backend = typeof preferred === 'string' ? preferred : 'auto';
        const preferredCompare = this.preferences.get<unknown>('akari.transcribe.compareSet', []);
        this.compareSet = new Set(Array.isArray(preferredCompare) ? preferredCompare.filter((id): id is string => typeof id === 'string') : []);
        this.autoCuts = this.preferences.get<boolean>('akari.transcribe.autoCuts', true) !== false;
        this.restoreSpeakerChoice();
        this.ready = this.initialize().catch(error => { this.notice.textContent = String(error); });
        this.render();
    }

    get wasCancelled(): boolean { return this.cancelled; }
    get value(): void { return undefined; }
    protected get speakerStorageKey(): string { return `akari.transcribe.speakers:${this.root.toString()}`; }
    protected restoreSpeakerChoice(): void {
        try {
            const stored = JSON.parse(window.localStorage.getItem(this.speakerStorageKey) ?? '{}');
            this.split = stored.split === true;
            this.speakerCount = ['auto', '1', '2', '3', '4'].includes(stored.count) ? stored.count : 'auto';
            this.identify = stored.identify === true;
            this.excludedPeople = new Set(Array.isArray(stored.excluded)
                ? stored.excluded.filter((id: unknown): id is string => typeof id === 'string') : []);
        } catch { /* A broken saved choice falls back to the defaults. */ }
        if (!channelPeopleLocation(this.root.toString())) this.identify = false;
    }
    protected saveSpeakerChoice(): void {
        try {
            window.localStorage.setItem(this.speakerStorageKey, JSON.stringify({ split: this.split,
                count: this.speakerCount, identify: this.identify, excluded: [...this.excludedPeople] }));
        } catch { /* Storage can be unavailable. */ }
    }
    protected finishStep(): number { return this.split ? 4 : 3; }
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
        const location = channelPeopleLocation(this.root.toString());
        if (location) {
            try {
                this.peopleSource = (await this.files.readFile(new URI(location.peopleUri))).value.toString();
                this.people = orderChannelPeople(parseChannelPeople(this.peopleSource));
                if (!this.people.some(person => person.hasVoiceSample)) this.identify = false;
            } catch { this.identify = false; }
        }
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
            const analysisUri = this.root.resolve(`.akari/sidecars/${source.path}.analysis/analysis.json`);
            let analysis: { probe?: { duration_s?: number; streams?: Array<{ codec_type?: string }> };
                transcript?: unknown[]; tracks?: { speakers?: unknown } } = {};
            try { analysis = JSON.parse((await this.files.readFile(analysisUri)).value.toString()); } catch { /* New material. */ }
            if (source.id === '__requested_material__') {
                const eligibility = captionSourceEligibility(source, { projectRoot: this.root.toString() });
                return { ...source, name: source.path.replace(/\\/gu, '/').split('/').pop() || source.path,
                    status: eligibility.status, reason: eligibility.status === 'excluded'
                        ? eligibility.reason : t('transcript.captionPopup.dialog.assetsNotYetTimelineLabel'),
                    hasTranscript: states[source.path] === 'done' || Array.isArray(analysis.transcript),
                    hasSpeakers: analysisHasSpeakers(analysis), unlisted: eligibility.status !== 'excluded' };
            }
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
                hasTranscript: states[source.path] === 'done' || Array.isArray(analysis.transcript),
                hasSpeakers: analysisHasSpeakers(analysis) };
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
            if (this.tools.find(tool => tool.id === 'voice')?.canIdentify === false) {
                this.identify = false;
                this.saveSpeakerChoice();
            }
            if (!this.isDisposed) this.render();
        });
    }

    protected sourceCard(source: PopupSource): HTMLElement {
        const row = el('label');
        row.dataset.sourceId = source.id;
        Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', margin: '7px 0',
            border: `1px solid ${this.selected.has(source.id) ? 'var(--akari-accent)' : 'var(--akari-line)'}`, borderRadius: '9px',
            background: source.status === 'excluded' ? 'var(--akari-elevated)' : 'var(--akari-card)', opacity: source.status === 'excluded' ? '.65' : '1' });
        const check = el('input'); check.type = 'checkbox'; check.checked = this.selected.has(source.id);
        check.disabled = source.status === 'excluded' || this.running;
        check.onchange = () => {
            if (check.checked) this.selected.add(source.id);
            else this.selected.delete(source.id);
            this.invalidateRun(); this.render();
        };
        const icon = el('span');
        icon.style.cssText = 'width:48px;height:36px;display:grid;place-items:center;color:var(--akari-muted)';
        if (source.status === 'excluded') {
            const extension = normalizedCaptionPath(source.path).match(/\.([a-z0-9]+)$/u)?.[1] ?? '';
            icon.textContent = CAPTION_IMAGE_EXTENSIONS.has(extension) ? '▧' : '▣';
        }
        else icon.innerHTML = '<svg width="42" height="28" viewBox="0 0 42 28" aria-hidden="true"><path d="M1 14h3l2-6 3 12 3-17 3 21 3-13 3 6 3-9 3 13 3-15 3 12 2-4h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
        const detail = el('span'); detail.style.flex = '1'; detail.style.minWidth = '0';
        detail.append(el('strong', source.name));
        const subtitle = el('small', source.reason ?? source.path);
        subtitle.style.cssText = `display:block;margin-top:3px;color:${source.status === 'excluded' ? 'var(--akari-warning)' : 'var(--akari-muted)'};overflow-wrap:anywhere`;
        detail.append(subtitle);
        const meta = el('span', source.duration === undefined ? '—:—' : time(source.duration));
        meta.style.cssText = 'color:var(--akari-muted);text-align:right;white-space:nowrap';
        if (source.hasTranscript) {
            const chip = el('small', t('transcript.captionPopup.dialog.transcribedWithValueLabel', { value1: source.summary?.split(' · ')[0] ?? '' }));
            chip.style.cssText = 'display:block;margin-top:5px;padding:3px 6px;border-radius:10px;background:color-mix(in srgb, var(--akari-success) 16%, transparent);color:var(--akari-success)';
            meta.append(chip);
        }
        row.append(check, icon, detail, meta);
        if (source.status === 'voice' && !isCaptionVideo(source) && this.videoSourceIds.size) {
            row.style.flexWrap = 'wrap';
            const syncRow = el('div');
            syncRow.style.cssText = 'flex:0 0 100%;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-left:87px;box-sizing:border-box';
            const syncLabel = el('small', t('transcript.captionPopup.dialog.videoCutTogetherLabel'));
            syncLabel.style.color = 'var(--akari-muted)';
            const sync = el('select');
            sync.setAttribute('aria-label', t('transcript.captionPopup.dialog.syncVideoWithAssetAriaLabel', { value1: source.name }));
            for (const [id, label] of [['', t('transcript.captionPopup.dialog.noneLabel')], ...[...this.videoSourceIds].map(id =>
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
            const hint = el('small', t('transcript.captionPopup.dialog.syncAudioToVideoInstruction'));
            hint.style.color = 'var(--akari-muted)';
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
                daihonHistoryService()?.push({ label: videoSource ? t('transcript.captionPopup.dialog.syncVideoLabel') : t('transcript.captionPopup.dialog.removeSyncLabel'),
                    undo: async () => void await this.files.writeFile(editUri, BinaryBuffer.fromString(before)),
                    redo: async () => void await this.files.writeFile(editUri, BinaryBuffer.fromString(after)) });
            }
            if (videoSource) this.syncChoice.set(audioSource, videoSource);
            else this.syncChoice.delete(audioSource);
            return true;
        } catch (error) {
            this.notice.textContent = t('transcript.captionPopup.dialog.couldNotSaveSyncWithDetailError', { value1: error instanceof Error ? error.message : String(error) });
            this.render();
            return false;
        }
    }

    protected renderSources(): void {
        this.body.append(el('h3', t('transcript.captionPopup.dialog.whichAssetVoiceShouldBecomeCaptionsText')),
            el('p', t('transcript.captionPopup.dialog.onlyAssetsTimelineMayContainSpeechShownMessage')));
        if (this.unsupportedTimeline) {
            const reason = el('p', t('transcript.captionPopup.dialog.captionsCannotCreatedTimelineYetUseMainTimelineMessage'));
            reason.setAttribute('role', 'alert'); reason.style.color = 'var(--akari-warning)'; this.body.append(reason);
        }
        const voice = this.sources.filter(source => source.status === 'voice');
        for (const source of voice) this.body.append(this.sourceCard(source));
        const others = this.sources.filter(source => source.status !== 'voice');
        if (others.length) {
            const more = el('details'); more.open = this.showMore;
            more.ontoggle = () => { this.showMore = more.open; };
            more.append(el('summary', t('transcript.captionPopup.dialog.otherAssetsBgmExcludedWithValuesText', { value1: others.length, value2: others.filter(source => source.status === 'bgm').length, value3: others.filter(source => source.status === 'excluded').length })));
            for (const source of others) more.append(this.sourceCard(source));
            this.body.append(more);
        }
    }

    // Each build replaces only that source's rows, so selected materials run in source order.
    protected selectedSources(): PopupSource[] { return this.sources.filter(source => this.selected.has(source.id)); }
    protected selectedSource(): PopupSource | undefined { return this.selectedSources()[0]; }
    protected sourceNeedsTranscription(source: PopupSource): boolean {
        return this.split && !source.hasSpeakers || !source.hasTranscript || !this.reuse || this.compare;
    }
    protected needsTranscription(): boolean { return this.selectedSources().some(source => this.sourceNeedsTranscription(source)); }
    protected diarizeNeeded(): boolean {
        return this.split && this.selectedSources().some(source => this.sourceNeedsTranscription(source));
    }
    protected voiceGateBlocks(): boolean {
        return voiceGateBlocks({ split: this.split, needsRun: this.diarizeNeeded(),
            availabilityLoaded: this.availabilityLoaded, engineReady: voiceEngineReady(this.tools) });
    }
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
            this.body.append(el('h3', t('transcript.captionPopup.dialog.someAssetsAlreadyTranscribedText')));
            for (const [value, label, detail] of [[true, t('transcript.captionPopup.dialog.usePreviousTranscriptDescription'), t('transcript.captionPopup.dialog.willFinishQuicklyWithValueDescription', { value1: selected.find(source => source.hasTranscript)?.summary ?? t('transcript.captionPopup.dialog.statusTranscribed') })],
                [false, t('transcript.captionPopup.dialog.transcribeAgainLabel'), t('transcript.captionPopup.dialog.keepManuallyEditedLinesReplaceRestNewResultMessage')]] as const) {
                const row = el('label'); row.style.cssText = 'display:block;padding:8px';
                const radio = el('input'); radio.type = 'radio'; radio.name = 'reuse'; radio.checked = this.reuse === value;
                radio.onchange = () => { this.reuse = value; this.invalidateRun(); this.render(); };
                const body = el('span', ` ${label}`);
                const small = el('small', detail); small.style.cssText = 'display:block;margin-left:23px;color:var(--akari-muted)';
                body.append(small); row.append(radio, body);
                this.body.append(row);
            }
        }
        if (!this.needsTranscription()) {
            const note = el('small', t('transcript.captionPopup.dialog.previousTranscriptWillUsedSoNoEngineNeededMessage'));
            note.style.cssText = 'display:block;margin:10px 0;color:var(--akari-muted)'; this.body.append(note);
        }
        this.body.append(el('h3', t('transcript.captionPopup.dialog.whichEngineShouldTranscribeText')), el('p', t('transcript.captionPopup.dialog.ifUnsureLeaveAutoSelectedContinueText')));
        const engines = [{ id: 'auto', label: t('transcript.captionPopup.dialog.autoDescription'), facts: t('transcript.captionPopup.dialog.chooseAvailableEngineComputerDescription'), place: t('transcript.captionPopup.dialog.preferLocalDescription'), hourlyUsd: 0 }, ...TRANSCRIBE_ENGINE_CARDS];
        const grid = el('div');
        Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' });
        for (const engine of engines) {
            const autoReady = TRANSCRIBE_ENGINE_CARDS.some(card => card.hourlyUsd === 0
                && transcribeEngineAvailability(card.id, this.tools, this.connections).state === 'available');
            const available = engine.id === 'auto' ? autoReady
                ? { state: 'available', label: t('transcript.captionPopup.dialog.availableLabel') }
                : { state: 'needs', label: t('transcript.captionPopup.dialog.setupRequiredNoLocalEngineFoundLabel') }
                : transcribeEngineAvailability(engine.id, this.tools, this.connections);
            const disabled = engine.id !== 'auto' && (!this.availabilityLoaded || available.state !== 'available');
            const row = el('label');
            Object.assign(row.style, { display: 'block', padding: '11px 13px', margin: '0', borderRadius: '9px',
                border: `1px solid ${this.backend === engine.id ? 'var(--akari-accent)' : 'var(--akari-line)'}`,
                background: engine.id === 'auto' ? 'var(--akari-elevated)' : 'var(--akari-card)', opacity: disabled ? '.5' : '1' });
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
                const badge = el('small', t('transcript.captionPopup.dialog.recommendedText')); badge.style.cssText = 'margin-left:8px;color:var(--akari-warning)'; name.append(badge);
            }
            const detail = el('small', `${engine.facts} · ${engine.place}`);
            detail.style.cssText = 'display:block;margin:4px 0 0 22px;color:var(--akari-muted)';
            const badge = el('small', this.availabilityLoaded ? available.label : t('transcript.captionPopup.dialog.ongoingCheckingLabel'));
            badge.style.cssText = `display:inline-block;margin:7px 0 0 22px;padding:3px 7px;border-radius:10px;${disabled || available.state !== 'available'
                ? 'background:var(--akari-elevated);color:var(--akari-muted)'
                : 'background:color-mix(in srgb, var(--akari-success) 16%, transparent);color:var(--akari-success)'}`;
            row.append(radio, name, detail, badge);
            grid.append(row);
        }
        this.body.append(grid);
        this.renderSpeakerMethod();
        if (this.needsTranscription() && this.availabilityLoaded && !this.enginesReady()) {
            this.body.append(el('p', t('transcript.captionPopup.dialog.chooseAvailableEngineText')));
        }
        const clouds = this.needsTranscription() ? this.selectedClouds() : [];
        if (clouds.length) {
            const transcribed = selected.filter(source => this.sourceNeedsTranscription(source));
            const seconds = transcribed.reduce((sum, source) => sum + (source.duration ?? 0), 0);
            const hourly = clouds.reduce((sum, engine) => sum + engine.hourlyUsd, 0);
            const cost = transcribed.every(source => source.duration !== undefined)
                ? t('transcript.captionPopup.dialog.assetsAboutMinAboutWithValuesLabel', { value1: transcribed.length, n: transcribed.length, value2: Math.ceil(seconds / 60), value3: (seconds * hourly / 3600).toFixed(2) })
                : t('transcript.captionPopup.dialog.perHourWithRateLabel', { value1: hourly.toFixed(2) });
            const note = el('p', t('transcript.captionPopup.dialog.cloudAudioCostConfirmation', { value1: clouds.map(engine => engine.label).join(t('transcript.shared.list.separator')), value2: cost }));
            note.style.cssText = 'padding:11px;border:1px solid var(--akari-warning);border-radius:7px;color:var(--akari-warning)';
            note.dataset.akariCloudCost = cost;
            this.body.append(note);
        }
        const details = el('details'); details.open = this.showDetails;
        details.ontoggle = () => { this.showDetails = details.open; };
        details.append(el('summary', t('transcript.captionPopup.dialog.detailsDescription')));
        const compare = el('label'); compare.style.cssText = 'display:block;padding:10px';
        const toggle = el('input'); toggle.type = 'checkbox'; toggle.checked = this.compare; toggle.disabled = this.split;
        toggle.onchange = () => {
            this.compare = toggle.checked;
            if (this.compare && this.backend !== 'auto') this.compareSet.add(this.backend);
            this.invalidateRun(); this.render();
        };
        compare.append(toggle, t('transcript.captionPopup.dialog.leadingCompareResultsFromTwoMoreEnginesDescription'));
        if (this.split) compare.append(el('small', t('transcript.captionPopup.dialog.speakerCompareUnavailable')));
        details.append(compare);
        this.body.append(details);
    }

    protected renderSpeakerMethod(): void {
        const section = el('section'); section.style.cssText = 'margin:18px 0;padding-top:12px;border-top:1px solid var(--akari-line-inner)';
        section.append(el('h3', t('transcript.captionPopup.dialog.splitQuestion')), el('p', t('transcript.captionPopup.dialog.splitExplanation')));
        const choices = el('div'); choices.style.cssText = 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px';
        for (const [value, title, detail] of [[false, t('transcript.captionPopup.dialog.noSplit'), t('transcript.captionPopup.dialog.noSplitDetail')],
            [true, t('transcript.captionPopup.dialog.split'), t('transcript.captionPopup.dialog.splitDetail')]] as const) {
            const card = el('label');
            card.style.cssText = `display:block;padding:11px 13px;border:1px solid ${this.split === value ? 'var(--akari-accent)' : 'var(--akari-line)'};border-radius:9px;background:${this.split === value ? 'var(--akari-elevated)' : 'var(--akari-card)'}`;
            const radio = el('input'); radio.type = 'radio'; radio.name = 'speaker-split'; radio.checked = this.split === value;
            radio.onchange = () => { this.split = value; if (value) { this.voiceInstallError = ''; this.compare = false; }
                this.saveSpeakerChoice(); this.invalidateRun(); this.render(); };
            const name = el('strong', ` ${title}`);
            if (value) { const tag = el('small', t('transcript.captionPopup.dialog.advanced')); tag.style.cssText = 'margin-left:8px;color:var(--akari-warning)'; name.append(tag); }
            const small = el('small', detail); small.style.cssText = 'display:block;margin:4px 0 0 22px;color:var(--akari-muted)';
            card.append(radio, name, small); choices.append(card);
        }
        section.append(choices);
        if (this.split) {
            section.append(el('h3', t('transcript.captionPopup.dialog.speakerCountQuestion')));
            const counts = el('div'); counts.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px';
            for (const [value, label] of [['auto', t('transcript.captionPopup.dialog.unknownCount')], ['1', t('transcript.captionPopup.dialog.onePerson')], ['2', t('transcript.captionPopup.dialog.twoPeople')], ['3', t('transcript.captionPopup.dialog.threePeople')], ['4', t('transcript.captionPopup.dialog.fourPlusPeople')]] as const) {
                const choice = plainButton(label, () => { this.speakerCount = value; this.saveSpeakerChoice(); this.invalidateRun(); this.render(); });
                choice.setAttribute('aria-pressed', String(this.speakerCount === value));
                if (this.speakerCount === value) { choice.style.borderColor = 'var(--akari-accent)'; choice.style.background = 'var(--akari-elevated)'; }
                counts.append(choice);
            }
            section.append(counts, el('p', this.speakerCount === 'auto'
                ? t('transcript.captionPopup.dialog.guessCount')
                : t('transcript.captionPopup.dialog.splitWithCount', { count: this.speakerCount === '4'
                    ? t('transcript.captionPopup.dialog.fourPlusPeople')
                    : t('transcript.captionPopup.dialog.personCount', { count: this.speakerCount }) })));
            const location = channelPeopleLocation(this.root.toString());
            if (location) {
                section.append(el('h3', t('transcript.captionPopup.dialog.identifyQuestion')));
                const hasVoices = this.people.some(person => person.hasVoiceSample);
                for (const [value, title, detail] of [[true, t('transcript.captionPopup.dialog.identify'), t('transcript.captionPopup.dialog.identifyDetail')],
                    [false, t('transcript.captionPopup.dialog.noIdentify'), t('transcript.captionPopup.dialog.noIdentifyDetail')]] as const) {
                    const row = el('label'); row.style.cssText = 'display:block;padding:8px';
                    const radio = el('input'); radio.type = 'radio'; radio.name = 'speaker-identify'; radio.checked = this.identify === value;
                    radio.disabled = value && (!hasVoices || this.tools.find(tool => tool.id === 'voice')?.canIdentify === false);
                    radio.onchange = () => { this.identify = value; this.saveSpeakerChoice(); this.invalidateRun(); this.render(); };
                    const caption = el('span', ` ${title}`); const sub = el('small', detail);
                    sub.style.cssText = 'display:block;margin-left:23px;color:var(--akari-muted)'; caption.append(sub);
                    row.append(radio, caption); section.append(row);
                }
                if (this.tools.find(tool => tool.id === 'voice')?.canIdentify === false) {
                    section.append(el('p', t('transcript.captionPopup.dialog.macNoIdentify')));
                }
                if (this.identify && hasVoices) {
                    for (const person of this.people) {
                        const row = el('label'); row.style.cssText = `display:flex;align-items:center;gap:9px;padding:8px;opacity:${person.hasVoiceSample ? '1' : '.5'}`;
                        const check = el('input'); check.type = 'checkbox'; check.checked = person.hasVoiceSample && !this.excludedPeople.has(person.id);
                        check.disabled = !person.hasVoiceSample;
                        check.onchange = () => { if (check.checked) this.excludedPeople.delete(person.id); else this.excludedPeople.add(person.id);
                            this.saveSpeakerChoice(); this.render(); };
                        const face = el('span', person.name[0] ?? t('transcript.captionPopup.dialog.personInitialFallback'));
                        face.style.cssText = 'display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--akari-elevated)';
                        const status = el('small', person.hasVoiceSample
                            ? t('transcript.captionPopup.dialog.voiceSampleCount', { count: channelPersonVoiceSampleCount(this.peopleSource, person.id) }) : t('transcript.captionPopup.dialog.noVoiceSample'));
                        status.style.cssText = 'margin-left:auto;color:var(--akari-muted)';
                        row.append(check, face, el('span', person.name), status); section.append(row);
                    }
                    section.append(el('small', t('transcript.captionPopup.dialog.voiceSampleHelp')));
                }
            }
            if (this.voiceGateBlocks()) {
                const warning = el('div'); warning.style.cssText = 'padding:11px;border:1px solid var(--akari-warning);border-radius:7px;color:var(--akari-warning);margin-top:12px';
                warning.append(el('span', t('transcript.captionPopup.dialog.voiceDownloadNeeded', { megabytes: VOICE_ENGINE_DOWNLOAD_MB })));
                if (this.installingVoice) { warning.append(el('span', t('transcript.captionPopup.dialog.voicePreparing')), el('progress')); }
                else warning.append(button(this.voiceInstallError ? t('transcript.captionPopup.dialog.retry') : t('transcript.captionPopup.dialog.prepare'), () => void this.installVoice()));
                section.append(warning);
            }
        }
        if (this.voiceInstallError) {
            const warning = el('p', this.voiceInstallError);
            warning.style.cssText = 'padding:11px;border:1px solid var(--akari-warning);border-radius:7px;color:var(--akari-warning)';
            section.append(warning);
        }
        this.body.append(section);
    }

    protected async installVoice(): Promise<void> {
        this.installingVoice = true; this.voiceInstallError = ''; this.render();
        try {
            const result = await this.commands.executeCommand<{ outcome?: string; message?: string } | undefined>('akari.tools.install', 'voice');
            const failure = voiceInstallFailure(result);
            if (failure) throw new Error(failure);
            const status = await this.commands.executeCommand<{ tools: TranscribeToolStatus[] }>('akari.settings.readStatus', '/services/akari-surfaces-new-project');
            this.tools = status?.tools ?? [];
            if (this.tools.find(tool => tool.id === 'voice')?.canIdentify === false) {
                this.identify = false;
                this.saveSpeakerChoice();
            }
            if (!voiceEngineReady(this.tools)) throw new Error(t('transcript.captionPopup.dialog.voiceMissing'));
        } catch (error) {
            this.voiceInstallError = error instanceof Error ? error.message : t('transcript.captionPopup.dialog.prepareFailed');
        } finally { this.installingVoice = false; this.render(); }
    }

    protected renderProgress(): void {
        this.body.append(el('h3', t('transcript.captionPopup.dialog.transcribingText')));
        this.body.append(el('p', t('transcript.captionPopup.dialog.backgroundTranscriptionNotice')));
        for (const source of this.selectedSources()) {
            const row = el('div'); row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--akari-line-inner)';
            const done = this.completedSources.has(source.id);
            const label = el('div', `${source.name} · ${done ? t('transcript.captionPopup.dialog.statusComplete') : source === this.currentSource ? this.progressText() : t('transcript.captionPopup.dialog.statusWaiting')}`);
            if (source === this.currentSource) label.dataset.akariTranscribeProgress = 'true';
            const bar = el('progress'); bar.max = 1;
            if (done) bar.value = 1;
            else if (source !== this.currentSource) bar.value = 0;
            bar.style.cssText = 'width:100%;height:8px;accent-color:var(--akari-accent)';
            row.append(label);
            if (!this.split) row.append(bar);
            this.body.append(row);
            if (this.split) {
                const stages = [[t('transcript.captionPopup.dialog.transcribingStage'), true],
                    [t('transcript.captionPopup.dialog.splitStage', { count: this.speakerCount === 'auto'
                        ? t('transcript.captionPopup.dialog.countAuto')
                        : this.speakerCount === '4' ? t('transcript.captionPopup.dialog.fourPlusPeople')
                            : t('transcript.captionPopup.dialog.personCount', { count: this.speakerCount }) }), false],
                    ...(this.identify ? [[t('transcript.captionPopup.dialog.identifyStage', {
                        count: this.people.filter(person => person.hasVoiceSample && !this.excludedPeople.has(person.id)).length }), false] as const] : [])] as const;
                for (const [stage] of stages) {
                    const caption = el('small', stage); caption.style.cssText = 'display:block;margin:7px 0 2px';
                    const stageBar = el('progress'); stageBar.max = 1;
                    if (done) stageBar.value = 1;
                    else if (source !== this.currentSource) stageBar.value = 0;
                    stageBar.style.cssText = 'width:100%;height:7px;accent-color:var(--akari-accent)';
                    row.append(caption, stageBar);
                }
            }
        }
        if (this.split) this.body.append(el('p', this.speakerCount === 'auto'
            ? t('transcript.captionPopup.dialog.splitDelayAuto')
            : t('transcript.captionPopup.dialog.splitDelayKnown')));
        if (this.currentSource) {
            const backends = this.compare ? [...this.compareSet] : [this.backend];
            const columns = el('div');
            Object.assign(columns.style, { display: 'grid', gridTemplateColumns: `repeat(${backends.length}, minmax(0, 1fr))`, gap: '8px' });
            for (const backend of backends) {
                const column = el('section');
                column.style.cssText = 'padding:10px;border:1px solid var(--akari-line);border-radius:8px;min-width:0';
                column.append(el('strong', TRANSCRIBE_ENGINE_CARDS.find(engine => engine.id === backend)?.label ?? backend),
                    el('p', this.engineProgress.get(backend) ?? t('transcript.captionPopup.dialog.waitingLabel')));
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

    protected async loadSpeakerReview(): Promise<void> {
        this.speakerRows.clear();
        this.speakerFallbacks.clear();
        for (const source of this.selectedSources()) {
            const folder = this.root.resolve(`.akari/sidecars/${source.path}.analysis`);
            const voices = await this.files.readFile(folder.resolve('voices.json'))
                .then(file => parseVoicesSidecar(file.value.toString()), () => undefined);
            const analysis = await this.files.readFile(folder.resolve('analysis.json'))
                .then(file => { try { return JSON.parse(file.value.toString()) as unknown; } catch { return undefined; } }, () => undefined);
            this.speakerRows.set(source.id, speakerReviewRows(voices, analysis));
            const fallback = speakerFallbackMessage(voices, this.speakerRows.get(source.id)?.length ?? 0);
            if (fallback) this.speakerFallbacks.set(source.id, fallback);
        }
        try {
            const raw = JSON.parse((await this.files.readFile(this.root.resolve('.akari/dictionary.json'))).value.toString()) as {
                speakers?: Record<string, { name: string; person?: string }> };
            this.speakerDictionary = raw.speakers ?? {};
        } catch { this.speakerDictionary = {}; }
    }

    protected renderSpeakerReview(): void {
        this.body.append(el('h3', t('transcript.captionPopup.dialog.reviewSpeakersAction')), el('p', this.identify
            ? t('transcript.captionPopup.dialog.suggestionExplanation')
            : t('transcript.captionPopup.dialog.manualNameExplanation')));
        const location = channelPeopleLocation(this.root.toString());
        for (const source of this.selectedSources()) {
            this.body.append(el('h4', source.name));
            const fallback = this.speakerFallbacks.get(source.id);
            if (fallback) this.body.append(el('p', fallback));
            const rows = this.speakerRows.get(source.id) ?? [];
            if (!rows.length) {
                this.body.append(el('p', t('transcript.captionPopup.dialog.noSpeakerInfo')));
                continue;
            }
            for (const row of rows) {
                const key = `${source.id}:${row.id}`;
                const card = el('section'); card.style.cssText = 'padding:12px;margin:9px 0;border:1px solid var(--akari-line);border-radius:9px;background:var(--akari-card)';
                const top = el('div'); top.style.cssText = 'display:flex;align-items:center;gap:10px';
                const chip = el('span', row.id); chip.style.cssText = `display:grid;place-items:center;min-width:28px;height:28px;border-radius:7px;background:${SPEAKER_COLORS[Math.max(0, row.id.charCodeAt(0) - 65) % SPEAKER_COLORS.length]};color:white`;
                const decision = this.speakerDictionary[row.id];
                const suggestion = row.suggestion;
                const name = decision?.name ?? (row.decided ? this.people.find(person => `${location?.channel}/${person.id}` === row.decided)?.name : undefined)
                    ?? (this.identify && suggestion?.name && suggestion.level === 'strong' ? t('transcript.captionPopup.dialog.strongSuggestion', { name: suggestion.name })
                        : this.identify && suggestion?.name && suggestion.level === 'maybe' ? t('transcript.captionPopup.dialog.maybeSuggestion', { name: suggestion.name })
                            : t('transcript.captionPopup.dialog.speakerLabel', { id: row.id }));
                const info = el('span'); info.style.flex = '1'; info.append(el('strong', decision || row.decided ? t('transcript.captionPopup.dialog.decidedName', { name }) : name));
                const detail = el('small', t('transcript.captionPopup.dialog.speakerDuration', {
                    minutes: Math.floor(row.seconds / 60), seconds: Math.round(row.seconds % 60),
                    excerpt: row.firstLine ? t('transcript.captionPopup.dialog.speakerExcerpt', { text: row.firstLine }) : '' }));
                detail.style.cssText = 'display:block;color:var(--akari-muted)'; info.append(detail);
                if (row.shortNote) {
                    const note = el('small', row.shortNote);
                    note.style.cssText = 'display:block;color:var(--akari-muted)';
                    info.append(note);
                }
                const score = el('small', !this.identify || !suggestion ? t('transcript.captionPopup.dialog.notCompared')
                    : suggestion.level === 'none' ? t('transcript.captionPopup.dialog.noMatch')
                        : suggestion.name ? `${suggestion.name} ${suggestion.score.toFixed(2)}` : t('transcript.captionPopup.dialog.noMatch'));
                const scoreColor = this.identify && suggestion?.level === 'strong' ? 'var(--akari-success)'
                    : this.identify && suggestion?.level === 'maybe' ? 'var(--akari-warning)' : 'var(--akari-muted)';
                score.style.cssText = `padding:3px 7px;border-radius:9px;background:color-mix(in srgb, ${scoreColor} 14%, var(--akari-elevated));color:${scoreColor}`;
                top.append(chip, info, score); card.append(top);
                const actions = el('div'); actions.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;margin-top:10px';
                if (!decision && !row.decided && this.identify && suggestion?.person && suggestion.name && suggestion.level !== 'none') {
                    const accept = button(t('transcript.captionPopup.dialog.acceptName', { name: suggestion.name }), () => void this.decideSpeaker(source, row.id,
                        { name: suggestion.name!, person: suggestion.person }));
                    if (suggestion.level === 'strong') accept.className = 'theia-button';
                    actions.append(accept);
                }
                const other = button(decision || row.decided || this.identify && (suggestion?.level === 'strong' || suggestion?.level === 'maybe')
                    ? t('transcript.captionPopup.dialog.anotherPerson') : t('transcript.captionPopup.dialog.linkPerson'), () => { this.expandedSpeaker = this.expandedSpeaker === key ? '' : key; this.render(); });
                actions.append(other);
                if (row.firstSpan) actions.append(button(t('transcript.captionPopup.dialog.listen'), () => void this.listen(row.firstSpan!.start,
                    row.firstSpan!.end, source.path).catch(error => { this.notice.textContent = String(error); })));
                card.append(actions);
                if (this.expandedSpeaker === key) {
                    const picker = el('div'); picker.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px';
                    for (const person of this.people) picker.append(button(person.name, () => void this.decideSpeaker(source, row.id,
                        { name: person.name, person: `${location!.channel}/${person.id}` })));
                    const input = el('input'); input.type = 'text'; input.placeholder = t('transcript.captionPopup.dialog.nameOnly'); input.setAttribute('aria-label', t('transcript.captionPopup.dialog.nameOnly'));
                    const save = () => { if (input.value.trim()) void this.decideSpeaker(source, row.id, { name: input.value.trim() }); };
                    input.onkeydown = event => { if (event.key === 'Enter') save(); };
                    picker.append(input, button(t('transcript.captionPopup.dialog.nameOnly'), save)); card.append(picker);
                    if (decision || row.decided) picker.append(button(t('transcript.captionPopup.dialog.unlink'), () => void this.clearSpeakerDecision(source, row.id)));
                }
                this.body.append(card);
            }
        }
        this.body.append(el('p', t('transcript.captionPopup.dialog.scoreExplanation')));
    }

    protected async decideSpeaker(source: PopupSource, id: string, value: { name: string; person?: string }): Promise<void> {
        try {
            const folder = this.root.resolve('.akari');
            const dictionary = folder.resolve('dictionary.json');
            const previous = await this.files.readFile(dictionary).then(file => file.value.toString(), () => '');
            if (!await this.files.exists(folder)) await this.files.createFolder(folder);
            await this.files.writeFile(dictionary, BinaryBuffer.fromString(mergeSpeakerDictionary(previous, id, value)));
            const voices = this.root.resolve(`.akari/sidecars/${source.path}.analysis/voices.json`);
            if (value.person && await this.files.exists(voices)) {
                const raw = (await this.files.readFile(voices)).value.toString();
                await this.files.writeFile(voices, BinaryBuffer.fromString(mergeVoicesDecided(raw, id, value.person)));
            }
            this.expandedSpeaker = '';
            await this.loadSpeakerReview(); this.render();
        } catch (error) { this.notice.textContent = String(error); }
    }

    protected async clearSpeakerDecision(source: PopupSource, id: string): Promise<void> {
        try {
            const dictionary = this.root.resolve('.akari/dictionary.json');
            const previous = await this.files.readFile(dictionary).then(file => file.value.toString(), () => '');
            await this.files.writeFile(dictionary, BinaryBuffer.fromString(mergeSpeakerDictionary(previous, id, undefined)));
            const voices = this.root.resolve(`.akari/sidecars/${source.path}.analysis/voices.json`);
            if (await this.files.exists(voices)) {
                const raw = (await this.files.readFile(voices)).value.toString();
                await this.files.writeFile(voices, BinaryBuffer.fromString(clearVoicesDecided(raw, id)));
            }
            this.expandedSpeaker = '';
            await this.loadSpeakerReview(); this.render();
        } catch (error) { this.notice.textContent = String(error); }
    }

    protected renderFinish(): void {
        this.body.append(el('h3', t('transcript.captionPopup.dialog.finishText')));
        if (this.finished) this.body.append(el('p', t('transcript.captionPopup.dialog.cutCandidatesNothingHasBeenCutYetWithCountText', { value1: this.cutCandidateCount })));
        if (this.notice.textContent) {
            const error = el('p', this.notice.textContent);
            error.setAttribute('role', 'alert'); error.style.color = 'var(--akari-warning)';
            this.body.append(error);
        }
        if (this.preview) {
            const metrics = el('div');
            metrics.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0 18px';
            for (const [label, count] of [[t('transcript.captionPopup.dialog.newLinesLabel'), this.preview.added], [t('transcript.captionPopup.dialog.changedLinesLabel'), this.preview.changed],
                [t('transcript.captionPopup.dialog.manuallyEditedLinesProtectedLabel'), this.preview.protected], [t('transcript.captionPopup.dialog.removedLinesLabel'), this.preview.removed]] as const) {
                const tile = el('div'); tile.style.cssText = 'padding:12px;background:var(--akari-card);border:1px solid var(--akari-line);border-radius:8px';
                const number = el('strong', String(count)); number.style.cssText = 'display:block;font-size:25px;color:var(--akari-warning)';
                const caption = el('small', label); caption.style.color = 'var(--akari-muted)';
                tile.append(number, caption); metrics.append(tile);
            }
            this.body.append(metrics);
        } else if (this.selectedSources().some(source => source.unlisted)) {
            this.body.append(el('p', t('transcript.captionPopup.dialog.unplacedAssetDiffDeferredNotice')));
        }
        if (this.artifacts.diff) {
            const diff = this.artifacts.diff;
            this.body.append(el('p', t('transcript.captionPopup.dialog.differencesAgreementWithValuesText', { value1: diff.items.length, value2: Math.round(diff.agreement * 100) })));
            const table = el('table'); table.style.width = '100%';
            const header = el('tr'); [t('transcript.captionPopup.dialog.timeText'), ...diff.engines, t('transcript.captionPopup.dialog.reviewText')].forEach(label => header.append(el('th', label))); table.append(header);
            for (const item of diff.items) {
                const row = el('tr'); row.append(el('td', `${item.start.toFixed(1)}–${item.end.toFixed(1)}`));
                for (const engine of diff.engines) row.append(el('td', item.texts[engine] || '—'));
                const listen = el('td'); listen.append(plainButton(t('transcript.captionPopup.dialog.playListenAction'), () => {
                    void this.listen(item.start, item.end, this.currentSource?.path ?? this.selectedSources()[0]?.path ?? '')
                        .catch(error => { this.notice.textContent = String(error); });
                }));
                row.append(listen);
                table.append(row);
            }
            this.body.append(table);
        }
        if (this.applied) return;
        this.body.append(el('h3', t('transcript.captionPopup.dialog.captionFormatText')));
        const group = (label: string): HTMLElement => { const node = el('section'); node.style.margin = '13px 0'; node.append(el('strong', label)); return node; };
        const chars = group(t('transcript.captionPopup.dialog.charactersPerLineLabel'));
        const range = el('input'); range.type = 'range'; range.min = '5'; range.max = '28'; range.value = String(this.chars);
        const value = el('span', t('transcript.captionPopup.dialog.leadingCharactersWithCountLabel', { value1: this.chars, n: this.chars }));
        range.oninput = () => { this.chars = Number(range.value); value.textContent = t('transcript.captionPopup.dialog.leadingCharactersWithCountText', { value1: this.chars, n: this.chars }); this.updateExample(); };
        chars.append(el('br'), range, value); this.body.append(chars);
        const lines = group(t('transcript.captionPopup.dialog.linesLabel'));
        for (const count of [1, 2] as const) {
            const choice = plainButton(t('transcript.captionPopup.dialog.linesWithCountAction', { value1: count, n: count }), () => { this.lines = count; this.render(); });
            choice.style.marginRight = '8px'; choice.setAttribute('aria-pressed', String(this.lines === count));
            if (this.lines === count) choice.style.borderColor = 'var(--akari-accent)';
            lines.append(choice);
        }
        this.body.append(lines);
        const timing = group(t('transcript.captionPopup.dialog.displayTimingLabel'));
        for (const [key, label] of [['full', t('transcript.captionPopup.dialog.tailLabel')], ['speech-tight', t('transcript.captionPopup.dialog.matchSpeechLabel')]] as const) {
            const choice = plainButton(label, () => { this.timing = key; this.render(); });
            choice.style.marginRight = '8px'; choice.setAttribute('aria-pressed', String(this.timing === key));
            if (this.timing === key) choice.style.borderColor = 'var(--akari-accent)';
            timing.append(choice);
        }
        this.body.append(timing);
        const karaoke = group(t('transcript.captionPopup.dialog.karaokeDisplayLabel'));
        const karaokeLabel = el('label');
        karaokeLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;cursor:pointer';
        const karaokeToggle = el('input'); karaokeToggle.type = 'checkbox'; karaokeToggle.checked = this.karaoke;
        karaokeToggle.onchange = () => { this.karaoke = karaokeToggle.checked; this.updateExample(); };
        karaokeLabel.append(karaokeToggle, el('span', t('transcript.captionPopup.dialog.textColorChangesSpeechText')));
        karaoke.append(karaokeLabel, el('small', t('transcript.captionPopup.dialog.canAlsoChangeEachLineSettingsText')));
        this.body.append(karaoke);
        const example = el('p'); example.dataset.akariCaptionExample = 'true';
        example.style.cssText = 'max-width:420px;padding:14px;background:var(--akari-card);border-radius:8px;line-height:1.6';
        this.body.append(example); this.updateExample();
        const afterNote = el('small', t('transcript.captionPopup.dialog.dropdownCanChangeLaterUnderDisplayScriptMessage'));
        afterNote.style.color = 'var(--akari-muted)'; this.body.append(afterNote);
        if (this.preview?.protected) {
            const force = group(t('transcript.captionPopup.dialog.manuallyEditedLinesLabel'));
            for (const [value, label] of [[false, t('transcript.captionPopup.dialog.protectRecommendedLabel')], [true, t('transcript.captionPopup.dialog.overwriteLabel')]] as const) {
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
                colored.style.color = 'var(--akari-accent)';
                line.append(colored, el('span', part.slice(Math.ceil(part.length / 2))));
            } else line.textContent = part;
            example.append(line);
        }
    }

    protected render(): void {
        if (this.isDisposed) return;
        this.node.dataset.step = String(this.step + 1);
        this.steps.replaceChildren(); this.body.replaceChildren(); this.foot.replaceChildren();
        captionPopupStepNames(this.split).forEach((name, index) => {
            const control = plainButton(`${index < this.step ? '✓' : index + 1} ${name}`, () => {
                if (popupCanNavigate(index, this.reached, this.running)) { this.step = index; this.render(); }
            }, !popupCanNavigate(index, this.reached, this.running));
            Object.assign(control.style, { flex: '1', height: 'auto', marginLeft: '0', border: 'none',
                borderBottom: index === this.step ? '2px solid var(--akari-accent)' : '2px solid transparent',
                borderRadius: '0', background: 'var(--akari-card)',
                color: index === this.step ? 'var(--akari-ink)' : 'var(--akari-muted)', padding: '13px 5px' });
            if (index === this.step) control.setAttribute('aria-current', 'step');
            this.steps.append(control);
        });
        if (this.step === 0) this.renderSources();
        else if (this.step === 1) this.renderMethod();
        else if (this.step === 2) this.renderProgress();
        else if (this.split && this.step === 3) this.renderSpeakerReview();
        else this.renderFinish();
        const spacer = el('span'); spacer.style.flex = '1';
        if (this.step === 0) {
            const selected = this.selectedSources();
            const duration = selected.reduce((sum, source) => sum + (source.duration ?? 0), 0);
            this.foot.append(el('span', t('transcript.captionPopup.dialog.assetsSelectedTotalWithValuesText', { value1: selected.length, n: selected.length, value2: time(duration) })), spacer);
            const next = button(t('transcript.captionPopup.dialog.nextAction'), () => { void (async () => {
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
            next.dataset.primary = 'true'; next.className = 'theia-button'; this.foot.append(next);
        } else if (this.step === 1) {
            this.foot.append(button(t('transcript.captionPopup.dialog.backAction'), () => { this.step = 0; this.render(); }), spacer);
            const start = button(t('transcript.captionPopup.dialog.transcribeAction'), () => void this.start(), !this.selected.size || this.unsupportedTimeline
                || !this.enginesReady() || this.voiceGateBlocks());
            start.dataset.primary = 'true'; start.className = 'theia-button'; this.foot.append(start);
        } else if (this.step === 2) {
            this.foot.append(el('span', this.finished ? t('transcript.captionPopup.dialog.transcriptionCompleteText') : t('transcript.captionPopup.dialog.ongoingTranscribingText')), spacer);
            if (this.running) this.foot.append(button(t('transcript.captionPopup.dialog.cancelAction'), () => void this.cancel()));
            else if (this.finished) {
                const next = button(this.split ? t('transcript.captionPopup.dialog.reviewSpeakersAction') : t('transcript.captionPopup.dialog.goFinishAction'), () => {
                    this.step = 3; this.reached = 3; this.render(); });
                next.dataset.primary = 'true'; next.className = 'theia-button'; this.foot.append(next);
            } else this.foot.append(button(t('transcript.captionPopup.dialog.backTranscriptionMethodAction'), () => { this.step = 1; this.render(); }));
        } else if (this.split && this.step === 3) {
            this.foot.append(button(t('transcript.captionPopup.dialog.backAction'), () => { this.step = 2; this.render(); }), spacer);
            const next = button(t('transcript.captionPopup.dialog.goFinishAction'), () => { this.step = 4; this.reached = 4; this.render(); });
            next.dataset['primary'] = 'true'; next.className = 'theia-button'; this.foot.append(next);
        } else if (this.applied) {
            this.foot.append(el('span', t('transcript.captionPopup.dialog.appliedScriptUndoText')), spacer);
            if (this.cutCandidateCount > 0) this.foot.append(button(t('transcript.captionPopup.dialog.ongoingRefineCutsAction'), () => {
                this.close(); void this.commands.executeCommand('akari.cuts.open');
            }));
            this.foot.append(button(t('transcript.captionPopup.dialog.viewScriptAction'), () => { void this.commands.executeCommand('akari.daihon.open'); this.close(); }));
        } else {
            this.foot.append(button(t('transcript.captionPopup.dialog.backAction'), () => { this.step = this.split ? 3 : 2; this.render(); }), spacer);
            const unlisted = this.selectedSources().filter(source => source.unlisted);
            const apply = button(unlisted.length ? t('transcript.captionPopup.dialog.placeTimelineReviewDifferencesAction') : t('transcript.captionPopup.dialog.applyScriptAction'),
                () => { if (unlisted.length) void this.prepareUnlisted(); else void this.apply(); },
                !this.finished || this.unsupportedTimeline || unlisted.some(source => this.unregisteredPlacements.has(source.path))
                    || !unlisted.length && !this.preview);
            apply.dataset.primary = 'true'; apply.className = 'theia-button'; this.foot.append(apply);
        }
    }

    protected async start(): Promise<void> {
        if (this.running || this.unsupportedTimeline || !this.selectedSource() || !this.enginesReady()
            || this.voiceGateBlocks()) return;
        await this.ready;
        this.running = true; this.finished = false; this.cancelled = false;
        this.completedSources.clear();
        this.step = 2; this.reached = 2; this.notice.textContent = '';
        this.render();
        const location = channelPeopleLocation(this.root.toString());
        const included = this.people.filter(person => person.hasVoiceSample && !this.excludedPeople.has(person.id));
        const options = { backend: this.backend, compareSet: this.compare ? [...this.compareSet] : [],
            approved: this.needsTranscription() && this.selectedClouds().length > 0, autoCuts: this.autoCuts,
            ...speakerTranscribeOptions({ split: this.split, count: this.speakerCount,
                identify: this.split && !!location && this.identify && this.tools.find(tool => tool.id === 'voice')?.canIdentify !== false,
                people: this.split && this.identify && this.tools.find(tool => tool.id === 'voice')?.canIdentify !== false
                    && this.people.some(person => person.hasVoiceSample && this.excludedPeople.has(person.id))
                    ? included.map(person => person.id) : undefined }) };
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
                    if (progress) progress.textContent = `${this.currentSource?.name ?? t('transcript.captionPopup.dialog.statusPreparing')} · ${this.progressText()}`;
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
                if (this.split) await this.loadSpeakerReview();
                await this.refreshPreview();
                this.cutCandidateCount = this.countCutCandidates(await this.transcribedCutRows());
                this.finished = true; this.step = 3; this.reached = 3;
                if (this.isDisposed) void this.messages.info(t('transcript.captionPopup.dialog.transcriptionCompleteNotYetAddedScriptNotice'), t('transcript.captionPopup.dialog.openFinishNotice'))
                    .then(action => { if (action) void this.reopenFinish().catch(error => {
                        void this.messages.error(String(error), { timeout: 0 });
                    }); });
            }
        } catch (error) {
            this.notice.textContent = error instanceof Error ? error.message : String(error);
            if (this.isDisposed && !this.cancelled) void this.messages.error(t('transcript.captionPopup.dialog.couldNotCreateCaptionsWithDetailError', { value1: this.notice.textContent }), { timeout: 0 });
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
        if (dialog.split) await dialog.loadSpeakerReview();
        dialog.finished = true; dialog.step = dialog.finishStep(); dialog.reached = dialog.finishStep();
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
                    event.status === 'completed' ? t('transcript.captionPopup.dialog.completeLabel') : event.status === 'failed' ? t('transcript.captionPopup.dialog.failedLabel') : t('transcript.captionPopup.dialog.transcribingLabel'));
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
                    throw new Error(t('transcript.captionPopup.dialog.couldNotAddAssetScriptListAssetRemainsTimelineError'));
                }
                this.selected.delete(source.id); this.selected.add(id);
                const artifacts = this.artifactsBySource.get(source.id);
                if (artifacts) { this.artifactsBySource.delete(source.id); this.artifactsBySource.set(id, artifacts); }
                source.id = id; source.unlisted = false; source.reason = undefined;
            }
            await this.refreshPreview();
            if (!this.preview) throw new Error(t('transcript.captionPopup.dialog.couldNotReviewDifferencesAssetRemainsTimelineError'));
            this.render();
        } catch (error) { this.notice.textContent = error instanceof Error ? error.message : String(error); this.render(); }
    }

    protected async apply(): Promise<void> {
        if (!this.finished || this.applied || !this.editUri || this.unsupportedTimeline) return;
        if (this.selectedSources().some(source => source.unlisted)) {
            this.notice.textContent = this.selectedSources().some(source => this.unregisteredPlacements.has(source.path))
                ? t('transcript.captionPopup.dialog.couldNotAddAssetScriptListAssetRemainsTimelineError')
                : t('transcript.captionPopup.dialog.reviewDifferencesAssetsNotTimelineFirstMessage');
            this.render(); return;
        }
        if (!this.preview) {
            this.notice.textContent = t('transcript.captionPopup.dialog.couldNotReviewDifferencesApplyingScriptStoppedError');
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
                    this.notice.textContent = t('transcript.captionPopup.dialog.selectOverwriteReplaceManuallyEditedLinesText');
                    this.render(); return;
                }
                const afterSource = (await this.files.readFile(captionsUri)).value.toString();
                this.recordCaptionsHistory(captionsUri, before, afterSource, t('transcript.captionPopup.dialog.applyScriptWithValueLabel', { value1: source.name }));
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
            this.recordCaptionsHistory(captionsUri, before, after, t('transcript.captionPopup.dialog.setCaptionFormatLabel'));
            const parsed = parseCaptions(after);
            this.cutCandidateCount = this.countCutCandidates(parsed.captions as DaihonCaptionLike[]);
            this.applied = true; this.render();
            if (this.isDisposed) void this.messages.info(t('transcript.captionPopup.dialog.captionsCreatedNotice'), t('transcript.captionPopup.dialog.openScriptNotice')).then(action => {
                if (action) void this.commands.executeCommand('akari.daihon.open');
            });
        } catch (error) {
            this.notice.textContent = error instanceof Error ? error.message : String(error); this.render();
            if (this.isDisposed) void this.messages.error(t('transcript.captionPopup.dialog.couldNotApplyScriptWithDetailError', { value1: this.notice.textContent }), { timeout: 0 });
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
        this.notice.textContent = t('transcript.captionPopup.dialog.transcriptionCanceledText');
    }
}
