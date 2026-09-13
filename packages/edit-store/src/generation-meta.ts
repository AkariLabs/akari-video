import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type GenerationState = 'none' | 'planned' | 'generating' | 'stale' | 'done' | 'failed' | 'orphan';

export interface GenerationMetaV1 {
    version: 1;
    kind: 'still' | 'video' | 'frames';
    status: 'planned' | 'generating' | 'done' | 'failed';
    inputs?: {
        first_frame?: { sha256?: string } | null;
        [key: string]: unknown;
    };
    job?: {
        started_at?: string;
        stale_after_s?: number;
        [key: string]: unknown;
    };
    result?: {
        sha256?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface GenerationBinding {
    expectedSha256: string;
    actualSha256: string | null;
    matches: boolean;
    source: 'result' | 'first_frame';
}

export interface ReadGenerationMetaResult {
    state: GenerationState;
    meta: GenerationMetaV1 | null;
    sidecarPath: string;
    binding: GenerationBinding | null;
}

export function sidecarPathFor(sourcePath: string): string {
    return `${sourcePath}.meta.json`;
}

/** fs に触れず、サイドカー自身が表す状態だけを解決する。 */
export function resolveGenerationState(meta: GenerationMetaV1 | null | undefined, now: Date | string | number): GenerationState {
    if (!meta) return 'none';
    if (meta.status === 'failed') return 'failed';
    if (meta.status === 'generating') {
        const nowMs = timeValue(now);
        const startedMs = Date.parse(String(meta.job?.started_at ?? ''));
        const staleAfterS = meta.job?.stale_after_s;
        if (
            Number.isFinite(nowMs)
            && Number.isFinite(startedMs)
            && typeof staleAfterS === 'number'
            && nowMs - startedMs > staleAfterS * 1000
        ) return 'stale';
    }
    return meta.status;
}

export function readGenerationMeta(options: {
    projectRoot: string;
    sourcePath: string;
    now: Date | string | number;
}): ReadGenerationMetaResult {
    const sourcePath = resolveInsideProject(options.projectRoot, options.sourcePath);
    const sidecarPath = sidecarPathFor(sourcePath);
    if (!fs.existsSync(sidecarPath)) {
        return { state: 'none', meta: null, sidecarPath, binding: null };
    }

    const meta = parseMeta(sidecarPath);
    const expected = bindingSha(meta);
    let binding: GenerationBinding | null = null;
    let state = resolveGenerationState(meta, options.now);
    if (expected) {
        const actualSha256 = fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()
            ? sha256File(sourcePath)
            : null;
        binding = {
            expectedSha256: expected.sha256,
            actualSha256,
            matches: actualSha256 === expected.sha256,
            source: expected.source,
        };
        if (!binding.matches) state = 'orphan';
    }
    return { state, meta, sidecarPath, binding };
}

export function findGenerationMetaBySha(options: {
    projectRoot: string;
    sha256: string;
}): GenerationMetaV1 | null {
    const generatedRoot = resolveInsideProject(options.projectRoot, 'assets/generated');
    if (!fs.existsSync(generatedRoot) || !fs.statSync(generatedRoot).isDirectory()) return null;
    for (const sidecarPath of generationSidecars(generatedRoot)) {
        const meta = parseMeta(sidecarPath);
        const expected = bindingSha(meta);
        if (expected?.sha256 === options.sha256) return meta;
    }
    return null;
}

function bindingSha(meta: GenerationMetaV1): { sha256: string; source: 'result' | 'first_frame' } | null {
    if (meta.status === 'done' && typeof meta.result?.sha256 === 'string') {
        return { sha256: meta.result.sha256, source: 'result' };
    }
    if ((meta.kind === 'still' || meta.status === 'planned') && typeof meta.inputs?.first_frame?.sha256 === 'string') {
        return { sha256: meta.inputs.first_frame.sha256, source: 'first_frame' };
    }
    return null;
}

function generationSidecars(directory: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) found.push(...generationSidecars(absolute));
        else if (entry.isFile() && entry.name.endsWith('.meta.json')) found.push(absolute);
    }
    return found.sort();
}

function resolveInsideProject(projectRoot: string, candidate: string): string {
    if (!candidate) throw new Error('sourcePath は空でないパスである必要があります。');
    const root = path.resolve(projectRoot);
    const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
    const relative = path.relative(root, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`projectRoot 外のパスは扱えません: ${candidate}`);
    }
    if (fs.existsSync(absolute)) {
        const realRoot = fs.realpathSync(root);
        const realPath = fs.realpathSync(absolute);
        const realRelative = path.relative(realRoot, realPath);
        if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
            throw new Error(`projectRoot 外を指すパスは扱えません: ${candidate}`);
        }
    }
    return absolute;
}

function parseMeta(sidecarPath: string): GenerationMetaV1 {
    let value: unknown;
    try {
        value = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`生成サイドカーを読めません: ${sidecarPath}: ${message}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`生成サイドカーのルートは object である必要があります: ${sidecarPath}`);
    }
    return value as GenerationMetaV1;
}

function sha256File(filePath: string): string {
    return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function timeValue(value: Date | string | number): number {
    return value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
}
