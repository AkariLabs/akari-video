export const CHAT_ENABLED_PREFERENCE = 'akari.chat.experimental.enabled';

export function chatEnabled(value: unknown): boolean {
    return value === true;
}

export function chatCommandAllowed(value: unknown): boolean {
    return chatEnabled(value);
}

export function shouldCloseRestoredChat(widgetId: string, enabled: unknown): boolean {
    return widgetId === 'akari-chat-widget' && !chatEnabled(enabled);
}
