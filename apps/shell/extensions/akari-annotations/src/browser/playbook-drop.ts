export interface PlaybookDropDependencies {
    projectUri: string; playbookDir: string; at: number; trackId?: string; name: string;
    service: {
        placePlaybook(request: { projectUri: string; playbookDir: string; at: number; trackId?: string; edit: unknown }): Promise<{ edit: unknown; rollback?: unknown }>;
        undoPlacePlaybook(request: { projectUri: string; rollback?: unknown }): Promise<void>;
    };
    commit(mutate: (doc: any) => Promise<any>, options: { history: false }): Promise<{ before: string; after: string }>;
    record(entry: { label: string; undo(): Promise<void>; redo(): Promise<void> }): void;
    restore(source: string): Promise<unknown>;
    reload(): Promise<unknown>;
}

/** One timeline history entry owns both the edit snapshot and imported files. */
export async function executePlaybookDrop(deps: PlaybookDropDependencies): Promise<void> {
    const request = { projectUri: deps.projectUri, playbookDir: deps.playbookDir, at: deps.at, trackId: deps.trackId };
    let rollback: unknown;
    let snapshots: { before: string; after: string };
    try {
        snapshots = await deps.commit(async doc => {
            const placed = await deps.service.placePlaybook({ ...request, edit: doc });
            rollback = placed.rollback;
            return placed.edit;
        }, { history: false });
    } catch (error) {
        if (rollback) await deps.service.undoPlacePlaybook({ projectUri: deps.projectUri, rollback });
        throw error;
    }
    const { before, after } = snapshots;
    deps.record({ label: deps.name,
        undo: async () => { await deps.restore(before); await deps.service.undoPlacePlaybook({ projectUri: deps.projectUri, rollback }); await deps.reload(); },
        redo: async () => { const placed = await deps.service.placePlaybook({ ...request, edit: JSON.parse(before) });
            rollback = placed.rollback; await deps.restore(after); await deps.reload(); } });
}
