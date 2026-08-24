export type LaneV2 = 'visual' | 'audio';

export interface OutputV2 {
    width: number;
    height: number;
    fps: number;
    look?: unknown;
    encoding?: unknown;
    [key: string]: unknown;
}

export interface EditSourceV2 {
    id: string;
    path: string;
    proxy?: string | null;
    chroma_key?: Record<string, unknown> | null;
}

export interface TransformV2 {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}

export interface CropV2 {
    x: number;
    y: number;
    w: number;
    h: number;
    [key: string]: unknown;
}

export interface KeyframeV2 {
    /** アイテム内のローカル時間（整数フレーム、item.at を 0 とする）。 */
    t: number;
    transform?: TransformV2;
    crop?: CropV2;
    perspective?: Record<string, unknown>;
    easing?: 'linear' | 'ease-in-out';
    [key: string]: unknown;
}

export type BlendModeV2 =
    | 'normal' | 'screen' | 'multiply' | 'add' | 'difference'
    | 'darken' | 'lighten' | 'overlay' | 'hardlight' | 'softlight';

export interface MediaSourceV2 {
    kind: 'media';
    src: string;
    in: number;
    out: number;
    framing?: Record<string, unknown>;
    transition_out?: Record<string, unknown> | null;
    freeze?: Record<string, unknown> | null;
    fx?: unknown[];
    speed?: number;
    chroma_key?: Record<string, unknown> | null;
}

export interface AudioMediaSourceV2 {
    kind: 'media';
    src: string;
    /** 素材ファイル内のトリム開始（秒）。省略時は 0。 */
    in?: number;
    /** 素材ファイル内のトリム終端（秒）。省略時はファイル末尾。 */
    out?: number;
}

export interface HtmlSourceV2 {
    kind: 'html';
    path: string;
    vars?: Record<string, unknown>;
    params?: Record<string, string>;
}

export interface TelopSourceV2 {
    kind: 'telop';
    preset: string;
    params?: Record<string, unknown>;
    baked?: string;
}

export type FilterV2 =
    | { type: 'invert' }
    | { type: 'lut'; id: string; intensity?: number }
    | { type: 'saturation'; value: number };

export interface FilterSourceV2 {
    kind: 'filter';
    filter: FilterV2;
}

export type SourceV2 = MediaSourceV2 | HtmlSourceV2 | TelopSourceV2 | FilterSourceV2;

export interface ItemV2Base {
    id: string;
    /** 出力タイムライン上の絶対位置（整数フレーム）。 */
    at: number;
    /** 表示・再生尺（整数フレーム）。 */
    duration: number;
    transform?: TransformV2;
    opacity?: number;
    blend?: BlendModeV2;
    crop?: CropV2;
    perspective?: Record<string, unknown>;
    keyframes?: KeyframeV2[];
}

export type ItemV2 =
    | (ItemV2Base & { source: MediaSourceV2 })
    | (ItemV2Base & { source: HtmlSourceV2 })
    | (ItemV2Base & { source: TelopSourceV2 })
    | (ItemV2Base & { source: FilterSourceV2 });

export type AudioRoleV2 = 'sfx' | 'narration' | 'bgm';

export interface NarrationProvenanceV2 {
    provider: string;
    engine?: string;
    voice?: string;
    credit?: string;
    generated_at?: string;
    [key: string]: unknown;
}

export interface AudioMediaItemV2 {
    id: string;
    /** 出力タイムライン上の絶対位置（整数フレーム）。 */
    at: number;
    /** 出力尺（整数フレーム）。0 は実尺未解決のセンチネル。 */
    duration: number;
    /** 省略時は sfx。 */
    role?: AudioRoleV2;
    source: AudioMediaSourceV2;
    gain_db?: number;
    fade_in?: number;
    fade_out?: number;
    ducking?: boolean;
    script?: string;
    reading?: string;
    provenance?: NarrationProvenanceV2;
}

export interface CaptionTrackContentV2 {
    from: 'captions.json';
}

export interface VisualItemsTrackV2 {
    id: string;
    lane: 'visual';
    name?: string;
    items: ItemV2[];
}

export interface AudioItemsTrackV2 {
    id: string;
    lane: 'audio';
    name?: string;
    items: AudioMediaItemV2[];
}

export type ItemsTrackV2 = VisualItemsTrackV2 | AudioItemsTrackV2;

export interface ContentTrackV2 {
    id: string;
    lane: LaneV2;
    name?: string;
    content: CaptionTrackContentV2;
}

export type TrackV2 = ItemsTrackV2 | ContentTrackV2;

export interface EditV2 {
    version: 2;
    output: OutputV2;
    sources: EditSourceV2[];
    /** 配列順が下から上の合成 z 順。 */
    tracks: TrackV2[];
    /**
     * 旧 v2 fixture が持つ top-level audio の互換 fallback。新規の SFX / narration / BGM は
     * audio lane の items で宣言する。
     */
    audio?: unknown;
    captions?: unknown[];
    thumbnail?: Record<string, unknown>;
}

export type InternalTrackV2 = TrackV2 & {
    /** 0 が最背面。tracks の配列添字と常に一致する。 */
    z: number;
};

export interface InternalEditV2 {
    version: 2;
    output: OutputV2;
    sources: EditSourceV2[];
    /** 入力順を保持した下→上のトラック列。 */
    tracks: InternalTrackV2[];
    audio?: unknown;
    captions?: unknown[];
    thumbnail?: Record<string, unknown>;
}

type UnknownRecord = Record<string, unknown>;

const BLEND_MODES = new Set<BlendModeV2>([
    'normal', 'screen', 'multiply', 'add', 'difference',
    'darken', 'lighten', 'overlay', 'hardlight', 'softlight'
]);
const ITEM_KEYS = new Set([
    'id', 'at', 'duration', 'transform', 'opacity', 'blend', 'crop', 'perspective', 'keyframes', 'source'
]);
const AUDIO_ITEM_KEYS = new Set([
    'id', 'at', 'duration', 'role', 'source', 'gain_db', 'fade_in', 'fade_out', 'ducking',
    'script', 'reading', 'provenance'
]);

/**
 * edit.json v2 だけを検証して内部表現へ読む。v0/v1 の変換は意図的に扱わない。
 * tracks の配列順を保持し、各 track に z（0 = 最背面）を付ける。
 */
export function readEditV2(json: unknown): InternalEditV2 {
    const parsed = parseInput(json);
    requireRecord(parsed, 'edit.json');
    requireExactKeys(parsed, new Set(['version', 'output', 'sources', 'tracks', 'audio', 'captions', 'thumbnail']), 'edit.json');
    if (parsed.version !== 2) {
        throw invalid('edit.json.version', '2 である必要があります（v0/v1 はこの reader の対象外です）');
    }

    validateOutput(parsed.output);
    if (!Array.isArray(parsed.sources)) {
        throw invalid('edit.json.sources', '配列である必要があります');
    }
    if (!Array.isArray(parsed.tracks)) {
        throw invalid('edit.json.tracks', '配列である必要があります');
    }
    if (hasOwn(parsed, 'audio')) requireRecord(parsed.audio, 'edit.json.audio');
    if (hasOwn(parsed, 'captions') && !Array.isArray(parsed.captions)) {
        throw invalid('edit.json.captions', '配列である必要があります');
    }
    if (hasOwn(parsed, 'thumbnail')) requireRecord(parsed.thumbnail, 'edit.json.thumbnail');

    const sourceIds = new Set<string>();
    parsed.sources.forEach((source, index) => validateEditSource(source, index, sourceIds));
    const trackIds = new Set<string>();
    const itemIds = new Set<string>();
    parsed.tracks.forEach((track, index) => validateTrack(track, index, trackIds, itemIds, sourceIds));

    const edit = parsed as unknown as EditV2;
    return {
        version: 2,
        output: { ...edit.output },
        sources: edit.sources.map(source => ({ ...source })),
        ...(edit.audio !== undefined ? { audio: edit.audio } : {}),
        ...(edit.captions !== undefined ? { captions: edit.captions } : {}),
        ...(edit.thumbnail !== undefined ? { thumbnail: { ...edit.thumbnail } } : {}),
        tracks: edit.tracks.map((track, z) => {
            if ('items' in track) {
                return {
                    ...track,
                    z,
                    items: track.items.map(item => ({ ...item, source: { ...item.source } }))
                } as InternalTrackV2;
            }
            return { ...track, z, content: { ...track.content } } as InternalTrackV2;
        })
    };
}

function parseInput(json: unknown): unknown {
    if (typeof json !== 'string') return json;
    try {
        return JSON.parse(json) as unknown;
    } catch (error) {
        throw invalid('edit.json', `JSON として読めません: ${messageOf(error)}`);
    }
}

function validateOutput(value: unknown): asserts value is OutputV2 {
    requireRecord(value, 'edit.json.output');
    requirePositiveNumber(value.width, 'edit.json.output.width');
    requirePositiveNumber(value.height, 'edit.json.output.height');
    requireInteger(value.fps, 1, 'edit.json.output.fps');
}

function validateEditSource(value: unknown, index: number, ids: Set<string>): asserts value is EditSourceV2 {
    const path = `edit.json.sources[${index}]`;
    requireRecord(value, path);
    requireExactKeys(value, new Set(['id', 'path', 'proxy', 'chroma_key']), path);
    requireText(value.id, `${path}.id`);
    if (ids.has(value.id)) throw invalid(`${path}.id`, `source id が重複しています: ${value.id}`);
    ids.add(value.id);
    requireText(value.path, `${path}.path`);
    if (hasOwn(value, 'proxy') && value.proxy !== null) requireText(value.proxy, `${path}.proxy`);
    if (hasOwn(value, 'chroma_key') && value.chroma_key !== null) {
        requireRecord(value.chroma_key, `${path}.chroma_key`);
    }
}

function validateTrack(
    value: unknown,
    index: number,
    trackIds: Set<string>,
    itemIds: Set<string>,
    sourceIds: Set<string>
): asserts value is TrackV2 {
    const path = `edit.json.tracks[${index}]`;
    requireRecord(value, path);
    requireExactKeys(value, new Set(['id', 'lane', 'name', 'items', 'content']), path);
    requireText(value.id, `${path}.id`);
    if (trackIds.has(value.id)) throw invalid(`${path}.id`, `track id が重複しています: ${value.id}`);
    trackIds.add(value.id);
    if (value.lane !== 'visual' && value.lane !== 'audio') {
        throw invalid(`${path}.lane`, 'visual または audio である必要があります');
    }
    if (hasOwn(value, 'name') && typeof value.name !== 'string') {
        throw invalid(`${path}.name`, '文字列である必要があります');
    }
    const hasItems = hasOwn(value, 'items');
    const hasContent = hasOwn(value, 'content');
    if (hasItems === hasContent) {
        throw invalid(path, 'items と content のどちらか一方だけが必要です');
    }
    if (hasItems) {
        if (!Array.isArray(value.items)) throw invalid(`${path}.items`, '配列である必要があります');
        value.items.forEach((item, itemIndex) => {
            const itemPath = `${path}.items[${itemIndex}]`;
            if (value.lane === 'audio') validateAudioItem(item, itemPath, itemIds, sourceIds);
            else validateItem(item, itemPath, itemIds, sourceIds);
        });
        return;
    }
    requireRecord(value.content, `${path}.content`);
    requireExactKeys(value.content, new Set(['from']), `${path}.content`);
    if (value.content.from !== 'captions.json') {
        throw invalid(`${path}.content.from`, 'captions.json である必要があります');
    }
}

function validateAudioItem(
    value: unknown,
    path: string,
    ids: Set<string>,
    sourceIds: Set<string>
): asserts value is AudioMediaItemV2 {
    requireRecord(value, path);
    requireExactKeys(value, AUDIO_ITEM_KEYS, path);
    requireText(value.id, `${path}.id`);
    if (ids.has(value.id)) throw invalid(`${path}.id`, `item id が重複しています: ${value.id}`);
    ids.add(value.id);
    requireInteger(value.at, 0, `${path}.at`);
    requireInteger(value.duration, 0, `${path}.duration`);
    if (hasOwn(value, 'role') && value.role !== 'sfx' && value.role !== 'narration' && value.role !== 'bgm') {
        throw invalid(`${path}.role`, 'sfx/narration/bgm のいずれかである必要があります');
    }
    if (hasOwn(value, 'gain_db')) requireRange(value.gain_db, -60, 12, `${path}.gain_db`);
    if (hasOwn(value, 'fade_in')) requireNonNegativeNumber(value.fade_in, `${path}.fade_in`);
    if (hasOwn(value, 'fade_out')) requireNonNegativeNumber(value.fade_out, `${path}.fade_out`);
    if (hasOwn(value, 'ducking') && typeof value.ducking !== 'boolean') {
        throw invalid(`${path}.ducking`, 'boolean である必要があります');
    }
    if (hasOwn(value, 'script') && typeof value.script !== 'string') {
        throw invalid(`${path}.script`, 'string である必要があります');
    }
    if (hasOwn(value, 'reading') && typeof value.reading !== 'string') {
        throw invalid(`${path}.reading`, 'string である必要があります');
    }
    if (hasOwn(value, 'provenance')) validateNarrationProvenance(value.provenance, `${path}.provenance`);
    validateAudioMediaSource(value.source, `${path}.source`, sourceIds);
}

function validateNarrationProvenance(value: unknown, path: string): asserts value is NarrationProvenanceV2 {
    requireRecord(value, path);
    requireText(value.provider, `${path}.provider`);
    for (const key of ['engine', 'voice', 'credit', 'generated_at']) {
        if (hasOwn(value, key) && typeof value[key] !== 'string') {
            throw invalid(`${path}.${key}`, 'string である必要があります');
        }
    }
    if (value.provider === 'voicevox' && (!hasOwn(value, 'credit')
        || typeof value.credit !== 'string' || value.credit.trim().length === 0)) {
        throw invalid(`${path}.credit`, 'provider が voicevox のときは空でない文字列が必要です');
    }
}

function validateAudioMediaSource(value: unknown, path: string, sourceIds: Set<string>): asserts value is AudioMediaSourceV2 {
    requireRecord(value, path);
    requireExactKeys(value, new Set(['kind', 'src', 'in', 'out']), path);
    if (value.kind !== 'media') throw invalid(`${path}.kind`, 'media である必要があります');
    requireText(value.src, `${path}.src`);
    if (!sourceIds.has(value.src)) throw invalid(`${path}.src`, `sources[].id に存在しません: ${value.src}`);
    if (hasOwn(value, 'in')) requireNonNegativeNumber(value.in, `${path}.in`);
    if (hasOwn(value, 'out')) {
        requireNonNegativeNumber(value.out, `${path}.out`);
        const inSeconds = hasOwn(value, 'in') ? value.in as number : 0;
        if (value.out <= inSeconds) throw invalid(path, 'audio media source は out > in である必要があります');
    }
}

function validateItem(
    value: unknown,
    path: string,
    ids: Set<string>,
    sourceIds: Set<string>
): asserts value is ItemV2 {
    requireRecord(value, path);
    requireExactKeys(value, ITEM_KEYS, path);
    requireText(value.id, `${path}.id`);
    if (ids.has(value.id)) throw invalid(`${path}.id`, `item id が重複しています: ${value.id}`);
    ids.add(value.id);
    requireInteger(value.at, 0, `${path}.at`);
    requireInteger(value.duration, 0, `${path}.duration`);
    if (hasOwn(value, 'transform')) validateTransform(value.transform, `${path}.transform`);
    if (hasOwn(value, 'opacity')) requireRange(value.opacity, 0, 1, `${path}.opacity`);
    if (hasOwn(value, 'blend') && !BLEND_MODES.has(value.blend as BlendModeV2)) {
        throw invalid(`${path}.blend`, '未対応の blend mode です');
    }
    if (hasOwn(value, 'crop')) validateCrop(value.crop, `${path}.crop`);
    if (hasOwn(value, 'perspective')) requireRecord(value.perspective, `${path}.perspective`);
    if (hasOwn(value, 'keyframes')) validateKeyframes(value.keyframes, `${path}.keyframes`);
    validateItemSource(value.source, `${path}.source`, sourceIds);
}

function validateItemSource(value: unknown, path: string, sourceIds: Set<string>): asserts value is SourceV2 {
    requireRecord(value, path);
    switch (value.kind) {
        case 'media':
            requireExactKeys(value, new Set([
                'kind', 'src', 'in', 'out', 'framing', 'transition_out', 'freeze', 'fx', 'speed', 'chroma_key'
            ]), path);
            requireText(value.src, `${path}.src`);
            if (!sourceIds.has(value.src)) throw invalid(`${path}.src`, `sources[].id に存在しません: ${value.src}`);
            requireNonNegativeNumber(value.in, `${path}.in`);
            requireNonNegativeNumber(value.out, `${path}.out`);
            if (value.out <= value.in) throw invalid(path, 'media source は out > in である必要があります');
            for (const key of ['framing', 'transition_out', 'freeze', 'chroma_key']) {
                if (hasOwn(value, key) && value[key] !== null) requireRecord(value[key], `${path}.${key}`);
            }
            if (hasOwn(value, 'fx') && !Array.isArray(value.fx)) throw invalid(`${path}.fx`, '配列である必要があります');
            if (hasOwn(value, 'speed')) requirePositiveNumber(value.speed, `${path}.speed`);
            return;
        case 'html':
            requireExactKeys(value, new Set(['kind', 'path', 'vars', 'params']), path);
            requireText(value.path, `${path}.path`);
            if (hasOwn(value, 'vars')) requireRecord(value.vars, `${path}.vars`);
            if (hasOwn(value, 'params')) {
                requireRecord(value.params, `${path}.params`);
                for (const [name, text] of Object.entries(value.params)) {
                    if (typeof text !== 'string') throw invalid(`${path}.params.${name}`, '文字列である必要があります');
                }
            }
            return;
        case 'telop':
            requireExactKeys(value, new Set(['kind', 'preset', 'params', 'baked']), path);
            requireText(value.preset, `${path}.preset`);
            if (hasOwn(value, 'params')) requireRecord(value.params, `${path}.params`);
            if (hasOwn(value, 'baked')) requireText(value.baked, `${path}.baked`);
            return;
        case 'filter':
            requireExactKeys(value, new Set(['kind', 'filter']), path);
            validateFilter(value.filter, `${path}.filter`);
            return;
        default:
            throw invalid(`${path}.kind`, 'media/html/telop/filter のいずれかである必要があります');
    }
}

function validateFilter(value: unknown, path: string): asserts value is FilterV2 {
    requireRecord(value, path);
    switch (value.type) {
        case 'invert':
            requireExactKeys(value, new Set(['type']), path);
            return;
        case 'lut':
            requireExactKeys(value, new Set(['type', 'id', 'intensity']), path);
            requireText(value.id, `${path}.id`);
            if (hasOwn(value, 'intensity')) requireRange(value.intensity, 0, 1, `${path}.intensity`);
            return;
        case 'saturation':
            requireExactKeys(value, new Set(['type', 'value']), path);
            requireRange(value.value, 0, 3, `${path}.value`);
            return;
        default:
            throw invalid(`${path}.type`, 'invert/lut/saturation のいずれかである必要があります');
    }
}

function validateTransform(value: unknown, path: string): asserts value is TransformV2 {
    requireRecord(value, path);
    requireExactKeys(value, new Set(['x', 'y', 'scale', 'rotate']), path);
    for (const key of ['x', 'y', 'rotate']) {
        if (hasOwn(value, key)) requireNumber(value[key], `${path}.${key}`);
    }
    if (hasOwn(value, 'scale')) requirePositiveNumber(value.scale, `${path}.scale`);
}

function validateCrop(value: unknown, path: string): asserts value is CropV2 {
    requireRecord(value, path);
    for (const key of ['x', 'y']) requireRange(value[key], 0, 1, `${path}.${key}`);
    for (const key of ['w', 'h']) {
        requireRange(value[key], 0, 1, `${path}.${key}`);
        if (value[key] === 0) throw invalid(`${path}.${key}`, '0 より大きい必要があります');
    }
}

function validateKeyframes(value: unknown, path: string): asserts value is KeyframeV2[] {
    if (!Array.isArray(value) || value.length < 2) throw invalid(path, '2 要素以上の配列である必要があります');
    value.forEach((entry, index) => {
        const itemPath = `${path}[${index}]`;
        requireRecord(entry, itemPath);
        requireInteger(entry.t, 0, `${itemPath}.t`);
        if (hasOwn(entry, 'transform')) validateTransform(entry.transform, `${itemPath}.transform`);
        if (hasOwn(entry, 'crop')) validateCrop(entry.crop, `${itemPath}.crop`);
        if (hasOwn(entry, 'perspective')) requireRecord(entry.perspective, `${itemPath}.perspective`);
        if (hasOwn(entry, 'easing') && entry.easing !== 'linear' && entry.easing !== 'ease-in-out') {
            throw invalid(`${itemPath}.easing`, 'linear または ease-in-out である必要があります');
        }
    });
}

function requireRecord(value: unknown, path: string): asserts value is UnknownRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw invalid(path, 'object である必要があります');
    }
}

function hasOwn(value: object, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

const UNKNOWN_KEY_GUIDANCE: Readonly<Record<string, string>> = {
    emphasis_words: '語レベル演出は captions.json のトップレベル emphasis_words[] へ移してください（契約 contract-2026-08-23-captions-emphasis-words-v0.md）',
};

const DEFAULT_UNKNOWN_KEY_GUIDANCE = 'このキーは v2 の語彙にありません。手で編集した場合は取り除くか、.akari/backup/ の原本から復元してください';

function requireExactKeys(value: UnknownRecord, allowed: Set<string>, path: string): void {
    const unknown = Object.keys(value).filter(key => !allowed.has(key));
    if (unknown.length > 0) {
        const guidance = unknown
            .map(key => `${key}: ${UNKNOWN_KEY_GUIDANCE[key] ?? DEFAULT_UNKNOWN_KEY_GUIDANCE}`)
            .join(' / ');
        throw invalid(path, `未定義キーを使用できません: ${unknown.join(', ')}。案内: ${guidance}`);
    }
}

function requireText(value: unknown, path: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) throw invalid(path, '空でない文字列である必要があります');
}

function requireNumber(value: unknown, path: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(path, '有限数である必要があります');
}

function requirePositiveNumber(value: unknown, path: string): asserts value is number {
    requireNumber(value, path);
    if (value <= 0) throw invalid(path, '0 より大きい必要があります');
}

function requireNonNegativeNumber(value: unknown, path: string): asserts value is number {
    requireNumber(value, path);
    if (value < 0) throw invalid(path, '0 以上である必要があります');
}

function requireInteger(value: unknown, minimum: number, path: string): asserts value is number {
    if (!Number.isInteger(value) || (value as number) < minimum) {
        throw invalid(path, `${minimum} 以上の整数である必要があります`);
    }
}

function requireRange(value: unknown, minimum: number, maximum: number, path: string): asserts value is number {
    requireNumber(value, path);
    if (value < minimum || value > maximum) throw invalid(path, `${minimum}..${maximum} の範囲である必要があります`);
}

function invalid(path: string, message: string): Error {
    return new Error(`edit.json v2 が不正です (${path}): ${message}`);
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
