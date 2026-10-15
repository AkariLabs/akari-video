export function preserveReadyPreviewAudio<T extends { audio?: any }>(previous: T | undefined, next: T): T {
    const oldAudio = previous?.audio;
    const newAudio = next.audio;
    if (!oldAudio || !newAudio) return next;
    for (const name of ['bgms', 'sfx', 'narration', 'speech', 'embeddedSpeech']) {
        const before = oldAudio[name];
        const after = newAudio[name];
        if (!Array.isArray(before) || !Array.isArray(after)) continue;
        for (const item of after) {
            if (item.sidecarState !== 'queued' && item.sidecarState !== 'generating') continue;
            const ready = before.find((candidate: any) => candidate.id === item.id
                && item.sidecarKey && candidate.sidecarKey === item.sidecarKey
                && candidate.sidecarState === 'ready' && candidate.sidecar?.path);
            if (ready) { item.sidecarState = 'ready'; item.sidecarKey = ready.sidecarKey; item.sidecar = ready.sidecar; }
        }
    }
    if (newAudio.bgm?.sidecarState === 'queued' || newAudio.bgm?.sidecarState === 'generating') {
        const ready = (oldAudio.bgms ?? [oldAudio.bgm]).find((item: any) => item
            && item.id === newAudio.bgm.id && newAudio.bgm.sidecarKey
            && item.sidecarKey === newAudio.bgm.sidecarKey
            && item.sidecarState === 'ready' && item.sidecar?.path);
        if (ready) { newAudio.bgm.sidecarState = 'ready'; newAudio.bgm.sidecar = ready.sidecar; }
    }
    return next;
}

export function previewAudioResyncKeys(
    supply: { gate?: { holding?: boolean; reason?: string | null; heldMs?: number }; pendingSidecar?: string[] } | undefined,
    since: Map<string, number>, now: number,
    gateState: { holdingSidecar: boolean; startedAt?: number }
): string[] {
    const pending = Array.isArray(supply?.pendingSidecar) ? supply.pendingSidecar : [];
    const live = new Set(pending);
    for (const key of since.keys()) if (!live.has(key)) since.delete(key);
    const keys: string[] = [];
    for (const key of pending) {
        if (!since.has(key)) since.set(key, now);
        if (now - since.get(key)! >= 5000) keys.push(key);
    }
    const holdingSidecar = supply?.gate?.holding === true && supply.gate.reason === 'sidecar';
    const releasedWithPending = gateState.holdingSidecar && supply?.gate?.holding === false && pending.length > 0;
    if (holdingSidecar && !gateState.holdingSidecar) gateState.startedAt = now;
    const limitReached = holdingSidecar && ((supply.gate?.heldMs ?? 0) >= 2900
        || now - (gateState.startedAt ?? now) >= 2900);
    gateState.holdingSidecar = holdingSidecar;
    if (!holdingSidecar) gateState.startedAt = undefined;
    if (releasedWithPending || limitReached) {
        return [...new Set([...keys, ...pending])];
    }
    return keys;
}

export interface PreviewAudioDiagnosticRecord {
    latest?: Record<string, any>;
    abnormal?: Record<string, any>;
    events: Array<{ at: string; kind: string; detail?: string }>;
}

export function formatPreviewAudioDiagnostics(
    record: PreviewAudioDiagnosticRecord | undefined,
    labels: { heading: string; latest: string; abnormal: string; events: string; host: string;
        pending: string; lastQuery: string; lastUpdate: string; lastResult: string },
    host?: { pending?: Array<{ key?: string; state?: string }>; lastQuery?: string;
        lastUpdate?: string; lastResult?: { key?: string; state?: string } }
): string {
    const value = (item: any) => item === undefined || item === null || item === '' ? '-' : String(item);
    const list = (items: any) => Array.isArray(items) && items.length ? items.join(',') : '-';
    const seconds = (item: any) => typeof item === 'number' ? item.toFixed(1) + 's' : '-';
    const milliseconds = (item: any, fixed: boolean) => typeof item === 'number' && Number.isFinite(item)
        ? (fixed ? item.toFixed(1) : String(Number(item.toFixed(1)))) + 'ms' : '-';
    const sample = (item: any) => {
        if (!item) return '-';
        const supply = item.supply ?? {};
        const gate = supply.gate ?? {};
        const scheduled = item.scheduled ?? {};
        const prefetch = item.prefetch ?? {};
        return `${value(item.at)} page=${value(item.pageId)}: phase=${value(supply.phase)} gate=${gate.holding ? 'holding ' + seconds((gate.heldMs ?? 0) / 1000) : 'free'} reason=${value(gate.reason)} start=${seconds(gate.startSec)}`
            + ` / pending=${list(supply.pendingSidecar)} ready=${list(supply.ready)} failed=${list(supply.failed)} noAudio=${list(supply.noAudio)}`
            + ` / ctx=${value(item.contextState)} playing=${value(item.playing)} rate=${value(item.rate)}`
            + ` / scheduled start=${seconds(scheduled.startAtSec)} items=${value(scheduled.itemCount)} speech=${value(scheduled.speech)} skipped=${list(scheduled.skipped)}`
            + ` / prefetch pending=${value(prefetch.pending)} decoded=${typeof prefetch.decodedBytes === 'number' ? (prefetch.decodedBytes / 1048576).toFixed(1) + 'MB' : '-'} over=${value(prefetch.overBudget)} windows=${prefetch.windows && typeof prefetch.windows === 'object' ? Object.entries(prefetch.windows).map(([key, count]) => key + ':' + count).join(',') : '-'}`
            + ` / pos=${seconds(item.audioPositionSec)} rendered=${seconds(item.renderedTimelineSec)} drift=${milliseconds(item.driftMs, true)} latency=${milliseconds(item.outputLatencyMs, false)}`;
    };
    const events = record?.events?.length ? record.events.map(event =>
        `${value(event.at)} ${value(event.kind)}${event.detail ? ' ' + event.detail : ''}`).join(' / ') : '-';
    const pending = host?.pending?.length ? host.pending.map(item =>
        `${value(item.key)}(${value(item.state)})`).join(',') : '-';
    const result = host?.lastResult ? `${value(host.lastResult.key)} ${value(host.lastResult.state)}` : '-';
    return [labels.heading,
        labels.latest + ' ' + sample(record?.latest),
        labels.abnormal + ' ' + sample(record?.abnormal)
            + (record?.abnormal ? ` / waited=${list(record.abnormal.episodePending)} failedDuring=${list(record.abnormal.episodeFailed)}` : ''),
        labels.events + ': ' + events,
        labels.host + ': ' + `${labels.pending}=${pending} ${labels.lastQuery}=${value(host?.lastQuery)} ${labels.lastUpdate}=${value(host?.lastUpdate)} ${labels.lastResult}=${result}`].join('\n');
}
