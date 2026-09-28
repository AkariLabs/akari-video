export interface RawPreviewAudioSidecarRequest {
    sourceUri: string;
    projectRootUri: string;
    inSec: number;
    speed: number;
    padBeforeSec: number;
    padAfterSec: number;
    format: 'flac';
}

function filePath(uri: string): string | undefined {
    try {
        const parsed = new URL(uri);
        return parsed.protocol === 'file:' ? parsed.pathname.replace(/\/+$/u, '') || '/' : undefined;
    } catch {
        return undefined;
    }
}

function contains(root: string, candidate: string): boolean {
    return candidate === root || candidate.startsWith(root === '/' ? '/' : `${root}/`);
}

/** Nearest directory first, bounded by the deepest workspace root containing the source. */
export function rawPreviewProjectRootCandidates(sourceUri: string, workspaceRoots: readonly string[]): string[] {
    const sourcePath = filePath(sourceUri);
    if (!sourcePath) return [];
    const source = new URL(sourceUri);
    const root = workspaceRoots.filter(uri => {
        try { return new URL(uri).host === source.host; } catch { return false; }
    }).map(filePath).filter((value): value is string => !!value)
        .filter(value => contains(value, sourcePath))
        .sort((left, right) => right.length - left.length)[0];
    if (!root) return [];
    const candidates: string[] = [];
    let directory = sourcePath.slice(0, sourcePath.lastIndexOf('/')) || '/';
    while (contains(root, directory)) {
        const candidate = new URL(source);
        candidate.pathname = directory;
        candidate.search = '';
        candidate.hash = '';
        candidates.push(candidate.toString());
        if (directory === root) break;
        directory = directory.slice(0, directory.lastIndexOf('/')) || '/';
    }
    return candidates;
}

export function selectRawPreviewProjectRoot(candidates: readonly string[], rootsWithAkari: ReadonlySet<string>): string | undefined {
    return candidates.find(candidate => rootsWithAkari.has(candidate)) ?? candidates[candidates.length - 1];
}

export function planRawPreviewAudioSidecar(input: {
    kind: 'raw' | 'output';
    hasSourceAudio: boolean | undefined;
    sourceUri: string;
    projectRootUri: string | undefined;
}): RawPreviewAudioSidecarRequest | undefined {
    if (input.kind !== 'raw' || input.hasSourceAudio !== true || !input.projectRootUri
        || !filePath(input.sourceUri) || !filePath(input.projectRootUri)) return undefined;
    return {
        sourceUri: input.sourceUri,
        projectRootUri: input.projectRootUri,
        inSec: 0,
        speed: 1,
        padBeforeSec: 0,
        padAfterSec: 0,
        format: 'flac'
    };
}
