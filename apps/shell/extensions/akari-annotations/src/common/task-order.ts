import type { Task } from './akari-tasks-protocol';

const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 };

export function orderNextTasks(tasks: readonly Task[]): Task[] {
    return tasks.filter(task => !task.unknown && (task.state === 'unsent' || task.state === 'review'))
        .sort((a, b) => {
            const priority = (priorityOrder[String(a.priority ?? 'normal')] ?? 1)
                - (priorityOrder[String(b.priority ?? 'normal')] ?? 1);
            if (priority) return priority;
            if (a.state !== b.state) return a.state === 'review' ? -1 : 1;
            const ar = typeof a.rank === 'number' && Number.isFinite(a.rank) ? a.rank : Infinity;
            const br = typeof b.rank === 'number' && Number.isFinite(b.rank) ? b.rank : Infinity;
            return ar - br || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
        });
}

export function pickNextRows(tasks: readonly Task[], limit = 7): Task[] {
    return orderNextTasks(tasks).slice(0, Math.max(0, limit));
}

export function summarizeTasks(tasks: readonly Task[]): { unsent: number; sent: number; review: number; done: number } {
    const summary = { unsent: 0, sent: 0, review: 0, done: 0 };
    for (const task of tasks) {
        if (!task.unknown && task.state in summary) summary[task.state as keyof typeof summary]++;
    }
    return summary;
}
