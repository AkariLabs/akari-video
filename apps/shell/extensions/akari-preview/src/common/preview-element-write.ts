const ELEMENT_CONFLICT_KEYS = ['transform', 'html', 'text', 'duplicate', 'params', 'vars', 'xyKeyframes'];
const ELEMENT_STYLE_KEYS = new Set(['translate', 'rotate', 'width', 'height', 'box-sizing',
    'min-width', 'min-height', 'max-width', 'max-height', 'flex', 'display']);
const NUMBER_PX = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)px$/u;
const NUMBER_DEG = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)deg$/u;
const TRANSLATE = /^\s*[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?px\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?px\s*$/iu;

export function assertPreviewElementStyleAllowed(element: unknown): void {
    const style = (element as { style?: unknown } | null)?.style;
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
        throw new Error('要素の style が不正です');
    }
    for (const [name, value] of Object.entries(style)) {
        if (!ELEMENT_STYLE_KEYS.has(name)) throw new Error(`要素の style に許可されないプロパティ: ${name}`);
        const valid = typeof value === 'string' && (
            (name === 'translate' && TRANSLATE.test(value)) ||
            (name === 'rotate' && NUMBER_DEG.test(value)) ||
            (['width', 'height'].includes(name) && NUMBER_PX.test(value) && Number.parseFloat(value) >= 4) ||
            (['min-width', 'min-height'].includes(name) && value === '0px') ||
            (['max-width', 'max-height'].includes(name) && value === 'none') ||
            (name === 'display' && value === 'inline-block') ||
            (name === 'box-sizing' && value === 'border-box') ||
            (name === 'flex' && value === '0 0 auto')
        );
        if (!valid) throw new Error(`要素の style に許可されない値: ${name}`);
    }
}

export function assertNoElementWriteConflict(patch: object & { element?: unknown }): void {
    if (patch.element && ELEMENT_CONFLICT_KEYS.some(key => key in patch)) {
        throw new Error('要素の移動と別の書き戻しを同時に指定できません');
    }
    if (patch.element) assertPreviewElementStyleAllowed(patch.element);
}

export function isElementSelectionFileReference(path: unknown): boolean {
    return typeof path === 'string' && path.trim().length > 0 && !path.trimStart().startsWith('<');
}
