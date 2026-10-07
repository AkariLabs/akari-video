import * as React from '@theia/core/shared/react';
import { MessageService } from '@theia/core/lib/common';
import { AkariProjectService, EditLintFinding } from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { AKARI_BORDER, AKARI_FAINT } from '../common/akari-surface-tokens';
import { lintStatusLabel } from '../common/lint-results';
import { LintResultsDialog } from './lint-results-dialog';

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
    protected lintChecked = false;
    protected lintFindings: EditLintFinding[] = [];
    protected lintCheckedAt?: number;
    protected lintInFlight?: Promise<void>;

    constructor(protected readonly host: LintPaneHost) {}

    public refreshLint(notify = false): Promise<void> {
        const root = this.host.workflow.workspaceRoot;
        if (!root) {
            this.lintAvailable = false;
            this.lintCount = undefined;
            this.lintRunning = false;
            this.lintChecked = false;
            this.lintFindings = [];
            this.lintCheckedAt = undefined;
            this.host.update();
            return Promise.resolve();
        }
        if (this.lintInFlight) return this.lintInFlight;
        this.lintInFlight = this.runLint(root.toString(), notify).finally(() => {
            this.lintInFlight = undefined;
        });
        return this.lintInFlight;
    }

    protected async runLint(root: string, notify: boolean): Promise<void> {
        this.lintRunning = true;
        this.publish();
        try {
            const outcome = await this.host.projectService.runEditLint(root);
            this.lintChecked = true;
            this.lintAvailable = outcome.available;
            this.lintCount = outcome.available ? outcome.issueCount : undefined;
            this.lintFindings = outcome.available ? outcome.findings ?? [] : [];
            this.lintCheckedAt = outcome.available ? Date.now() : undefined;
            if (notify) {
                if (!outcome.available) this.host.messages.warn('編集内容のチェックはこのプロジェクトでは実行できません。');
                else if (outcome.issueCount) this.host.messages.warn(`編集内容のチェック: ${outcome.issueCount} 件の指摘があります。`);
            }
        } catch (error) {
            if (notify) this.host.messages.error(`編集内容をチェックできませんでした: ${this.errorMessage(error)}`);
        } finally {
            this.lintRunning = false;
            this.publish();
        }
    }

    protected publish(): void {
        this.host.update();
        LintResultsDialog.instance?.setState({
            findings: this.lintFindings,
            running: this.lintRunning,
            checkedAt: this.lintCheckedAt,
            rerun: () => this.refreshLint(true)
        });
    }

    protected async openResults(): Promise<void> {
        if (!this.lintCheckedAt) await this.refreshLint(true);
        if (!this.lintAvailable) return;
        LintResultsDialog.instance?.showResults({
            findings: this.lintFindings,
            running: this.lintRunning,
            checkedAt: this.lintCheckedAt,
            rerun: () => this.refreshLint(true)
        });
    }

    public renderLintBadge(): React.ReactNode {
        if (!this.host.workflow.workspaceRoot || (this.lintChecked && !this.lintAvailable)) {
            return undefined;
        }
        const label = lintStatusLabel(this.lintRunning, this.lintCount);
        const hasErrors = this.lintFindings.some(finding => finding.severity === 'error');
        return (
            <div style={{ flex: '0 0 auto', minHeight: '28px', borderTop: AKARI_BORDER.hairline }}>
                <button
                    className='theia-button quiet'
                    data-akari-lint-running={this.lintRunning ? 'true' : undefined}
                    title='編集内容のチェック結果を開く'
                    onClick={() => void this.openResults()}
                    style={{ width: '100%', height: '28px', minHeight: '28px', display: 'flex',
                        justifyContent: 'space-between', alignItems: 'center', padding: '0 10px',
                        color: hasErrors ? 'var(--akari-danger)' : 'inherit' }}
                >
                    <span>{label}</span>
                    <span aria-hidden='true' style={{ color: AKARI_FAINT }}>›</span>
                </button>
            </div>
        );
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
