export interface SwapTrialIdentity { token: string; startedAt: number; }
export interface SwapPlaybackState {
    revision: number; readyRevision: number; loading: boolean; lastReloadAt: number;
    sends: number; lastSentAt: number; started: boolean; cancelled: boolean;
}
export type SwapPlaybackEvent =
    | { type: 'reload-start' | 'reload-complete' | 'queued'; now: number }
    | { type: 'ready'; revision: number; now: number }
    | { type: 'sent'; now: number }
    | { type: 'observed'; playing: boolean; userStopped?: boolean }
    | { type: 'cancel' };
export function initialSwapPlaybackState(now: number): SwapPlaybackState {
    return { revision: 0, readyRevision: -1, loading: false, lastReloadAt: now,
        sends: 0, lastSentAt: 0, started: false, cancelled: false };
}
export function reduceSwapPlayback(state: SwapPlaybackState, event: SwapPlaybackEvent): SwapPlaybackState {
    switch (event.type) {
        case 'reload-start': return { ...state, revision: state.revision + 1, loading: true, lastReloadAt: event.now };
        case 'reload-complete': return { ...state, loading: false, lastReloadAt: event.now };
        case 'queued': return { ...state, revision: state.revision + 1, lastReloadAt: event.now };
        case 'ready': return event.revision === state.revision ? { ...state, readyRevision: event.revision, loading: false, lastReloadAt: state.loading ? event.now : state.lastReloadAt } : state;
        case 'sent': return { ...state, sends: state.sends + 1, lastSentAt: event.now };
        case 'observed': return { ...state, started: state.started || (state.sends > 0 && event.playing),
            cancelled: state.cancelled || event.userStopped === true };
        case 'cancel': return { ...state, cancelled: true };
    }
}
export function swapPlaybackDecision(state: SwapPlaybackState, now: number): 'cancel' | 'complete' | 'wait' | 'prepare' | 'send' | 'check' | 'failed' {
    if (state.cancelled) return 'cancel';
    if (state.started) return 'complete';
    if (now - state.lastReloadAt < 200) return 'wait';
    if (state.loading) return state.readyRevision !== state.revision ? 'prepare' : 'wait';
    if (state.readyRevision !== state.revision) return 'prepare';
    if (state.sends === 0) return 'send';
    if (now - state.lastSentAt < 400) return 'wait';
    return state.sends >= 4 ? 'failed' : 'check';
}
/** Host-page localStorage flag. INFO is intentional when enabled: Theia forwards it to backend stdout. */
export function swapTrialLoggingEnabled(): boolean {
    try { return globalThis.localStorage?.getItem('akari.swapTrial.log') === '1'; }
    catch { return false; }
}
export function logSwapTrial(trial: SwapTrialIdentity, event: string, detail: Record<string, unknown> = {}): void {
    if (!swapTrialLoggingEnabled()) return;
    console.info('[akari-swap-trial]', JSON.stringify({ token: trial.token, event, t: Math.max(0, Date.now() - trial.startedAt), ...detail }));
}

/** Small controller with injected I/O and clock. No seek is issued after the first play request. */
export class SwapTrialPlayback {
    state: SwapPlaybackState;
    private readonly controller = new AbortController();
    constructor(readonly identity: SwapTrialIdentity, now: number) { this.state = initialSwapPlaybackState(now); }
    get signal(): AbortSignal { return this.controller.signal; }
    event(event: SwapPlaybackEvent): void { this.state = reduceSwapPlayback(this.state, event); }
    cancel(): void { this.event({ type: 'cancel' }); this.controller.abort(); }
    async run(io: {
        now(): number; wait(ms: number): Promise<void>;
        prepare(seek: boolean): Promise<void>; fallbackSeek(): Promise<void>;
        play(): Promise<void>; query(): Promise<{ playing: boolean; userStopped?: boolean }>;
        log(event: string, detail?: Record<string, unknown>): void;
    }): Promise<'playing' | 'cancelled' | 'failed'> {
        const deadline = io.now() + 30000;
        const interrupted = new Promise<never>((_, reject) => this.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
        const run = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, interrupted]);
        try {
            while (io.now() < deadline) {
                const decision = swapPlaybackDecision(this.state, io.now());
                if (decision === 'cancel') return 'cancelled';
                if (decision === 'complete') return 'playing';
                if (decision === 'wait') { await run(io.wait(50)); continue; }
                if (decision === 'prepare') {
                    const revision = this.state.revision;
                    try { await run(io.prepare(this.state.sends === 0)); }
                    catch (error) {
                        if (this.state.cancelled) return 'cancelled';
                        io.log('ready_fallback', { reason: String(error) });
                        if (this.state.sends === 0) await run(io.fallbackSeek());
                    }
                    this.event({ type: 'ready', revision, now: io.now() });
                    continue;
                }
                if (decision !== 'send') {
                    const observed = await run(io.query());
                    io.log('playback_state', { ...observed, source: 'query' });
                    this.event({ type: 'observed', ...observed });
                    if (this.state.cancelled) return 'cancelled';
                    if (this.state.started) return 'playing';
                    if (decision === 'failed') return 'failed';
                    // A refresh or manual pause may have arrived while querying the renderer.
                    if (swapPlaybackDecision(this.state, io.now()) !== 'check') continue;
                    io.log('play_retry', { retry: this.state.sends });
                }
                if (this.state.cancelled) return 'cancelled';
                this.event({ type: 'sent', now: io.now() });
                io.log('play_request', { attempt: this.state.sends, revision: this.state.revision, quietForMs: io.now() - this.state.lastReloadAt });
                await run(io.play());
            }
            return 'failed';
        } catch (error) {
            if (this.state.cancelled) return 'cancelled';
            io.log('playback_error', { reason: String(error) });
            return 'failed';
        }
    }
}
