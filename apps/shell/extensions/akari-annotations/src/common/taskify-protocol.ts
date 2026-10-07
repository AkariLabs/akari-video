export const AKARI_TASKIFY_SERVICE_PATH = '/services/akari-taskify';
export const AkariTaskifyService = Symbol('AkariTaskifyService');
export interface TaskifyPreview { images: number; lines: number; textChars: number; backdrop: boolean;
    provider: string; agent: 'claude' | 'codex'; available: boolean; reason?: string }
export interface TaskifyEnqueue { projectRootUri: string; memoId: string; includeBackdrop: boolean; paperPng?: string; model?: string }
export interface TaskifyJobView { jobId: string; memoId: string; state: string; waiting?: string; error?: { code: string; raw?: string };
    resultCount?: number; revision: number; projectRootUri: string; agent: 'claude' | 'codex' }
export interface AkariTaskifyClient { onJobsChanged(jobs: TaskifyJobView[]): void }
export interface AkariTaskifyService { setClient(client: AkariTaskifyClient | undefined): void;
    preview(projectRootUri: string, memoId?: string): Promise<TaskifyPreview>;
    enqueue(request: TaskifyEnqueue): Promise<{ jobId: string }>;
    cancel(jobId: string): Promise<void>; retry(jobId: string): Promise<void>;
    rerun(projectRootUri: string, memoId: string, options?: { careful?: boolean }): Promise<{ jobId: string }>;
    list(projectRootUri: string): Promise<TaskifyJobView[]> }
