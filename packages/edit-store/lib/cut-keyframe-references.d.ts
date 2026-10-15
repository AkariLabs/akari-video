type JsonEdit = {
    tracks?: unknown;
};
export declare function cutMotionReferencePaths(edit: JsonEdit): string[];
/** Hydrate valid bags for a synchronous cut. Unreadable unrelated references stay untouched. */
export declare function hydrateCutMotionReferences<T extends JsonEdit>(edit: T, bags: ReadonlyMap<string, unknown>): T;
/** A ripple may move an item without cutting it. Keep that item's original reference spelling. */
export declare function restoreUncutMotionReferences<T extends JsonEdit>(before: T, after: T, bags: ReadonlyMap<string, unknown>): T;
export {};
