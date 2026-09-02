export interface InspectorSectionDef<TField> {
    id: string;
    label: string;
    fields: ReadonlyArray<TField>;
    collapsedByDefault?: boolean;
    optionalFields?: ReadonlyArray<TField & { name: string }>;
}

export interface InspectorStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export class InspectorSectionState {
    constructor(
        protected readonly storage: InspectorStorage,
        protected readonly prefix = 'akari.inspector.section.v1'
    ) { }

    isCollapsed(kind: string, section: { id: string; collapsedByDefault?: boolean }): boolean {
        const saved = this.storage.getItem(`${this.prefix}:${kind}:${section.id}`);
        return saved === null ? section.collapsedByDefault === true : saved === 'true';
    }

    setCollapsed(kind: string, sectionId: string, collapsed: boolean): void {
        this.storage.setItem(`${this.prefix}:${kind}:${sectionId}`, String(collapsed));
    }
}

const ORDER = ['time', 'transform', 'crop', 'appearance', 'easing', 'content', 'style', 'timing', 'audio', 'knobs', 'telop', 'info'];

export function composeInspectorSections<T extends { id: string }>(sections: readonly T[]): T[] {
    return [...sections].sort((left, right) => {
        const leftIndex = ORDER.indexOf(left.id.split(':')[0]);
        const rightIndex = ORDER.indexOf(right.id.split(':')[0]);
        return (leftIndex < 0 ? ORDER.length - 2 : leftIndex)
            - (rightIndex < 0 ? ORDER.length - 2 : rightIndex);
    });
}
