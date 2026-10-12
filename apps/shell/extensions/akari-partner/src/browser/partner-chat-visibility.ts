export const CHAT_ENABLED_PREFERENCE = 'akari.chat.experimental.enabled';

export function shouldResumeChat(entryId: string | null | undefined, enabled: boolean): boolean {
    return entryId === 'akari-chat' && enabled;
}

export function visibleLastPartner(entryId: string | null | undefined, enabled: boolean): boolean {
    return entryId !== 'akari-chat' || enabled;
}

export function shouldShowChatCard(enabled: boolean): boolean {
    return enabled;
}

export function visibleReviewKind(kind: string | undefined, enabled: boolean): boolean {
    return kind !== 'chat' || enabled;
}
