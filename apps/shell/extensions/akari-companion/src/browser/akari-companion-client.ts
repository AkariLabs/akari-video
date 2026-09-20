import { injectable } from '@theia/core/shared/inversify';
import {
    AkariCompanionClient,
    CompanionManifestPanel,
    CompanionInstruction,
    CompanionResultMessage
} from '../common/akari-companion-protocol';

@injectable()
export class AkariCompanionClientImpl implements AkariCompanionClient {
    protected handler: ((instruction: CompanionInstruction) => Promise<CompanionResultMessage>) | undefined;
    protected panelHandler: ((connected: boolean, panel?: CompanionManifestPanel) => void) | undefined;

    setHandler(handler: typeof this.handler): void {
        this.handler = handler;
    }

    setPanelHandler(handler: typeof this.panelHandler): void {
        this.panelHandler = handler;
    }

    async executeInstruction(instruction: CompanionInstruction): Promise<CompanionResultMessage> {
        if (!this.handler) return { id: instruction.id, ok: false, error: 'rejected' };
        return this.handler(instruction);
    }

    onConnectionState(connected: boolean, panel?: CompanionManifestPanel): void {
        this.panelHandler?.(connected, panel);
    }
}
