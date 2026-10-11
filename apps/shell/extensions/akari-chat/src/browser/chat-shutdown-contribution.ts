import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { AkariChatService } from '../common/chat-protocol';

@injectable()
export class AkariChatShutdownContribution implements FrontendApplicationContribution {
    @inject(AkariChatService)
    protected readonly chat!: AkariChatService;

    onStop(): void {
        try { void this.chat.closeAll().catch(() => undefined); }
        catch { /* The page is already closing. */ }
    }
}
