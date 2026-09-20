import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type {
    CompanionInstruction,
    CompanionResultMessage,
    CompanionStateDocs,
    CompanionStateLight
} from '../common/akari-companion-protocol';
import { CompanionManifestPanel, parseManifestPanel } from '../common/companion-panel-geometry';

export interface CompanionLinkDeps {
    readAddress(): Promise<{ port: number; token: string } | undefined>;
    execute(instruction: CompanionInstruction): Promise<CompanionResultMessage>;
    now?(): number;
    setTimeout?(fn: () => void, ms: number): unknown;
    clearTimeout?(handle: unknown): void;
    log?(message: string): void;
    onConnectionState?(connected: boolean, panel?: CompanionManifestPanel): void;
}

interface SseFrame {
    event?: string;
    id?: string;
    data: string[];
}

const BACKOFF_MS = [2000, 5000, 10000] as const;
const MAX_QUEUE = 64;
const MAX_RECENT_RESULTS = 200;
const MAX_MANIFEST_BYTES = 1024 * 1024;

export class CompanionLink {
    protected enabled = false;
    protected connected = false;
    protected generation = 0;
    protected reconnectIndex = 0;
    protected reconnectTimer: unknown;
    protected manifestRequest: ClientRequest | undefined;
    protected eventsRequest: ClientRequest | undefined;
    protected eventsResponse: IncomingMessage | undefined;
    protected address: { port: number; token: string } | undefined;
    protected manifestPanel: CompanionManifestPanel | undefined;
    protected readonly queue: CompanionInstruction[] = [];
    protected processing = false;
    protected readonly recentResults = new Map<string, CompanionResultMessage>();
    protected lastEventId: string | undefined;

    constructor(protected readonly deps: CompanionLinkDeps) { }

    start(): void {
        if (this.enabled) return;
        this.enabled = true;
        this.reconnectIndex = 0;
        void this.connect(this.generation);
    }

    stop(): void {
        if (!this.enabled && !this.connected) return;
        this.enabled = false;
        this.generation += 1;
        if (this.reconnectTimer !== undefined) {
            if (this.deps.clearTimeout) this.deps.clearTimeout(this.reconnectTimer);
            else clearTimeout(this.reconnectTimer as ReturnType<typeof setTimeout>);
            this.reconnectTimer = undefined;
        }
        this.manifestRequest?.destroy();
        this.eventsRequest?.destroy();
        this.eventsResponse?.destroy();
        this.manifestRequest = undefined;
        this.eventsRequest = undefined;
        this.eventsResponse = undefined;
        this.address = undefined;
        this.queue.splice(0);
        this.setConnected(false);
    }

    dropQueued(reason: 'stale-session'): void {
        const dropped = this.queue.splice(0);
        for (const instruction of dropped) {
            const result: CompanionResultMessage = { id: instruction.id, ok: false, error: reason };
            this.remember(result);
            void this.sendResult(result);
        }
    }

    async sendState(state: CompanionStateLight | CompanionStateDocs): Promise<void> {
        if (!this.connected) return;
        await this.postJson('/companion/state', state);
    }

    protected async connect(generation: number): Promise<void> {
        if (!this.enabled || generation !== this.generation || this.manifestRequest || this.eventsRequest) return;
        const address = await this.deps.readAddress().catch(() => undefined);
        if (!this.enabled || generation !== this.generation) return;
        if (!address) {
            this.scheduleReconnect(generation);
            return;
        }
        const nonce = randomBytes(16).toString('hex');
        const request = http.request({
            host: '127.0.0.1', port: address.port,
            method: 'GET', path: `/companion/manifest?nonce=${encodeURIComponent(nonce)}`,
            headers: { Authorization: `Bearer ${address.token}`, Accept: 'application/json' }
        }, response => this.readManifest(response, address, nonce, generation));
        this.manifestRequest = request;
        request.once('error', () => this.failRound(generation));
        request.once('close', () => {
            if (this.manifestRequest === request) this.manifestRequest = undefined;
        });
        request.end();
    }

    protected readManifest(
        response: IncomingMessage,
        address: { port: number; token: string },
        nonce: string,
        generation: number
    ): void {
        if (!this.enabled || generation !== this.generation || response.statusCode !== 200) {
            response.resume();
            this.failRound(generation);
            return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
            body += chunk;
            if (body.length > MAX_MANIFEST_BYTES) response.destroy();
        });
        response.once('error', () => this.failRound(generation));
        response.once('end', () => {
            if (!this.enabled || generation !== this.generation) return;
            let manifest: { protocol?: unknown; proof?: unknown };
            try {
                manifest = JSON.parse(body);
            } catch {
                this.failRound(generation);
                return;
            }
            const expected = createHmac('sha256', address.token).update(nonce).digest();
            const actual = typeof manifest.proof === 'string' && /^[0-9a-f]{64}$/i.test(manifest.proof)
                ? Buffer.from(manifest.proof, 'hex') : Buffer.alloc(0);
            if (manifest.protocol !== 0 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
                this.failRound(generation);
                return;
            }
            this.manifestPanel = { ...parseManifestPanel(manifest), port: address.port };
            this.openEvents(address, generation);
        });
    }

    protected openEvents(address: { port: number; token: string }, generation: number): void {
        if (!this.enabled || generation !== this.generation) return;
        const headers: Record<string, string> = {
            Authorization: `Bearer ${address.token}`,
            Accept: 'text/event-stream'
        };
        if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId;
        const request = http.request({
            host: '127.0.0.1', port: address.port, method: 'GET', path: '/companion/events', headers
        }, response => this.consumeEvents(response, address, generation));
        this.eventsRequest = request;
        request.once('error', () => this.failRound(generation));
        request.end();
    }

    protected consumeEvents(
        response: IncomingMessage,
        address: { port: number; token: string },
        generation: number
    ): void {
        if (!this.enabled || generation !== this.generation || response.statusCode !== 200) {
            response.resume();
            this.failRound(generation);
            return;
        }
        this.eventsResponse = response;
        this.address = address;
        this.reconnectIndex = 0;
        this.setConnected(true);
        response.setEncoding('utf8');
        let remainder = '';
        let frame: SseFrame = { data: [] };
        const finishFrame = (): void => {
            const current = frame;
            frame = { data: [] };
            if (current.event === 'ping' || current.data.length === 0) return;
            try {
                const instruction = JSON.parse(current.data.join('\n')) as CompanionInstruction;
                if ((!instruction.id || typeof instruction.id !== 'string') && current.id) instruction.id = current.id;
                if (typeof instruction.id !== 'string' || instruction.id.length === 0 || typeof instruction.kind !== 'string') return;
                this.enqueue(instruction);
            } catch {
                return;
            }
        };
        const consumeLine = (line: string): void => {
            if (line === '') {
                finishFrame();
                return;
            }
            if (line.startsWith(':')) return;
            const separator = line.indexOf(':');
            const field = separator < 0 ? line : line.slice(0, separator);
            let value = separator < 0 ? '' : line.slice(separator + 1);
            if (value.startsWith(' ')) value = value.slice(1);
            if (field === 'event') frame.event = value;
            else if (field === 'id') frame.id = value;
            else if (field === 'data') frame.data.push(value);
        };
        response.on('data', chunk => {
            remainder += chunk;
            let newline: number;
            while ((newline = remainder.indexOf('\n')) >= 0) {
                const raw = remainder.slice(0, newline);
                remainder = remainder.slice(newline + 1);
                consumeLine(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
            }
        });
        response.once('error', () => this.failRound(generation));
        response.once('close', () => this.failRound(generation));
        response.once('end', () => this.failRound(generation));
    }

    protected enqueue(instruction: CompanionInstruction): void {
        const cached = this.recentResults.get(instruction.id);
        if (cached) {
            void this.sendResult(cached);
            return;
        }
        if (this.queue.length + (this.processing ? 1 : 0) >= MAX_QUEUE) {
            const result: CompanionResultMessage = { id: instruction.id, ok: false, error: 'busy' };
            this.remember(result);
            void this.sendResult(result);
            return;
        }
        this.queue.push(instruction);
        void this.processQueue();
    }

    protected async processQueue(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        try {
            while (this.queue.length > 0 && this.enabled) {
                const instruction = this.queue.shift()!;
                const cached = this.recentResults.get(instruction.id);
                if (cached) {
                    await this.sendResult(cached);
                    continue;
                }
                let result: CompanionResultMessage;
                try {
                    const executed = await this.deps.execute(instruction);
                    result = { ...executed, id: instruction.id };
                } catch (error) {
                    result = {
                        id: instruction.id, ok: false, error: 'rejected',
                        value: { reasons: [String((error as Error)?.message ?? error)] }
                    };
                }
                this.remember(result);
                this.lastEventId = instruction.id;
                await this.sendResult(result);
            }
        } finally {
            this.processing = false;
            if (this.queue.length > 0 && this.enabled) void this.processQueue();
        }
    }

    protected remember(result: CompanionResultMessage): void {
        this.recentResults.set(result.id, result);
        while (this.recentResults.size > MAX_RECENT_RESULTS) {
            const oldest = this.recentResults.keys().next().value;
            if (oldest === undefined) break;
            this.recentResults.delete(oldest);
        }
    }

    protected async sendResult(result: CompanionResultMessage): Promise<void> {
        if (!this.connected) return;
        await this.postJson('/companion/results', result);
    }

    protected async postJson(path: string, value: unknown): Promise<void> {
        const address = this.address;
        if (!this.connected || !address) return;
        const body = JSON.stringify(value);
        await new Promise<void>(resolve => {
            const request = http.request({
                host: '127.0.0.1', port: address.port, method: 'POST', path,
                headers: {
                    Authorization: `Bearer ${address.token}`,
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body)
                }
            }, response => {
                response.resume();
                response.once('end', resolve);
                response.once('error', resolve);
            });
            request.once('error', () => resolve());
            request.end(body);
        });
    }

    protected failRound(generation: number): void {
        if (!this.enabled || generation !== this.generation) return;
        this.manifestRequest?.destroy();
        this.eventsRequest?.destroy();
        this.eventsResponse?.destroy();
        this.manifestRequest = undefined;
        this.eventsRequest = undefined;
        this.eventsResponse = undefined;
        this.address = undefined;
        this.setConnected(false);
        this.scheduleReconnect(generation);
    }

    protected scheduleReconnect(generation: number): void {
        if (!this.enabled || generation !== this.generation || this.reconnectTimer !== undefined) return;
        const delay = BACKOFF_MS[Math.min(this.reconnectIndex, BACKOFF_MS.length - 1)];
        this.reconnectIndex = Math.min(this.reconnectIndex + 1, BACKOFF_MS.length - 1);
        this.reconnectTimer = (this.deps.setTimeout ?? setTimeout)(() => {
            this.reconnectTimer = undefined;
            void this.connect(generation);
        }, delay);
    }

    protected setConnected(connected: boolean): void {
        if (!connected) this.manifestPanel = undefined;
        if (this.connected === connected) return;
        this.connected = connected;
        this.deps.onConnectionState?.(connected, connected ? this.manifestPanel : undefined);
    }
}
