export interface ShelfPlaybook { id: string; name: string; depth: number; placeholders?: readonly { id: string }[] }
export function playbookShelfAction(book: Pick<ShelfPlaybook, 'depth' | 'placeholders'>): 'drag' | 'open' {
    return book.depth === 3 || book.depth === 2 && !!book.placeholders?.length ? 'drag' : 'open';
}
export function playbookDragPayload(book: ShelfPlaybook, dir: string): {
    kind: 'playbook'; id: string; name: string; depth: number; dir: string;
} { return { kind: 'playbook', id: book.id, name: book.name, depth: book.depth, dir }; }

export function channelFromProjectPath(value: string | undefined): string | undefined {
    const match = value?.replaceAll('\\', '/').match(/(?:^|\/)channels\/([a-z0-9][a-z0-9-]*)\/videos\//);
    return match?.[1];
}
