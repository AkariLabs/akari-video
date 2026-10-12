export function reviewAttachDestination(kind: string | undefined, chatEnabled: boolean): 'chat' | 'terminal' | 'clipboard' {
    if (kind === 'chat' || !kind) return chatEnabled ? 'chat' : 'clipboard';
    return kind === 'terminal' ? 'terminal' : 'clipboard';
}
