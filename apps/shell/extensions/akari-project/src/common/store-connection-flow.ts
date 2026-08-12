import {
    StoreConnectionStatus,
    StoreDevicePollOutcome,
    StoreDeviceStartOutcome
} from './akari-project-protocol';

export type StoreConnectionFlowPhase = 'idle' | 'starting' | 'pending' | 'expired' | 'error';

export interface StoreConnectionFlowState {
    connection: StoreConnectionStatus;
    connectionLoading: boolean;
    phase: StoreConnectionFlowPhase;
    error?: string;
    userCode?: string;
}

export interface StoreConnectionFlowServiceClient {
    getStoreConnectionStatus(): Promise<StoreConnectionStatus>;
    startStoreDeviceConnection(): Promise<StoreDeviceStartOutcome>;
    pollStoreDeviceConnection(request: { baseUrl: string; deviceCode: string }): Promise<StoreDevicePollOutcome>;
    disconnectStoreAccount(): Promise<boolean>;
}

export interface StoreConnectionFlowHooks {
    openVerificationUrl(url: string): void;
    onChange(state: StoreConnectionFlowState): void;
    now?(): number;
    setTimer?(callback: () => void, delayMs: number): unknown;
    clearTimer?(handle: unknown): void;
}

export class StoreConnectionFlowController {
    private connection: StoreConnectionStatus = { connected: false };
    private connectionLoading = false;
    private phase: StoreConnectionFlowPhase = 'idle';
    private error?: string;
    private userCode?: string;
    private deviceStart?: Extract<StoreDeviceStartOutcome, { status: 'started' }>;
    private generation = 0;
    private pollHandle?: unknown;

    private readonly now: () => number;
    private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
    private readonly clearTimer: (handle: unknown) => void;

    constructor(
        private readonly service: StoreConnectionFlowServiceClient,
        private readonly hooks: StoreConnectionFlowHooks
    ) {
        this.now = hooks.now ?? Date.now;
        this.setTimer = hooks.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
        this.clearTimer = hooks.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
    }

    public async refreshStatus(): Promise<void> {
        this.connectionLoading = true;
        this.emitChange();
        try {
            const connection = await this.service.getStoreConnectionStatus();
            this.connection = connection;
            if (connection.connected) {
                this.stopPolling();
                this.generation++;
                this.phase = 'idle';
                this.error = undefined;
                this.userCode = undefined;
                this.deviceStart = undefined;
            }
        } catch (error) {
            if (this.phase === 'idle') {
                this.phase = 'error';
                this.error = `接続状態を確認できませんでした: ${this.errorMessage(error)}`;
            }
        } finally {
            this.connectionLoading = false;
            this.emitChange();
        }
    }

    public async start(): Promise<void> {
        this.stopPolling();
        const generation = ++this.generation;
        this.phase = 'starting';
        this.error = undefined;
        this.userCode = undefined;
        this.deviceStart = undefined;
        this.emitChange();

        let outcome: StoreDeviceStartOutcome;
        try {
            outcome = await this.service.startStoreDeviceConnection();
        } catch (error) {
            if (generation !== this.generation) {
                return;
            }
            this.phase = 'error';
            this.error = `接続を開始できませんでした: ${this.errorMessage(error)}`;
            this.emitChange();
            return;
        }
        if (generation !== this.generation) {
            return;
        }
        if (outcome.status !== 'started') {
            this.phase = 'error';
            this.error = outcome.error;
            this.emitChange();
            return;
        }

        this.deviceStart = outcome;
        this.userCode = outcome.userCode;
        try {
            this.hooks.openVerificationUrl(outcome.verificationUrl);
        } catch (error) {
            this.phase = 'error';
            this.error = `承認ページを開けませんでした: ${this.errorMessage(error)}`;
            this.emitChange();
            return;
        }
        this.phase = 'pending';
        this.emitChange();
        this.schedulePoll(generation, outcome.intervalMs);
    }

    public cancel(): void {
        this.stopPolling();
        this.generation++;
        this.phase = 'idle';
        this.error = undefined;
        this.userCode = undefined;
        this.deviceStart = undefined;
        this.emitChange();
    }

    public async disconnect(): Promise<void> {
        await this.service.disconnectStoreAccount();
        this.cancel();
        this.connection = { connected: false };
        this.emitChange();
    }

    public dispose(): void {
        this.stopPolling();
        this.generation++;
    }

    private schedulePoll(generation: number, intervalMs: number): void {
        this.stopPolling();
        this.pollHandle = this.setTimer(() => void this.poll(generation), intervalMs);
    }

    private async poll(generation: number): Promise<void> {
        const start = this.deviceStart;
        if (generation !== this.generation || !start || this.phase !== 'pending') {
            return;
        }
        if (this.now() >= start.expiresAt) {
            this.expire();
            return;
        }

        let outcome: StoreDevicePollOutcome;
        try {
            outcome = await this.service.pollStoreDeviceConnection({
                baseUrl: start.baseUrl,
                deviceCode: start.deviceCode
            });
        } catch (error) {
            if (generation !== this.generation) {
                return;
            }
            this.phase = 'error';
            this.error = `接続を確認できませんでした: ${this.errorMessage(error)}`;
            this.emitChange();
            return;
        }
        if (generation !== this.generation) {
            return;
        }
        if (outcome.status === 'pending') {
            this.schedulePoll(generation, start.intervalMs);
            return;
        }
        if (outcome.status === 'expired') {
            this.expire();
            return;
        }
        if (outcome.status !== 'approved') {
            this.phase = 'error';
            this.error = outcome.error;
            this.emitChange();
            return;
        }

        this.stopPolling();
        this.generation++;
        this.connection = outcome.connection;
        this.phase = 'idle';
        this.error = undefined;
        this.userCode = undefined;
        this.deviceStart = undefined;
        this.emitChange();
    }

    private expire(): void {
        this.stopPolling();
        this.phase = 'expired';
        this.error = '確認コードの有効期限が切れました。';
        this.userCode = undefined;
        this.deviceStart = undefined;
        this.emitChange();
    }

    private stopPolling(): void {
        if (this.pollHandle !== undefined) {
            this.clearTimer(this.pollHandle);
            this.pollHandle = undefined;
        }
    }

    private emitChange(): void {
        this.hooks.onChange({
            connection: { ...this.connection },
            connectionLoading: this.connectionLoading,
            phase: this.phase,
            error: this.error,
            userCode: this.userCode
        });
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
