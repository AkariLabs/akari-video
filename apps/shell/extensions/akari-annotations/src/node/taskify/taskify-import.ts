import { TASKIFY_IMPORT_TOKEN, type AkariTasksServiceImpl } from '../akari-tasks-service';
import URI from '@theia/core/lib/common/uri';
import { join } from 'node:path';
import { readTasksFile } from '@akari-video/edit-store/lib/tasks-store';
import type { ValidatedResult } from './taskify-schema';

export async function importTaskifyResult(service: AkariTasksServiceImpl, request: {
    projectRootUri: string; memoId: string; jobId: string; paperPath: string; result: ValidatedResult
}): Promise<number> {
    const read = await readTasksFile(join(new URI(request.projectRootUri).path.fsPath(), '.akari', 'tasks.json'));
    if (!read.ok) throw new Error('tasks.json を読めません。');
    const existing = read.doc.tasks;
    let count = 0;
    for (const item of request.result.tasks) {
        if (existing.some(task => {
            const origin = task.origin as { memo?: string; job?: string; ref?: string } | undefined;
            return origin?.memo === request.memoId && origin?.job === request.jobId && origin?.ref === item.ref;
        })) continue;
        const created = await service.createProposal({ projectRootUri: request.projectRootUri, task: {
            source: 'proposal', state: 'unsent', needsConfirm: true, createdBy: 'ai', via: 'paper',
            kind: item.kind, title: item.title, body: item.body,
            target: '画面', targetDetail: item.target,
            evidence: item.evidence, confidence: item.confidence, question: item.question,
            risk: item.risk, route: item.route, priority: item.priority, dependsOn: item.dependsOn,
            origin: { kind: 'rough-canvas', memo: request.memoId, job: request.jobId, ref: item.ref },
            attachments: [{ kind: 'paper', path: request.paperPath }],
            ...(item.risk === 'outbound' ? { gate: 'ask', undo: { reversible: false } } : {})
        } }, TASKIFY_IMPORT_TOKEN);
        existing.push(created);
        count++;
    }
    return count;
}
