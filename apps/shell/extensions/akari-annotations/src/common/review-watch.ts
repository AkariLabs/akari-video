export type ReviewWatchReason = 'outside-roots' | 'skipped-directory' | 'ok';

export interface ReviewWatchDecision {
    open: boolean;
    reason: ReviewWatchReason;
}

export interface ReviewWatchOptions {
    skippedSegments?: string[];
}

export interface ReviewOpenTimers {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
}

const DEFAULT_SKIPPED_SEGMENTS = ['node_modules', 'vendor', 'cli', '.git', '.akari/history'];

const normalizePath = (value: string): string => {
    const normalized = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    return normalized.length > 1 ? normalized.replace(/\/+$/u, '') : normalized;
};

const relativeToRoot = (resourcePath: string, root: string): string | undefined => {
    if (root === '/') {
        return resourcePath.startsWith('/') ? resourcePath.slice(1) : undefined;
    }
    if (resourcePath === root) {
        return '';
    }
    const prefix = `${root}/`;
    return resourcePath.startsWith(prefix) ? resourcePath.slice(prefix.length) : undefined;
};

const containsSkippedSequence = (relativePath: string, skipped: readonly string[]): boolean => {
    const pathSegments = relativePath.split('/').filter(Boolean);
    return skipped.some(candidate => {
        const candidateSegments = normalizePath(candidate).split('/').filter(Boolean);
        if (candidateSegments.length === 0 || candidateSegments.length > pathSegments.length) {
            return false;
        }
        return pathSegments.some((_, index) => candidateSegments.every(
            (segment, offset) => pathSegments[index + offset] === segment
        ));
    });
};

export function shouldOpenReviewPanelFor(
    resourcePath: string,
    roots: string[],
    options: ReviewWatchOptions = {}
): ReviewWatchDecision {
    const normalizedResource = normalizePath(resourcePath);
    const relatives = roots
        .map(root => relativeToRoot(normalizedResource, normalizePath(root)))
        .filter((relative): relative is string => relative !== undefined);
    if (relatives.length === 0) {
        return { open: false, reason: 'outside-roots' };
    }
    const skipped = options.skippedSegments ?? DEFAULT_SKIPPED_SEGMENTS;
    if (relatives.every(relative => containsSkippedSequence(relative, skipped))) {
        return { open: false, reason: 'skipped-directory' };
    }
    return { open: true, reason: 'ok' };
}

export function coalesceReviewOpens(
    delayMs = 500,
    timers: ReviewOpenTimers = {
        setTimeout: (callback, delay) => setTimeout(callback, delay),
        clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
    }
): (openReviewPanel: () => void) => void {
    let pending: unknown;
    return openReviewPanel => {
        if (pending !== undefined) {
            timers.clearTimeout(pending);
        }
        pending = timers.setTimeout(() => {
            pending = undefined;
            openReviewPanel();
        }, delayMs);
    };
}
