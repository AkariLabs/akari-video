import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

export interface AkariRoleDeclaration {
    path: string;
    label: string;
    kind: 'assets' | 'planning' | 'exports' | string;
}

export interface AkariWorkflow {
    version: number;
    roles: AkariRoleDeclaration[];
    tree: {
        hidden: string[];
        sidecarSuffixes: string[];
        developerModePreference: string;
    };
}

const DEFAULT_WORKFLOW: AkariWorkflow = {
    version: 1,
    roles: [
        { path: 'assets', label: '素材', kind: 'assets' },
        { path: 'planning', label: '企画', kind: 'planning' },
        { path: 'exports', label: '書き出し', kind: 'exports' }
    ],
    tree: {
        hidden: ['.claude', '.agents', '.codex', '.akari', 'CLAUDE.md', 'AGENTS.md', '.gitignore', '.gitkeep'],
        sidecarSuffixes: ['.meta.json', '.decisions.json', '.analysis.json'],
        developerModePreference: 'akari.developerMode'
    }
};

@injectable()
export class AkariWorkflowService {
    protected readonly changeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.changeEmitter.event;

    @inject(FileService)
    protected readonly files!: FileService;
    @inject(WorkspaceService)
    protected readonly workspace!: WorkspaceService;

    protected workflow: AkariWorkflow = DEFAULT_WORKFLOW;
    protected root?: URI;

    async load(): Promise<void> {
        const roots = await this.workspace.roots;
        this.root = roots[0]?.resource;
        if (!this.root) {
            this.workflow = DEFAULT_WORKFLOW;
            this.changeEmitter.fire(undefined);
            return;
        }
        try {
            const content = await this.files.readFile(this.root.resolve('.akari/workflow.json'));
            const parsed = JSON.parse(content.value.toString()) as Partial<AkariWorkflow>;
            this.workflow = {
                version: typeof parsed.version === 'number' ? parsed.version : 1,
                roles: Array.isArray(parsed.roles) ? parsed.roles : DEFAULT_WORKFLOW.roles,
                tree: {
                    hidden: parsed.tree?.hidden ?? DEFAULT_WORKFLOW.tree.hidden,
                    sidecarSuffixes: parsed.tree?.sidecarSuffixes ?? DEFAULT_WORKFLOW.tree.sidecarSuffixes,
                    developerModePreference: parsed.tree?.developerModePreference ?? 'akari.developerMode'
                }
            };
        } catch {
            this.workflow = DEFAULT_WORKFLOW;
        }
        this.changeEmitter.fire(undefined);
    }

    get current(): AkariWorkflow {
        return this.workflow;
    }

    get workspaceRoot(): URI | undefined {
        return this.root;
    }

    relativePath(uri: URI): string | undefined {
        if (!this.root) {
            return undefined;
        }
        const rootPath = this.root.path.toString().replace(/\/$/, '');
        const value = uri.path.toString();
        if (value !== rootPath && !value.startsWith(`${rootPath}/`)) {
            return undefined;
        }
        return value.slice(rootPath.length).replace(/^\//, '');
    }
}
