import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

const INTAKE_RELATIVE_PATH = '.akari/intake.json';

/**
 * ホーム v2（task.md 2026-07-21-home-flow）の「04 作業中」に到達したかどうかの
 * 判定源。左パネル（素材/メニュー）は 04 まで隠す（task.md 目的・指示5）。
 *
 * 判定基準は `.akari/intake.json` の `status === 'submitted'` の 1 点のみ
 * （akari-surfaces のホーム本体が使っているのと同じフィールドを、ここでも
 * 「読むだけ」再利用する — 二重の判定ロジックを作らない）。ホーム本体の
 * 画面遷移（接続ゲート/はじめかた/フォーム）そのものには関与しない。
 * 拡張間の型 import を避けるため（build:ext の並び順の都合、
 * akari-partner-command-contribution.ts のコメント参照）、ここでは
 * FileService/WorkspaceService という既存の共通 API だけで完結させる。
 */
@injectable()
export class AkariHomeFlowGate {

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    protected unlocked = false;
    protected readonly onDidChangeEmitter = new Emitter<boolean>();
    readonly onDidChange: Event<boolean> = this.onDidChangeEmitter.event;
    protected toDispose = new DisposableCollection();

    get isUnlocked(): boolean {
        return this.unlocked;
    }

    @postConstruct()
    protected init(): void {
        this.workspaceService.onWorkspaceChanged(() => void this.watch());
        void this.workspaceService.ready.then(() => this.watch());
    }

    protected async watch(): Promise<void> {
        this.toDispose.dispose();
        this.toDispose = new DisposableCollection();
        const roots = await this.workspaceService.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.setUnlocked(false);
            return;
        }
        const intakeUri = root.resolve(INTAKE_RELATIVE_PATH);
        await this.refresh(intakeUri);
        try {
            this.toDispose.push(await this.fileService.watch(intakeUri.parent));
        } catch (error) {
            console.info('[akari-shell-strip] intake.json watch unavailable:', error);
        }
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (event.contains(intakeUri)) {
                void this.refresh(intakeUri);
            }
        }));
    }

    protected async refresh(intakeUri: URI): Promise<void> {
        try {
            const content = await this.fileService.readFile(intakeUri);
            const parsed = JSON.parse(content.value.toString());
            this.setUnlocked(parsed?.status === 'submitted');
        } catch {
            this.setUnlocked(false);
        }
    }

    protected setUnlocked(next: boolean): void {
        if (next === this.unlocked) {
            return;
        }
        this.unlocked = next;
        console.info('[akari-shell-strip] home-flow gate changed:', next);
        this.onDidChangeEmitter.fire(next);
    }
}
