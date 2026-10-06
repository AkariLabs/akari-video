export const EDITOR_STATUS_ITEM_IDS = [
    'editor-status-cursor-position',
    'editor-status-encoding',
    'editor-status-eol',
    'editor-status-tabbing-config',
    'editor-status-language',
    'editor-language-status-items',
    'editor-formatter-status'
] as const;

const editorStatusItemIds = new Set<string>(EDITOR_STATUS_ITEM_IDS);

export function isEditorStatusItem(id: string): boolean {
    return editorStatusItemIds.has(id);
}
