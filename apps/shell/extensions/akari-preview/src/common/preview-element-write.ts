const ELEMENT_CONFLICT_KEYS = ['transform', 'html', 'text', 'duplicate', 'params', 'vars', 'xyKeyframes'];

export function assertNoElementWriteConflict(patch: object & { element?: unknown }): void {
    if (patch.element && ELEMENT_CONFLICT_KEYS.some(key => key in patch)) {
        throw new Error('要素の移動と別の書き戻しを同時に指定できません');
    }
}

export function isElementSelectionFileReference(path: unknown): boolean {
    return typeof path === 'string' && path.trim().length > 0 && !path.trimStart().startsWith('<');
}
