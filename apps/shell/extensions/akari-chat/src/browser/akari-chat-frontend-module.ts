import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WebSocketConnectionProvider, WidgetFactory } from '@theia/core/lib/browser';
import { CommandContribution } from '@theia/core/lib/common';
import type { ChatEvent } from '../common/chat-events';
import { AKARI_CHAT_SERVICE_PATH, AkariChatService } from '../common/chat-protocol';
import { AkariChatWidget } from './akari-chat-widget';
import { AkariChatContribution } from './akari-chat-contribution';
import { AkariChatShutdownContribution } from './chat-shutdown-contribution';

export default new ContainerModule(bind => {
    bind(AkariChatWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariChatWidget.ID,
        createWidget: () => context.container.get(AkariChatWidget)
    })).inSingletonScope();
    bind(AkariChatService).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy(context.container, AKARI_CHAT_SERVICE_PATH, {
            onEvent: (chatId: string, event: ChatEvent) =>
                context.container.get(AkariChatWidget).receive(chatId, event)
        })
    ).inSingletonScope();
    bind(AkariChatContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariChatContribution);
    bind(AkariChatShutdownContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariChatShutdownContribution);
});
