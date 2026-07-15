import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { Emitter } from '@theia/core/lib/common/event';
import { LabelProviderContribution } from '@theia/core/lib/browser/label-provider';
import { AkariProjectModeService } from './akari-project-mode-service';
import { AkariWorkflowService } from './akari-workflow-service';
import { localizedRoleLabel } from '../common/project-tree-policy';

@injectable()
export class AkariRoleLabelProvider implements LabelProviderContribution {
    protected readonly changeEmitter = new Emitter<any>();
    readonly onDidChange = this.changeEmitter.event;

    @inject(AkariProjectModeService)
    protected readonly mode!: AkariProjectModeService;
    @inject(AkariWorkflowService)
    protected readonly workflow!: AkariWorkflowService;

    @postConstruct()
    protected init(): void {
        this.mode.onDidChange(() => this.changeEmitter.fire({ affects: () => true }));
        this.workflow.onDidChange(() => this.changeEmitter.fire({ affects: () => true }));
    }

    canHandle(element: object): number {
        return !this.mode.developerMode && this.roleFor(element) ? 1000 : 0;
    }

    getName(element: object): string | undefined {
        const role = this.roleFor(element);
        return role?.label;
    }

    protected roleFor(element: object): { path: string; label: string } | undefined {
        const uri = element instanceof URI ? element : undefined;
        if (!uri) {
            return undefined;
        }
        const relative = this.workflow.relativePath(uri);
        const label = localizedRoleLabel(relative, this.workflow.current.roles, this.mode.developerMode);
        return label && relative ? { path: relative, label } : undefined;
    }
}
