import { injectable } from '@theia/core/shared/inversify';
import {
    AkariCompanionClient,
    CompanionInstruction,
    CompanionResultMessage
} from '../common/akari-companion-protocol';

@injectable()
export class AkariCompanionClientImpl implements AkariCompanionClient {
    protected handler: ((instruction: CompanionInstruction) => Promise<CompanionResultMessage>) | undefined;

    setHandler(handler: typeof this.handler): void {
        this.handler = handler;
    }

    async executeInstruction(instruction: CompanionInstruction): Promise<CompanionResultMessage> {
        if (!this.handler) return { id: instruction.id, ok: false, error: 'rejected' };
        return this.handler(instruction);
    }

    onConnectionState(): void {
        // 次の拡張段階が接続表示に使うための受け口。
    }
}
