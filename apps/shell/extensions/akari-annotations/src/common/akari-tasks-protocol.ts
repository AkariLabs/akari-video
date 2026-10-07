export const AKARI_TASKS_SERVICE_PATH = '/services/akari-tasks';
export const AkariTasksService = Symbol('AkariTasksService');

export type TaskState = 'unsent' | 'sent' | 'review' | 'done';
export type TaskSource = 'annotation' | 'lint' | 'proposal' | 'export';
export interface Task {
    id: string;
    source: TaskSource | string;
    state: TaskState | string;
    createdAt: string;
    unknown?: boolean;
    [key: string]: unknown;
}
export interface ListTasksRequest { projectRootUri: string }
export interface ListTasksResponse { tasks: Task[]; warnings: string[]; file: 'ok' | 'absent' | 'broken' | 'newer' }
export interface CreateTaskRequest { projectRootUri: string; task: Partial<Task> & { body: string } }
export interface UpdateTaskRequest { projectRootUri: string; id: string; patch: Partial<Task>; actor: 'human' | 'app' | 'agent' }
export interface ImportSentRequest { projectRootUri: string; ids: string[] }

export interface AkariTasksService {
    list(request: ListTasksRequest): Promise<ListTasksResponse>;
    create(request: CreateTaskRequest): Promise<Task>;
    update(request: UpdateTaskRequest): Promise<Task>;
    importSent(request: ImportSentRequest): Promise<ListTasksResponse>;
}
