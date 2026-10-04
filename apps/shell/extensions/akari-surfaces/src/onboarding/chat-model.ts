export interface ChatLine { kind: 'text' | 'code'; text: string }
export interface ChatMessage { role: 'user' | 'assistant'; lines: ChatLine[] }

export function groupChatLines(lines: string[]): { note?: string; messages: ChatMessage[] } {
    const note = lines[0]?.startsWith('完成例です。') ? lines[0] : undefined;
    const messages: ChatMessage[] = [];
    for (const line of note ? lines.slice(1) : lines) {
        const role = line.startsWith('> ') ? 'user' : 'assistant';
        const text = role === 'user' ? line.slice(2) : line;
        const kind = /^(akari |edit\.json$|edit-lint |captions\.json$)/.test(text) ? 'code' : 'text';
        if (messages[messages.length - 1]?.role !== role) messages.push({ role, lines: [] });
        messages[messages.length - 1].lines.push({ kind, text });
    }
    return { note, messages };
}
