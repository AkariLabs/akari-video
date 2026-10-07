// The representative command is the first command with a shell paintedAt timestamp.
// Commands without a painted result remain in commands[] but do not set t9–t11.
// Later painted commands never replace the first representative.
const STAGES = ['t0Onset', 't1VoiceEnd', 't2FirstPartial', 't3SttFinal', 't4EarlyDecision',
    't5GrammarDone', 't6JudgeSent', 't7JudgeRecv', 't8PlanDone', 't9CommandSent',
    't10ResultRecv', 't11Painted'];

export function createJevTrace({ now = () => performance.timeOrigin + performance.now(), emit,
    setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (typeof emit !== 'function') return {
        mark() {}, attach() {}, commandSent() {}, commandResult() {}, flush() {}, reset() {},
    };
    const records = new Map();
    const finished = new Set();
    const recordFor = id => {
        if (id == null || finished.has(id)) return null;
        if (!records.has(id)) records.set(id, { marks: Object.fromEntries(STAGES.map(stage => [stage, null])),
            path: 'none', early: false, op: null, final: false, commands: [], timer: null });
        return records.get(id);
    };
    const span = (a, b) => Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
    const mark = (id, stage, extra) => {
        const row = recordFor(id);
        if (!row || !STAGES.includes(stage)) return;
        if (row.marks[stage] == null) row.marks[stage] = Number.isFinite(extra?.at) ? extra.at : now();
        if (extra) attach(id, extra);
    };
    const attach = (id, patch) => {
        const row = recordFor(id);
        if (!row || !patch) return;
        for (const key of ['path', 'early', 'op', 'final']) if (Object.hasOwn(patch, key)) row[key] = patch[key];
        if (patch.decision && !row.timer) row.timer = setTimer(() => flush(id, 'decision-timeout'), 3000);
    };
    const commandSent = (id, instruction, at = now()) => {
        const row = recordFor(id);
        if (!row || instruction?.kind !== 'command') return;
        row.commands.push({ instructionId: instruction.id, commandId: instruction.command?.commandId ?? null,
            t9: at, t10: null, shell: { recvAt: null, doneAt: null, paintedAt: null } });
    };
    const commandResult = (id, result, at = now()) => {
        const row = recordFor(id);
        const command = row?.commands.find(item => item.instructionId === result?.id);
        if (!command) return;
        command.t10 ??= at;
        const timing = result?.timing;
        if (!timing || !['recvAt', 'doneAt', 'paintedAt'].every(key => Number.isFinite(timing[key]))) return;
        command.shell = { recvAt: timing.recvAt, doneAt: timing.doneAt, paintedAt: timing.paintedAt };
        const skewMs = ((timing.recvAt - command.t9) + (timing.doneAt - command.t10)) / 2;
        command.skewMs = skewMs;
        command.rttMs = (command.t10 - command.t9) - (timing.doneAt - timing.recvAt);
        if (row.marks.t11Painted == null) {
            row.marks.t9CommandSent = command.t9;
            row.marks.t10ResultRecv = command.t10;
            row.marks.t11Painted = timing.paintedAt - skewMs;
            row.clock = { skewMs, rttMs: command.rttMs };
            flush(id, 'painted');
        }
    };
    const flush = (id, reason = 'manual') => {
        const row = records.get(id);
        if (!row || finished.has(id)) return;
        if (row.timer) clearTimer(row.timer);
        records.delete(id); finished.add(id);
        const m = row.marks;
        emit({ type: 'jev-trace', v: 0, operationId: id, path: row.path, early: row.early,
            op: row.op, final: row.final, marks: { ...m }, spans: {
                sttWaitMs: span(m.t1VoiceEnd, m.t3SttFinal),
                grammarMs: span(m.t3SttFinal ?? m.t4EarlyDecision, m.t5GrammarDone),
                judgeMs: span(m.t6JudgeSent, m.t7JudgeRecv),
                shellMs: span(m.t9CommandSent, m.t11Painted),
                endToEndMs: span(m.t1VoiceEnd, m.t11Painted),
            }, commands: row.commands.map(({ instructionId, skewMs, rttMs, ...command }) => command),
            clock: row.clock ?? { skewMs: null, rttMs: null } });
    };
    const reset = () => { for (const id of records.keys()) flush(id, 'reset'); finished.clear(); };
    return { mark, attach, commandSent, commandResult, flush, reset };
}
