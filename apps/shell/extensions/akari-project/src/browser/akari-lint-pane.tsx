import * as React from '@theia/core/shared/react';
import { MessageService } from '@theia/core/lib/common';
import { AkariProjectService } from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { AKARI_BORDER } from '../common/akari-surface-tokens';

export interface LintPaneHost {
    readonly workflow: Pick<AkariWorkflowService, 'workspaceRoot'>;
    readonly projectService: Pick<AkariProjectService, 'runEditLint'>;
    readonly messages: Pick<MessageService, 'info' | 'warn' | 'error'>;
    readonly update: () => void;
}

export class AkariLintPane {
    protected lintAvailable = false;
    protected lintCount?: number;
    protected lintRunning = false;

    constructor(protected readonly host: LintPaneHost) {}

    public async refreshLint(notify = false): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
        if (!root) {
            this.lintAvailable = false;
            this.lintCount = undefined;
            this.lintRunning = false;
            this.host.update();
            return;
        }
        if (this.lintRunning) return;
        // 押しても画面が何も変わらない（件数が前回と同じなら尚更）状態を潰す
        // （2026-09-26 オーナー指示「リントを押しても反応がない」）: 実行中は
        // ボタン自身が「確認中…」になり、終わったら結果をトーストで必ず返す。
        this.lintRunning = notify;
        if (notify) this.host.update();
        try {
            const outcome = await this.host.projectService.runEditLint(root.toString());
            this.lintAvailable = outcome.available;
            this.lintCount = outcome.available ? outcome.issueCount : undefined;
            if (notify) {
                if (!outcome.available) this.host.messages.warn('編集内容のチェックはこのプロジェクトでは実行できません。');
                else if (outcome.issueCount) this.host.messages.warn(`編集内容のチェック: ${outcome.issueCount} 件の指摘があります。`);
                else this.host.messages.info('編集内容のチェック: 指摘はありません。');
            }
        } catch (error) {
            if (notify) this.host.messages.error(`編集内容をチェックできませんでした: ${this.errorMessage(error)}`);
        } finally {
            this.lintRunning = false;
            this.host.update();
        }
    }

    public renderLintBadge(): React.ReactNode {
        if (!this.lintAvailable) {
            return undefined;
        }
        const label = this.lintRunning ? '確認中…' : this.lintCount === undefined ? '未実行' : `${this.lintCount} 件`;
        return (
            <div style={{ flex: '0 0 auto', borderTop: AKARI_BORDER.hairline, padding: '6px' }}>
                <button
                    className='theia-button secondary'
                    data-akari-lint-running={this.lintRunning ? 'true' : undefined}
                    disabled={this.lintRunning}
                    title='クリックして再実行'
                    onClick={() => void this.refreshLint(true)}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                    <span>Lint</span>
                    <span>{label}</span>
                </button>
            </div>
        );
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
