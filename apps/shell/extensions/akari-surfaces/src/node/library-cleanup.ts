import { isAbsolute, relative, sep } from 'path';

export interface LabCleanupCandidate {
    sourceKind: string;
    libraryDir: string;
    actualDir: string;
}

/** Canonical paths are supplied by the caller after realpath/stat checks. */
export function selectLabCleanupTargets(
    candidates: readonly LabCleanupCandidate[],
    roots: readonly string[],
    confirmedDirs: readonly string[]
): string[] {
    const selected = new Set<string>();
    const confirmed = new Set(confirmedDirs);
    for (const candidate of candidates) {
        if (candidate.sourceKind !== 'lab' || !confirmed.has(candidate.libraryDir)) continue;
        if (!roots.some(root => {
            const inside = relative(root, candidate.actualDir);
            return inside !== '' && inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside);
        })) continue;
        selected.add(candidate.actualDir);
    }
    return [...selected];
}
