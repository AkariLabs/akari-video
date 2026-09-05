const PLUGIN_EDITOR_TITLE_MENU = 'plugin_editor/title';
const PLUGIN_EDITOR_TITLE_RUN_MENU = 'plugin_editor/title/run';
const AKARI_PREVIEW_VIEW_TYPE = 'akari.preview';
const AKARI_PREVIEW_PREFIX = 'akari-preview-';
const AKARI_OUTPUT_PREVIEW_PREFIX = 'akari-output-preview-';
const WEBVIEW_PREFIX = 'plugin-webview:';

type PreviewWidget = { id?: string; viewType?: string; identifier?: { id?: string } } | undefined | null;

function isPreviewIdentifier(id: unknown): boolean {
    return typeof id === 'string'
        && (id.startsWith(AKARI_PREVIEW_PREFIX) || id.startsWith(AKARI_OUTPUT_PREVIEW_PREFIX));
}

export function isAkariPreviewWebview(widget: PreviewWidget): boolean {
    return !!widget && (widget.viewType === AKARI_PREVIEW_VIEW_TYPE
        || isPreviewIdentifier(widget.identifier?.id)
        || (typeof widget.id === 'string' && widget.id.startsWith(WEBVIEW_PREFIX)
            && isPreviewIdentifier(widget.id.slice(WEBVIEW_PREFIX.length))));
}

function isPluginEditorTitleItem(item: unknown): boolean {
    if (!item || typeof item !== 'object') {
        return false;
    }
    const candidate = item as {
        id?: unknown;
        menuPath?: unknown;
        effectiveMenuPath?: unknown;
        toolbarItem?: { menuPath?: unknown };
    };
    // Menu delegates expose effectiveMenuPath; registered actions wrap toolbarItem.
    const menuPath = candidate.menuPath ?? candidate.effectiveMenuPath ?? candidate.toolbarItem?.menuPath;
    return (Array.isArray(menuPath)
        && (menuPath[0] === PLUGIN_EDITOR_TITLE_MENU || menuPath[0] === PLUGIN_EDITOR_TITLE_RUN_MENU))
        || candidate.id === PLUGIN_EDITOR_TITLE_MENU || candidate.id === PLUGIN_EDITOR_TITLE_RUN_MENU;
}

export function filterPluginEditorTitleItems<T>(items: readonly T[], widget: PreviewWidget): { kept: T[]; hidden: T[] } {
    const kept: T[] = [];
    const hidden: T[] = [];
    const preview = isAkariPreviewWebview(widget);
    for (const item of items) {
        (preview && isPluginEditorTitleItem(item) ? hidden : kept).push(item);
    }
    return { kept, hidden };
}
