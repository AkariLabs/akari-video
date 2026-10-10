type ClosestElement = {
    closest(selector: string): Element | null;
};

export function isChatDropTarget(target: EventTarget | null): boolean {
    if (!target) {
        return false;
    }
    const candidate = target as EventTarget & {
        closest?: ClosestElement['closest'];
        parentElement?: ClosestElement | null;
    };
    if (typeof candidate.closest === 'function') {
        return !!candidate.closest('[data-akari-chat]');
    }
    return !!candidate.parentElement?.closest('[data-akari-chat]');
}
