import { inject, injectable } from '@theia/core/shared/inversify';
import { lintProjectCandidates } from '@akari-video/edit-store/lib/write-gate';
import {
    AkariCompanionClient,
    AkariCompanionService,
    CompanionInstruction,
    CompanionManifestPanel,
    CompanionProjectLocation,
    CompanionResultMessage,
    CompanionStateDocs,
    CompanionStateLight
} from '../common/akari-companion-protocol';
import { gateCompanionApplyEdit } from './companion-apply-edit-gate';
import { CompanionProcessManager } from './companion-process-manager';

@injectable()
export class AkariCompanionServiceImpl implements AkariCompanionService {
    protected client: AkariCompanionClient | undefined;
    protected location: CompanionProjectLocation | undefined;
    @inject(CompanionProcessManager)
    protected readonly manager!: CompanionProcessManager;
    protected enabled = true;
    protected executionEpoch = 0;
    protected readonly owner = {
        execute: (instruction: CompanionInstruction) => this.executeGated(instruction),
        onConnectionState: (connected: boolean, panel?: CompanionManifestPanel) => {
            if (!connected) this.executionEpoch++;
            this.client?.onConnectionState(connected, panel);
        }
    };

    setClient(client: AkariCompanionClient | undefined): void {
        this.client = client;
        if (!client) void this.manager.release(this.owner);
    }

    async setEnabled(enabled: boolean): Promise<void> {
        this.enabled = enabled;
        if (!enabled) await this.manager.release(this.owner);
    }

    async start(): Promise<boolean> {
        if (!this.enabled || !this.client) return false;
        return this.manager.start(this.owner);
    }

    dispose(): void {
        this.enabled = false;
        this.setClient(undefined);
    }

    async notifyProjectChanged(location: CompanionProjectLocation | undefined): Promise<void> {
        this.location = location;
        this.executionEpoch++;
        this.manager.projectChanged(this.owner);
    }

    async pushStateLight(state: CompanionStateLight): Promise<void> {
        await this.manager.sendState(this.owner, state);
    }

    async pushStateDocs(state: CompanionStateDocs): Promise<void> {
        await this.manager.sendState(this.owner, state);
    }

    protected async executeGated(instruction: CompanionInstruction): Promise<CompanionResultMessage> {
        const epoch = this.executionEpoch;
        const gated = await gateCompanionApplyEdit(instruction, {
            currentLocation: () => this.location,
            lintCandidates: (projectRoot, candidates) => lintProjectCandidates(projectRoot, candidates)
        });
        if (gated) return gated;
        if (epoch !== this.executionEpoch || !this.manager.isOwner(this.owner)) {
            return { id: instruction.id, ok: false, error: 'stale-session' };
        }
        if (!this.client) return { id: instruction.id, ok: false, error: 'rejected' };
        return this.client.executeInstruction(instruction);
    }
}
