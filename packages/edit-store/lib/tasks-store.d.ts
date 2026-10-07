export interface TaskRecord {
    id: string;
    source: string;
    state: string;
    createdAt: string;
    [key: string]: unknown;
}
export interface TasksDocument {
    version: number;
    tasks: TaskRecord[];
    [key: string]: unknown;
}
export type TasksReadResult = {
    ok: true;
    exists: boolean;
    doc: TasksDocument;
    version: number;
    tasks: TaskRecord[];
    warnings: string[];
} | {
    ok: false;
    reason: 'broken' | 'newer';
    version?: number;
    warnings: string[];
};
export declare function readTasksFile(filePath: string): Promise<TasksReadResult>;
export declare function writeTasksFile(filePath: string, doc: TasksDocument): Promise<void>;
export declare function withTasksLock<T>(filePath: string, operation: () => Promise<T>): Promise<T>;
export declare function nextTaskId(tasks: readonly Partial<TaskRecord>[]): string;
export declare function applyTaskPatch(task: TaskRecord, patch: Record<string, unknown>, actor: 'human' | 'app' | 'agent'): TaskRecord;
export declare function deriveTasks(reviewJsonText: string | null | undefined, overlayDoc: TasksDocument): {
    tasks: TaskRecord[];
    warnings: string[];
};
export declare function toOverlayEntry(derivedTask: TaskRecord, existingTasks?: readonly TaskRecord[]): TaskRecord;
export declare function importSentAnnotationIds(overlay: TasksDocument, ids: readonly string[]): TasksDocument;
