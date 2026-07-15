import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';

interface WorkflowStage {
    id: string;
    label: string;
    status: string;
    nextAction: string;
}

@injectable()
export class AkariHomeWidget extends ReactWidget {
    static readonly ID = 'akari-home-widget';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected stages: WorkflowStage[] = [];
    protected guide = 'プロジェクトを開くと、ここに進み具合と次の一手が表示されます。';
    protected workflowUri: URI | undefined;
    protected watching = false;

    @postConstruct()
    protected init(): void {
        this.id = AkariHomeWidget.ID;
        this.title.label = '俯瞰';
        this.title.caption = 'AKARI プロジェクト俯瞰';
        this.title.iconClass = 'codicon codicon-dashboard';
        this.title.closable = false;
        this.update();
    }

    async start(): Promise<void> {
        await this.loadWorkflow();
        if (this.watching) {
            return;
        }
        this.watching = true;
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (this.workflowUri && event.contains(this.workflowUri)) {
                void this.loadWorkflow();
            }
        }));
        if (this.workflowUri) {
            try {
                this.toDispose.push(await this.fileService.watch(this.workflowUri.parent));
            } catch {
                try {
                    // `.akari` がまだ無い空プロジェクトではルートを監視し、
                    // workflow.json が後から作られた時にも追従する。
                    this.toDispose.push(await this.fileService.watch(this.workflowUri.parent.parent));
                } catch (error) {
                    console.info('[akari-surfaces] workflow watch unavailable:', error);
                }
            }
        }
    }

    protected async loadWorkflow(): Promise<void> {
        const roots = await this.workspaceService.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.stages = [];
            this.guide = 'プロジェクトを開くと、ここに進み具合と次の一手が表示されます。';
            this.update();
            return;
        }
        this.workflowUri = root.resolve('.akari/workflow.json');
        try {
            const content = await this.fileService.readFile(this.workflowUri);
            const parsed = JSON.parse(content.value.toString());
            this.stages = this.normalizeStages(parsed);
            this.guide = this.stages.length === 0
                ? 'workflow.json にステージを追加すると、プロジェクト全体をここで俯瞰できます。'
                : '';
        } catch (error) {
            this.stages = [];
            this.guide = '進行データをまだ読めません。.akari/workflow.json を作成または修復すると自動で更新されます。';
            console.info('[akari-surfaces] workflow empty or invalid:', error);
        }
        this.update();
    }

    protected normalizeStages(workflow: any): WorkflowStage[] {
        const source = workflow?.stages ?? workflow?.steps ?? workflow?.workflow ?? [];
        const entries: Array<[string, any]> = Array.isArray(source)
            ? source.map((value: any, index: number) => [String(value?.id ?? index + 1), value])
            : source && typeof source === 'object'
                ? Object.entries(source)
                : [];
        return entries.map(([id, value]) => {
            const item = value && typeof value === 'object' ? value : { status: value };
            return {
                id,
                label: String(item.label ?? item.name ?? item.title ?? id),
                status: String(item.status ?? item.state ?? '未着手'),
                nextAction: String(item.nextAction ?? item.next_action ?? item.action ?? item.next ?? '次の一手を確認')
            };
        });
    }

    protected statusColor(status: string): string {
        if (/完了|done|complete/i.test(status)) {
            return 'var(--theia-charts-green)';
        }
        if (/進行|作業|active|doing|progress/i.test(status)) {
            return 'var(--theia-charts-blue)';
        }
        if (/停止|blocked|error|失敗/i.test(status)) {
            return 'var(--theia-charts-red)';
        }
        return 'var(--theia-descriptionForeground)';
    }

    protected override render(): React.ReactNode {
        return (
            <div className='akari-home-surface' style={{ height: '100%', overflow: 'auto', padding: '24px 26px', boxSizing: 'border-box' }}>
                <header style={{ marginBottom: 22 }}>
                    <div style={{ fontSize: 12, letterSpacing: '0.12em', opacity: 0.65 }}>AKARI VIDEO</div>
                    <h1 style={{ margin: '6px 0 4px', fontSize: 26 }}>プロジェクト俯瞰</h1>
                    <p style={{ margin: 0, opacity: 0.7 }}>いまどこにいて、次に何をするかを一望できます。</p>
                </header>
                {this.stages.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(this.stages.length, 4)}, minmax(190px, 1fr))`, gap: 12 }}>
                        {this.stages.map((stage, index) => (
                            <section key={stage.id} style={{
                                border: '1px solid var(--theia-widget-border)', borderRadius: 10,
                                padding: 16, background: 'var(--theia-sideBar-background)', minHeight: 150
                            }}>
                                <div style={{ opacity: 0.55, fontSize: 12 }}>STAGE {index + 1}</div>
                                <h2 style={{ margin: '8px 0 12px', fontSize: 18 }}>{stage.label}</h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 16 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: this.statusColor(stage.status) }} />
                                    <span>{stage.status}</span>
                                </div>
                                <div style={{ borderTop: '1px solid var(--theia-widget-border)', paddingTop: 11 }}>
                                    <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 4 }}>次の一手</div>
                                    <strong>{stage.nextAction}</strong>
                                </div>
                            </section>
                        ))}
                    </div>
                ) : (
                    <div role='status' style={{ maxWidth: 620, padding: 24, border: '1px dashed var(--theia-widget-border)', borderRadius: 10 }}>
                        <h2 style={{ marginTop: 0 }}>まだ進行データがありません</h2>
                        <p style={{ marginBottom: 0, opacity: 0.75 }}>{this.guide}</p>
                    </div>
                )}
            </div>
        );
    }
}
