import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileNavigatorFilter } from '@theia/navigator/lib/browser/navigator-filter';
import { AkariProjectModeService } from './akari-project-mode-service';
import { AkariWorkflowService } from './akari-workflow-service';
import { shouldShowProjectPath } from '../common/project-tree-policy';

@injectable()
export class AkariFileNavigatorFilter extends FileNavigatorFilter {
    @inject(AkariProjectModeService)
    protected readonly mode!: AkariProjectModeService;
    @inject(AkariWorkflowService)
    protected readonly workflow!: AkariWorkflowService;

    protected override async doInit(): Promise<void> {
        await super.doInit();
        this.mode.onDidChange(() => this.fireFilterChanged());
        this.workflow.onDidChange(() => this.fireFilterChanged());
    }

    protected override filterItem(item: { id: string }): boolean {
        if (!super.filterItem(item)) {
            return false;
        }
        if (this.mode.developerMode) {
            return true;
        }
        let uri: URI;
        try {
            uri = new URI(item.id);
        } catch {
            return true;
        }
        const relative = this.workflow.relativePath(uri);
        if (!relative) {
            return true;
        }
        return shouldShowProjectPath(relative, this.workflow.current.tree, false);
    }
}
