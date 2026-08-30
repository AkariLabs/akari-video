import { promises as fs } from 'fs';
import { join } from 'path';
import { parseCaptions, type CaptionRecord, type CaptionTextStyle } from './caption-store';
import { serializeCaptions, serializeEdit, serializeMotion } from './canonical';
import type {
    KeyframeV2,
    MotionV0 as ItemMotionV0,
} from './edit-v2';
import {
    attachEditHelpers,
    clone,
    ensureChildren,
    normalizeTracks,
    type EditableEditV2,
    type JsonRecord,
    type MutableItem,
} from './tree-ops';
import {
    lintProjectCandidatesOnDisk,
    writeProjectFilesGuarded,
    type EditLintFinding,
    type LintCandidates,
} from './write-gate';

export type {
    AnimatorV0,
    AudioMediaItemV2,
    CaptionSourceV2,
    CaptionsSourceV2,
    EditV2,
    GroupSourceV2,
    ItemV2,
    ItemV2Base,
    KeyframeV2,
    KeyframesReferenceV2,
    MotionV0,
    SourceV2,
    TrackV2,
    TransformV2,
} from './edit-v2';

const EDIT_FILE_VERSION = 2;
const MOTION_FILE_VERSION = 0;

export interface MotionFileV0 {
    version: 0;
    group: string;
    items: Record<string, KeyframeV2[]>;
    [key: string]: unknown;
}

export type {
    EditableEditV2,
    GroupResult,
    MoveTarget,
    ProjectItemV2,
    ProjectTrackV2,
} from './tree-ops';
export { composeTransforms } from './tree-ops';

export interface ProjectCaptions {
    rows: CaptionRecord[];
    defaultTextStyle?: CaptionTextStyle;
}

export interface ProjectSaveResult {
    written: string[];
    findings: EditLintFinding[];
}

export interface ProjectSaveOptions {
    /** false は呼び出し元が明示した lint bypass。正規化と atomic 保存は常に行う。 */
    lint?: boolean;
}

export interface Project {
    edit: EditableEditV2;
    captions: ProjectCaptions;
    motion(groupId: string): Promise<MotionFileV0>;
    save(options?: ProjectSaveOptions): Promise<ProjectSaveResult>;
}

export interface OpenProjectOptions {
    editFile?: string;
}

interface MotionState {
    path: string;
    doc: MotionFileV0;
    originalText?: string;
    originalState: string;
}

export async function openProject(dir: string, opts: OpenProjectOptions = {}): Promise<Project> {
    const editName = opts.editFile ?? 'edit.json';
    const editPath = join(dir, editName);
    let editText = await fs.readFile(editPath, 'utf8');
    const parsedEdit = JSON.parse(editText) as unknown;
    if (!isRecord(parsedEdit) || parsedEdit.version !== EDIT_FILE_VERSION || !Array.isArray(parsedEdit.tracks)) {
        throw new Error('openProject は version: 2 の edit.json を必要とします。');
    }
    const edit = parsedEdit as unknown as EditableEditV2;
    attachEditHelpers(edit);

    const captionsPath = join(dir, 'captions.json');
    let captionsText = await readOptional(captionsPath);
    const captionsRoot = captionsText === undefined ? undefined : JSON.parse(captionsText) as unknown;
    const parsedCaptions = captionsText === undefined
        ? { captions: [] as CaptionRecord[], warnings: [] as string[] }
        : parseCaptions(captionsText);
    const captions: ProjectCaptions = {
        rows: parsedCaptions.captions,
        ...(parsedCaptions.defaultTextStyle !== undefined
            ? { defaultTextStyle: parsedCaptions.defaultTextStyle } : {})
    };
    const motionStates = new Map<string, MotionState>();

    const loadMotionPath = async (relativePath: string, groupId: string): Promise<MotionState> => {
        const safePath = requireMotionPath(relativePath);
        const existing = motionStates.get(safePath);
        if (existing) return existing;
        const text = await readOptional(join(dir, ...safePath.split('/')));
        const doc = text === undefined
            ? { version: 0 as const, group: groupId, items: {} }
            : JSON.parse(text) as MotionFileV0;
        if (!isRecord(doc) || doc.version !== MOTION_FILE_VERSION || !isRecord(doc.items)) {
            throw new Error(`motion 袋の形式を確認できません: ${safePath}`);
        }
        const state = {
            path: safePath,
            doc,
            originalText: text,
            originalState: stableJson(doc),
        };
        motionStates.set(safePath, state);
        return state;
    };

    const project: Project = {
        edit,
        captions,
        async motion(groupId: string): Promise<MotionFileV0> {
            requireGroupId(groupId);
            return (await loadMotionPath(`motion/${groupId}.json`, groupId)).doc;
        },
        async save(options: ProjectSaveOptions = {}): Promise<ProjectSaveResult> {
            normalizeTracks(edit);
            await distributeKeyframes(edit, loadMotionPath);

            const candidates: LintCandidates = {};
            const serializedEdit = serializeEdit(edit);
            if (serializedEdit !== editText) candidates[editName] = serializedEdit;

            if (captionsText !== undefined || captions.rows.length > 0) {
                const serializedCaptions = serializeCaptions(buildCaptionsDocument(captionsRoot, captions));
                if (serializedCaptions !== (captionsText ?? '')) candidates['captions.json'] = serializedCaptions;
            }
            for (const state of motionStates.values()) {
                const changed = stableJson(state.doc) !== state.originalState;
                if (state.originalText === undefined && !changed) continue;
                const serialized = serializeMotion(state.doc);
                if (serialized !== (state.originalText ?? '')) candidates[state.path] = serialized;
            }

            const written = Object.keys(candidates);
            if (written.length === 0) return { written: [], findings: [] };

            let findings: EditLintFinding[] = [];
            if (options.lint !== false) {
                const lint = await lintProjectCandidatesOnDisk(dir, candidates);
                if (!lint.pass) {
                    const error = new Error(lint.errors[0] ?? 'edit-lint が変更を拒否しました') as Error & {
                        findings?: EditLintFinding[];
                    };
                    error.findings = lint.findings;
                    throw error;
                }
                findings = lint.findings;
            }
            await writeProjectFilesGuarded(dir, candidates);
            for (const key of written) {
                if (key === editName) editText = candidates[key] as string;
                else if (key === 'captions.json') captionsText = candidates[key] as string;
            }
            for (const state of motionStates.values()) {
                if (state.path in candidates) state.originalText = candidates[state.path] as string;
                state.originalState = stableJson(state.doc);
            }
            return { written, findings };
        }
    };
    return project;
}

async function distributeKeyframes(
    edit: EditableEditV2,
    loadMotion: (path: string, groupId: string) => Promise<MotionState>
): Promise<void> {
    const visit = async (item: MutableItem, ancestors: MutableItem[]): Promise<void> => {
        if (Array.isArray(item.keyframes) && item.keyframes.length >= 9) {
            const groupId = ancestors.length > 0 ? ancestors[ancestors.length - 1].id : item.id;
            const path = `motion/${groupId}.json`;
            const state = await loadMotion(path, groupId);
            state.doc.group = groupId;
            state.doc.items[item.id] = clone(item.keyframes);
            item.keyframes = { path, count: item.keyframes.length };
        } else if (isRecord(item.keyframes)) {
            const path = requireMotionPath(String(item.keyframes.path));
            const groupId = path.slice('motion/'.length, -'.json'.length);
            const state = await loadMotion(path, groupId);
            const points = state.doc.items[item.id];
            if (Array.isArray(points)) item.keyframes.count = points.length;
        }
        for (const child of ensureChildren(item, false)) await visit(child, [...ancestors, item]);
    };
    for (const track of edit.tracks) {
        if (!Array.isArray(track.items)) continue;
        for (const item of track.items as MutableItem[]) await visit(item, []);
    }
}

function buildCaptionsDocument(root: unknown, captions: ProjectCaptions): unknown {
    const originalRows = Array.isArray(root)
        ? root
        : isRecord(root) && Array.isArray(root.captions) ? root.captions : [];
    const byId = new Map(captions.rows.map(row => [row.id, row]));
    const used = new Set<string>();
    const rows = originalRows.map(raw => {
        if (!isRecord(raw) || typeof raw.id !== 'string') return clone(raw);
        const row = byId.get(raw.id);
        if (!row) return clone(raw);
        used.add(row.id);
        return captionRecordToJson(row, raw);
    });
    for (const row of captions.rows) if (!used.has(row.id)) rows.push(captionRecordToJson(row));
    if (Array.isArray(root) || root === undefined) return rows;
    const result: JsonRecord = { ...(root as JsonRecord), captions: rows };
    if (captions.defaultTextStyle === undefined) delete result.default_text_style;
    else result.default_text_style = textStyleToJson(captions.defaultTextStyle);
    return result;
}

function captionRecordToJson(row: CaptionRecord, original: JsonRecord = {}): JsonRecord {
    const result: JsonRecord = {
        ...original,
        id: row.id,
        start: row.start,
        end: row.end,
        text: row.text,
        speaker: row.speaker,
        sourceRef: clone(row.sourceRef),
        edited: row.edited,
    };
    if (row.timeDomain === undefined) delete result.time_domain;
    else result.time_domain = row.timeDomain;
    if (row.textStyle === undefined) delete result.text_style;
    else result.text_style = textStyleToJson(row.textStyle);
    return result;
}

function textStyleToJson(style: CaptionTextStyle): JsonRecord {
    const rename = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(rename);
        if (!isRecord(value)) return value;
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [camelToSnake(key), rename(entry)]));
    };
    return rename(style) as JsonRecord;
}

const CAPTION_STYLE_NAMES: Record<string, string> = {
    sizePx: 'size_px', fontFamily: 'font_family', fontWeight: 'font_weight', letterSpacingEm: 'letter_spacing_em',
    lineHeight: 'line_height', verticalAlign: 'vertical_align', textTransform: 'text_transform',
    maxWidthPct: 'max_width_pct', textAnchor: 'text_anchor', widthPx: 'width_px', blurPx: 'blur_px',
    distancePx: 'distance_px', angleDeg: 'angle_deg', offsetX: 'offset_x', offsetY: 'offset_y',
    durationSec: 'duration_sec', radiusPx: 'radius_px', paddingPx: 'padding_px', widthPct: 'width_pct',
    heightPct: 'height_pct', referenceWidthPx: 'reference_width_px', referenceHeightPx: 'reference_height_px',
    leftPx: 'left_px', bottomPx: 'bottom_px', textAlign: 'text_align', maxLines: 'max_lines'
};

function camelToSnake(key: string): string {
    return CAPTION_STYLE_NAMES[key] ?? key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function snapshotCaptions(captions: ProjectCaptions): string {
    return stableJson({ rows: captions.rows, defaultTextStyle: captions.defaultTextStyle });
}

function stableJson(value: unknown): string {
    return JSON.stringify(value);
}

function requireMotionPath(value: string): string {
    if (!/^motion\/[^/\\]+\.json$/u.test(value)) throw new Error(`motion 袋のパスが不正です: ${value}`);
    return value;
}

function requireGroupId(value: string): void {
    if (value.length === 0 || value.includes('/') || value.includes('\\')) throw new Error(`group id が不正です: ${value}`);
}

async function readOptional(path: string): Promise<string | undefined> {
    try {
        return await fs.readFile(path, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
    }
}

function isRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
