export interface DeliveryTarget {
    form: 'cli' | 'extension' | 'none';
    agent?: string;
    focusCommandId?: string;
}

export interface ExtensionDeliveryEntry {
    form: string;
    agent: string;
    viewContainerIds?: readonly string[];
}

const focusCommands: Record<string, string> = {
    claude: 'claude-vscode.focus',
    codex: 'chatgpt.openSidebar'
};

export function resolveDeliveryTarget(input: {
    cliAgent?: string;
    visibleWidgetIds: readonly string[];
    catalog: readonly ExtensionDeliveryEntry[];
}): DeliveryTarget {
    if (input.cliAgent) return { form: 'cli', agent: input.cliAgent };
    const visible = new Set(input.visibleWidgetIds);
    for (const entry of input.catalog) {
        if (entry.form !== 'extension' || !focusCommands[entry.agent]) continue;
        if (entry.viewContainerIds?.some(id => visible.has(`plugin-view-container:${id}`))) {
            return { form: 'extension', agent: entry.agent, focusCommandId: focusCommands[entry.agent] };
        }
    }
    return { form: 'none' };
}
