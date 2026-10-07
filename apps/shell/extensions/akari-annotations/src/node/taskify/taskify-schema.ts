export const TASKIFY_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['summary', 'tasks'],
    properties: {
        summary: { type: 'string', minLength: 1 },
        tasks: { type: 'array', maxItems: 5, items: {
            type: 'object', additionalProperties: false,
            required: ['ref', 'title', 'body', 'kind', 'target', 'evidence', 'confidence', 'needsConfirm', 'question', 'risk', 'route', 'priority', 'dependsOn'],
            properties: {
                ref: { type: 'string', pattern: '^t[1-5]$' }, title: { type: 'string', minLength: 1, maxLength: 40 },
                body: { type: 'string', minLength: 1 }, kind: { enum: ['edit', 'generate', 'fix', 'ask', 'note'] },
                target: { type: 'object', required: ['outputT', 'src', 'sourceT', 'cutIndex', 'refs', 'region'], properties: {
                    outputT: { type: 'number', minimum: 0 }, src: { type: 'string' }, sourceT: { type: 'number', minimum: 0 },
                    cutIndex: { type: 'integer', minimum: 0 }, refs: { type: 'array', items: { type: 'string' } },
                    region: { anyOf: [{ type: 'null' }, { type: 'object', required: ['box'], properties: {
                        box: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4 }
                    } }] }
                } },
                evidence: { type: 'object', required: ['memo', 'speech', 'quote', 'ink'], properties: {
                    memo: { type: 'string' }, speech: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                    quote: { type: 'string' }, ink: { type: 'array', items: { type: 'string' } }
                } },
                confidence: { enum: ['high', 'low'] }, needsConfirm: { type: 'boolean' },
                question: { type: ['string', 'null'] }, risk: { enum: ['reversible', 'outbound'] },
                route: { enum: ['agent', 'human'] }, priority: { type: 'integer', minimum: 0 },
                dependsOn: { type: 'array', items: { type: 'string' } }
            }
        } }
    }
} as const;

export interface ValidatedTask { [key: string]: any; ref: string; title: string; body: string; kind: string;
    target: { refs: string[]; region: { box: number[] } | null; [key: string]: any }; evidence: { [key: string]: any };
    confidence: 'high' | 'low'; needsConfirm: boolean; question: string | null; risk: 'reversible' | 'outbound';
    route: 'agent' | 'human'; priority: number; dependsOn: string[] }
export interface ValidatedResult { summary: string; tasks: ValidatedTask[]; validated: {
    refsDropped: number; warnings: string[]; outboundHeld: number } }
import { enumerateEditContext } from './taskify-edit-context';
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const words = (value: unknown, choices: string[]): boolean => typeof value === 'string' && choices.includes(value);
const commandWarnings = (task: ValidatedTask): string[] => {
    const value = `${task.title}\n${task.body}`;
    return [
        /https?:\/\/|www\./i.test(value) ? 'URL が含まれます' : '',
        /(?:^|\s)(?:rm\s+-[A-Za-z]*|sudo|curl|wget|bash|sh|git\s+push|npm\s+run)(?:\s|$)/im.test(value) ? '実行コマンドらしい記述があります' : '',
        /(?:^|\s)(?:~\/|\/Users\/|\/home\/|[A-Za-z]:\\)/m.test(value) ? 'プロジェクト外のパスらしい記述があります' : ''
    ].filter(Boolean);
};
function normalizeRegion(value: unknown): { region: { box: number[] } | null; warning?: string } {
    if (value === null) return { region: null };
    if (!object(value) || !Array.isArray(value.box) || value.box.length !== 4
        || value.box.some((part: unknown) => typeof part !== 'number' || !Number.isFinite(part))) {
        return { region: null, warning: 'region を破棄' };
    }
    const box = (value.box as number[]).map(part => Math.max(0, Math.min(1, part)));
    let corrected = box.some((part, i) => part !== value.box[i]);
    if ((box[0] + box[2] > 1 || box[1] + box[3] > 1) && box[2] > box[0] && box[3] > box[1]) {
        box[2] -= box[0]; box[3] -= box[1]; corrected = true;
    }
    if (box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > 1 + 1e-9 || box[1] + box[3] > 1 + 1e-9) {
        return { region: null, warning: 'region を破棄' };
    }
    return { region: { box }, ...(corrected ? { warning: 'region を補正' } : {}) };
}
export function validateResult(raw: unknown, ctx: { edit?: unknown } = {}): ValidatedResult {
    if (!object(raw) || typeof raw.summary !== 'string' || !raw.summary.trim() || !Array.isArray(raw.tasks) || raw.tasks.length > 5)
        throw new Error('結果の形または件数が不正です。');
    const known = new Set(enumerateEditContext(ctx.edit).map(entry => entry.ref));
    const refs = new Set(raw.tasks.map(task => object(task) ? task.ref : undefined));
    const result: ValidatedResult = { summary: raw.summary, tasks: [], validated: { refsDropped: 0, warnings: [], outboundHeld: 0 } };
    for (const [i, value] of raw.tasks.entries()) {
        if (!object(value) || !/^t[1-5]$/.test(value.ref) || typeof value.title !== 'string'
            || !value.title.trim() || [...value.title].length > 40 || typeof value.body !== 'string' || !value.body.trim()
            || !words(value.kind, ['edit', 'generate', 'fix', 'ask', 'note'])
            || !words(value.confidence, ['high', 'low']) || !words(value.risk, ['reversible', 'outbound'])
            || !words(value.route, ['agent', 'human']) || typeof value.needsConfirm !== 'boolean'
            || !(value.question === null || typeof value.question === 'string')
            || !Number.isInteger(value.priority) || value.priority < 0 || !Array.isArray(value.dependsOn)
            || value.dependsOn.some((ref: unknown) => !refs.has(ref)) || !object(value.target)
            || !Array.isArray(value.target.refs) || value.target.refs.some((ref: unknown) => typeof ref !== 'string')
            || !Number.isInteger(value.target.cutIndex) || value.target.cutIndex < 0
            || !Number.isFinite(value.target.outputT) || !Number.isFinite(value.target.sourceT)
            || typeof value.target.src !== 'string' || !object(value.evidence)
            || typeof value.evidence.memo !== 'string' || typeof value.evidence.quote !== 'string'
            || !Array.isArray(value.evidence.speech) || value.evidence.speech.length !== 2
            || !Array.isArray(value.evidence.ink)) throw new Error(`tasks[${i}] の形が不正です。`);
        const task = JSON.parse(JSON.stringify(value)) as ValidatedTask;
        const kept = task.target.refs.filter(ref => known.has(ref));
        const dropped = task.target.refs.length - kept.length;
        if (dropped) {
            task.target.refs = kept; task.needsConfirm = true; task.confidence = 'low';
            task.question ||= '対象の位置を確認してください。'; result.validated.refsDropped += dropped;
        }
        const proposedRegion = task.target.region;
        const normalizedRegion = normalizeRegion(proposedRegion);
        task.target.region = normalizedRegion.region;
        if (normalizedRegion.warning) result.validated.warnings.push(`tasks[${i}]: ${normalizedRegion.warning}`);
        // A visual region is only a suggestion; the human must approve it.
        if (proposedRegion !== null) { task.needsConfirm = true; task.confidence = 'low'; task.question ||= '画面内の位置を確認してください。'; }
        if (task.risk === 'outbound') result.validated.outboundHeld++;
        result.validated.warnings.push(...commandWarnings(task).map(w => `tasks[${i}]: ${w}`));
        result.tasks.push(task);
    }
    return result;
}
