import type { CompanionInstruction, CompanionResultMessage, CompanionStateDocs, CompanionStateLight } from '../common/akari-companion-protocol';
import type { CompanionManifestPanel } from '../common/companion-panel-geometry';
import { readConfiguredCompanionAddress } from './companion-home';
import { CompanionLink } from './companion-link';
import { CompanionProcess, CompanionProcessOptions } from './companion-process';

export interface CompanionOwner {
    execute(instruction: CompanionInstruction): Promise<CompanionResultMessage>;
    onConnectionState(connected: boolean, panel?: CompanionManifestPanel): void;
}

interface Session {
    owner: CompanionOwner;
    link?: CompanionLink;
    child?: CompanionProcess;
    cancel(): void;
}

export interface CompanionManagerOptions extends CompanionProcessOptions {
    log?(message: string): void;
}

/** Serializes ownership changes so the previous child exits before the next starts. */
export class CompanionProcessManager {
    protected owner: CompanionOwner | undefined;
    protected session: Session | undefined;
    protected revision = 0;
    protected pending: Promise<unknown> = Promise.resolve();
    protected stopped = false;

    constructor(protected readonly options: CompanionManagerOptions = {}) { }

    isOwner(owner: CompanionOwner): boolean {
        return this.owner === owner && this.session?.owner === owner;
    }

    start(owner: CompanionOwner): Promise<boolean> {
        if (this.stopped) return Promise.resolve(false);
        this.owner = owner;
        const revision = ++this.revision;
        this.session?.cancel();
        return this.enqueue(async () => {
            await this.stopSession();
            if (revision !== this.revision) return false;
            let cancelConnection: (() => void) | undefined;
            const session: Session = {
                owner,
                cancel: () => {
                    session.link?.stop();
                    session.child?.cancel();
                    cancelConnection?.();
                }
            };
            this.session = session;
            try {
                const env = this.options.env ?? process.env;
                let address;
                if (env.AKARI_COMPANION_CONFIG) {
                    address = await readConfiguredCompanionAddress(env);
                    if (!address) throw new Error('explicit connection configuration is invalid');
                } else {
                    session.child = new CompanionProcess(this.options);
                    address = await session.child.start(() => {
                        if (this.session !== session) return;
                        session.link?.stop();
                        cancelConnection?.();
                    });
                }
                if (revision !== this.revision) return false;
                const connected = await new Promise<boolean>(resolveConnected => {
                    const timer = setTimeout(() => finish(false), this.options.startupTimeoutMs ?? 5000);
                    const finish = (value: boolean): void => { clearTimeout(timer); resolveConnected(value); };
                    cancelConnection = () => finish(false);
                    session.link = new CompanionLink({
                        readAddress: () => env.AKARI_COMPANION_CONFIG
                            ? readConfiguredCompanionAddress(env) : Promise.resolve(address),
                        execute: instruction => this.isOwner(owner) && this.session === session
                            ? owner.execute(instruction) : Promise.resolve({ id: instruction.id, ok: false, error: 'stale-session' }),
                        onConnectionState: (value, panel) => {
                            owner.onConnectionState(value, panel);
                            if (value) finish(true);
                        }
                    });
                    session.link.start();
                });
                if (!connected) throw new Error('authenticated connection could not be established');
                return revision === this.revision;
            } catch (error) {
                if (revision === this.revision) {
                    const detail = String((error as Error).message).replace(/[\r\n]+/g, ' ');
                    (this.options.log ?? console.warn)(`AKARI バイブ: ${detail}`);
                }
                return false;
            } finally {
                if (revision !== this.revision || !session.link || !this.isOwner(owner)) await this.stopSession();
            }
        }).then(async connected => {
            if (!connected && revision === this.revision) await this.release(owner);
            return connected;
        });
    }

    release(owner: CompanionOwner): Promise<void> {
        if (this.owner !== owner) return Promise.resolve();
        this.owner = undefined;
        ++this.revision;
        this.session?.cancel();
        return this.enqueue(() => this.stopSession());
    }

    async sendState(owner: CompanionOwner, state: CompanionStateLight | CompanionStateDocs): Promise<void> {
        if (this.isOwner(owner)) await this.session?.link?.sendState(state);
    }

    projectChanged(owner: CompanionOwner): void {
        if (this.isOwner(owner)) this.session?.link?.dropQueued('stale-session');
    }

    onStop(): Promise<void> {
        this.stopped = true;
        this.owner = undefined;
        ++this.revision;
        this.session?.cancel();
        return this.enqueue(() => this.stopSession());
    }

    protected async stopSession(): Promise<void> {
        const session = this.session;
        if (!session) return;
        session.cancel();
        await session.child?.stop();
        if (this.session === session) this.session = undefined;
    }

    protected enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.pending.then(operation);
        this.pending = result.catch(() => undefined);
        return result;
    }
}
