import type { EarUtterance } from './ear-protocol';

export const JevUtteranceRouter = Symbol('JevUtteranceRouter');
export interface JevRouteResult {
    outcome: 'handled' | 'memo' | 'pass';
    label?: string;
    entryId?: string;
}
export interface JevUtteranceRouter {
    route(utterance: EarUtterance): Promise<JevRouteResult>;
}
