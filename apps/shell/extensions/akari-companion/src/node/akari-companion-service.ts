import { injectable } from '@theia/core/shared/inversify';
import { lintProjectCandidates } from '@akari-video/edit-store/lib/write-gate';
import {
    AkariCompanionClient,
    AkariCompanionService,
    CompanionInstruction,
    CompanionProjectLocation,
    CompanionResultMessage,
    CompanionStateDocs,
    CompanionStateLight
} from '../common/akari-companion-protocol';
import { gateCompanionApplyEdit } from './companion-apply-edit-gate';
import { companionConfigPath, readCompanionAddress } from './companion-home';
import { CompanionLink } from './companion-link';

@injectable()
export class AkariCompanionServiceImpl implements AkariCompanionService {
    protected client: AkariCompanionClient | undefined;
    protected location: CompanionProjectLocation | undefined;
    protected link: CompanionLink | undefined;

    setClient(client: AkariCompanionClient | undefined): void {
        this.client = client;
    }

    async setEnabled(enabled: boolean): Promise<void> {
        if (!enabled) {
            this.link?.stop();
            return;
        }
        if (!this.link) {
            this.link = new CompanionLink({
                readAddress: () => readCompanionAddress(companionConfigPath()),
                execute: instruction => this.executeGated(instruction),
                onConnectionState: (connected, panel) => this.client?.onConnectionState(connected, panel)
            });
        }
        this.link.start();
    }

    async notifyProjectChanged(location: CompanionProjectLocation | undefined): Promise<void> {
        this.location = location;
        this.link?.dropQueued('stale-session');
    }

    async pushStateLight(state: CompanionStateLight): Promise<void> {
        await this.link?.sendState(state);
    }

    async pushStateDocs(state: CompanionStateDocs): Promise<void> {
        await this.link?.sendState(state);
    }

    protected async executeGated(instruction: CompanionInstruction): Promise<CompanionResultMessage> {
        const gated = await gateCompanionApplyEdit(instruction, {
            currentLocation: () => this.location,
            lintCandidates: (projectRoot, candidates) => lintProjectCandidates(projectRoot, candidates)
        });
        if (gated) return gated;
        if (!this.client) return { id: instruction.id, ok: false, error: 'rejected' };
        return this.client.executeInstruction(instruction);
    }
}
