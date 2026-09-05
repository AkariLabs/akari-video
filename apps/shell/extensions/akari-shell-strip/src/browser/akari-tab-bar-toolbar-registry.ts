import { inject, injectable } from '@theia/core/shared/inversify';
import { Widget } from '@theia/core/shared/@lumino/widgets';
import { TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { AkariDeveloperModeService } from './akari-developer-mode-service';
import { filterPluginEditorTitleItems } from './tab-bar-toolbar-filter';

@injectable()
export class AkariTabBarToolbarRegistry extends TabBarToolbarRegistry {

    @inject(AkariDeveloperModeService)
    protected readonly developerMode!: AkariDeveloperModeService;

    protected readonly loggedIds = new Set<string>();

    override visibleItems(widget: Widget): ReturnType<TabBarToolbarRegistry['visibleItems']> {
        const { kept, hidden } = filterPluginEditorTitleItems(super.visibleItems(widget), widget);
        if (this.developerMode.isEnabled && hidden.length > 0 && !this.loggedIds.has(widget.id)) {
            this.loggedIds.add(widget.id);
            console.info('[akari-shell-strip] hid plugin toolbar items:',
                JSON.stringify({ widgetId: widget.id, itemIds: hidden.map(item => item.id) }));
        }
        return kept;
    }
}
