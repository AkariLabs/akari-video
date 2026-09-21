// STT の途中経過・無音確定・認識確定を 1 発話 ID / revision 単位で直列化する。
// 時計と dispatch を注入できるため、実モデルなしで競合を再生できる。
export function createSttScheduler({
    dispatch,
    stateKey = () => '',
    normalize = (text) => String(text ?? '').trim(),
    onSkip = () => {},
    partialPredicate = () => true,
    completeGate = () => undefined,
    partialDelayMs = 600,
    initialPartialDelayMs = 250,
    clock = { now: () => Date.now(), setTimeout, clearTimeout },
} = {}) {
    if (typeof dispatch !== 'function') throw new TypeError('dispatch is required');
    if (typeof partialPredicate !== 'function') throw new TypeError('partialPredicate must be a function');
    if (typeof completeGate !== 'function') throw new TypeError('completeGate must be a function');
    const operations = new Map();
    const queue = [];
    let inFlight = null;
    let draining = false;
    let idleWaiters = [];

    const opState = (id) => {
        if (!operations.has(id)) operations.set(id, {
            revision: 0, text: null, partialSent: false, lastPartialAt: -Infinity,
            timer: null, pending: null, evaluatedLite: new Set(), lastLite: null,
        });
        return operations.get(id);
    };
    const stamp = (item) => {
        const state = opState(item.operationId);
        const text = normalize(item.text);
        if (state.text !== text) { state.text = text; state.revision += 1; }
        return { ...item, text, revision: state.revision, stateKey: stateKey() };
    };
    const same = (a, b) => a && b && a.operationId === b.operationId
        && a.revision === b.revision && a.text === b.text && a.stateKey === b.stateKey;
    const finishIdle = () => {
        if (draining || inFlight || queue.length || [...operations.values()].some(s => s.timer || s.pending)) return;
        for (const resolve of idleWaiters.splice(0)) resolve();
    };
    async function drain() {
        if (draining) return;
        draining = true;
        while (queue.length) {
            const item = queue.shift();
            const state = opState(item.operationId);
            item.stateKey = stateKey(); // 待ち行列の間に編集状態が変わった場合は、送信直前の状態を使う。
            if (item.kind === 'lite') {
                const key = `${item.text}\u0000${item.stateKey}`;
                if (state.evaluatedLite.has(key)) { onSkip('same-lite', item); continue; }
            }
            inFlight = item;
            const result = await dispatch(item) ?? {};
            if (item.kind === 'lite' && result.complete != null) {
                state.evaluatedLite.add(`${item.text}\u0000${item.stateKey}`);
                state.lastLite = { text:item.text, stateKey:item.stateKey, complete:result.complete };
            }
            inFlight = null;
        }
        draining = false;
        finishIdle();
    }
    const push = (item, front = false) => {
        front ? queue.unshift(item) : queue.push(item);
        void drain();
        return item;
    };
    const cancelPendingLite = (operationId) => {
        const state = opState(operationId);
        if (state.timer) clock.clearTimeout(state.timer);
        if (state.timer || state.pending) onSkip('final-cancelled-lite', state.pending);
        state.timer = null; state.pending = null;
        for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].operationId === operationId && queue[i].kind === 'lite') {
                onSkip('final-cancelled-lite', queue[i]); queue.splice(i, 1);
            }
        }
    };
    // SpeechAnalyzer grows quantities as "3" -> "30" -> "30度". None of
    // those fragments is stable enough to navigate by number. A recognizer
    // final is still dispatched, so "カット3" and "3番目" keep working.
    const hasUnsettledNumericTail = text => /(?:^|[^\p{L}\p{N}])(?:\d+(?:\.\d+)?|[零〇一二三四五六七八九十百千]+)\s*(?:px|ピクセル|%|％|パーセント|度|°|倍|回|秒|分|番(?:目)?|つ目|個目)?\s*[。、,.]?$/iu.test(text);
    return {
        partial(raw) {
            const item = stamp({ ...raw, kind: 'lite', final: false });
            const state = opState(item.operationId);
            if (hasUnsettledNumericTail(item.text)) {
                if (state.timer) clock.clearTimeout(state.timer);
                if (state.pending) onSkip('numeric-tail', state.pending);
                state.timer = null; state.pending = null;
                onSkip('numeric-tail', item); finishIdle(); return null;
            }
            if (!partialPredicate(item)) {
                const cancelled = state.pending;
                if (state.timer) clock.clearTimeout(state.timer);
                state.timer = null; state.pending = null;
                if (cancelled) onSkip('partial-policy-cancelled', cancelled);
                onSkip('partial-policy', item); finishIdle(); return null;
            }
            const key = `${item.text}\u0000${item.stateKey}`;
            if (state.evaluatedLite.has(key) || (inFlight?.kind === 'lite' && same(inFlight, item))) {
                onSkip('same-lite', item); return null;
            }
            if (state.pending) onSkip('superseded-lite', state.pending);
            state.pending = item;
            if (state.timer) return item;
            const wait = state.partialSent
                ? Math.max(0, partialDelayMs - (clock.now() - state.lastPartialAt))
                : initialPartialDelayMs;
            state.timer = clock.setTimeout(() => {
                state.timer = null; state.lastPartialAt = clock.now(); state.partialSent = true;
                const next = state.pending; state.pending = null;
                if (next) push(next);
            }, wait);
            return item;
        },
        early(raw) {
            const item = stamp({ ...raw, kind: 'early', final: true, early: true });
            const state = opState(item.operationId);
            const threshold = completeGate();
            if (state.pending && state.pending.text !== item.text && state.pending.text.startsWith(item.text)) {
                onSkip('superseded-early', item); return null;
            }
            if (state.lastLite?.text === item.text && state.lastLite.stateKey === item.stateKey
                && Number.isFinite(threshold) && state.lastLite.complete != null && state.lastLite.complete < threshold) {
                onSkip('lite-incomplete', item); return null;
            }
            return push(item);
        },
        final(raw) {
            const item = stamp({ ...raw, kind: 'final', final: true, early: false });
            cancelPendingLite(item.operationId);
            if (inFlight?.kind === 'early' && same(inFlight, item)) {
                inFlight.promotedFinal = item;
                onSkip('promoted-inflight-early', item);
                return inFlight;
            }
            const queuedEarly = queue.findIndex(q => q.kind === 'early' && same(q, item));
            if (queuedEarly >= 0) {
                queue.splice(queuedEarly, 1, item);
                onSkip('replaced-queued-early', item);
                return item;
            }
            return push(item);
        },
        enqueue(raw, { front = false } = {}) { return push(stamp(raw), front); },
        prepend(items) { queue.unshift(...items.map(stamp)); void drain(); },
        reset() {
            for (const state of operations.values()) if (state.timer) clock.clearTimeout(state.timer);
            operations.clear(); queue.length = 0;
            finishIdle();
        },
        close(operationId) { cancelPendingLite(operationId); },
        idle() {
            if (!draining && !inFlight && !queue.length && ![...operations.values()].some(s => s.timer || s.pending)) return Promise.resolve();
            return new Promise(resolve => idleWaiters.push(resolve));
        },
        get pending() { return queue.length + (inFlight ? 1 : 0); },
        get busy() { return draining || Boolean(inFlight); },
        get inFlight() { return inFlight; },
    };
}
