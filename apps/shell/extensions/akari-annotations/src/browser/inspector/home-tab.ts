import type { AiTabView } from './ai-tiles';

/** A single available action has no useful list to return to. */
export function viewAfterHomeTabClick(options: {
    currentView: AiTabView;
    enabledTileCount: number;
    soleTileView?: AiTabView;
}): AiTabView {
    if (options.currentView === 'tiles') return 'tiles';
    if (options.enabledTileCount === 1 && options.soleTileView) return options.soleTileView;
    return 'tiles';
}
