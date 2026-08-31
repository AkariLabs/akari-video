export interface KeyedMove {
    key: string;
    beforeKey?: string;
}

export interface KeyedReconcilePlan {
    removals: string[];
    moves: KeyedMove[];
}

/**
 * Compute the minimum retained-node moves needed to turn currentKeys into desiredKeys.
 * New keys are reported as moves (insertions); removed keys are reported separately.
 */
export function planKeyedReconciliation(
    currentKeys: readonly string[], desiredKeys: readonly string[]
): KeyedReconcilePlan {
    assertUniqueKeys(currentKeys, 'current');
    assertUniqueKeys(desiredKeys, 'desired');
    const desiredSet = new Set(desiredKeys);
    const removals = currentKeys.filter(key => !desiredSet.has(key));
    const currentIndex = new Map(currentKeys.map((key, index) => [key, index]));
    const retainedDesired = desiredKeys.filter(key => currentIndex.has(key));
    const stableIndexes = longestIncreasingSubsequenceIndexes(
        retainedDesired.map(key => currentIndex.get(key)!)
    );
    const stableKeys = new Set([...stableIndexes].map(index => retainedDesired[index]));
    const moves: KeyedMove[] = [];
    for (let index = desiredKeys.length - 1; index >= 0; index--) {
        const key = desiredKeys[index];
        if (!currentIndex.has(key) || !stableKeys.has(key)) {
            moves.push({ key, ...(index + 1 < desiredKeys.length ? { beforeKey: desiredKeys[index + 1] } : {}) });
        }
    }
    return { removals, moves };
}

export function isRangeMounted(
    start: number, end: number, viewStart: number, visibleDuration: number
): boolean {
    const margin = visibleDuration * 0.5;
    return end > viewStart - margin && start < viewStart + visibleDuration + margin;
}

function assertUniqueKeys(keys: readonly string[], label: string): void {
    if (new Set(keys).size !== keys.length) {
        throw new Error(`${label} keyed children contain duplicate keys`);
    }
}

function longestIncreasingSubsequenceIndexes(values: readonly number[]): Set<number> {
    if (values.length === 0) return new Set();
    const tails: number[] = [];
    const predecessors = new Array<number>(values.length).fill(-1);
    for (let index = 0; index < values.length; index++) {
        let low = 0;
        let high = tails.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (values[tails[middle]] < values[index]) low = middle + 1;
            else high = middle;
        }
        if (low > 0) predecessors[index] = tails[low - 1];
        tails[low] = index;
    }
    const result = new Set<number>();
    let cursor = tails[tails.length - 1];
    while (cursor >= 0) {
        result.add(cursor);
        cursor = predecessors[cursor];
    }
    return result;
}
