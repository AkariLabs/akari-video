import { t } from '../common/project-text';
import * as React from '@theia/core/shared/react';
import { MessageService } from '@theia/core/lib/common';
import { AkariProjectService, EditLintFinding } from '../common/akari-project-protocol';
import { AkariWorkflowService } from './akari-workflow-service';
import { AKARI_BORDER, AKARI_FAINT } from '../common/akari-surface-tokens';
import { LintResultsDialog } from './lint-results-dialog';
import { lintBadgeCounts, lintBadgeLabel } from './lint-badge-counts';

export interface LintPaneHost {
    readonly workflow: Pick<AkariWorkflowService, 'workspaceRoot'>;
    readonly projectService: Pick<AkariProjectService, 'runEditLint'>;
    readonly messages: Pick<MessageService, 'info' | 'warn' | 'error'>;
    readonly update: () => void;
}

export class AkariLintPane {
    protected lintAvailable = false;
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
            this.lintFindings = outcome.available ? outcome.findings ?? [] : [];
            this.lintCheckedAt = outcome.available ? Date.now() : undefined;
            if (notify) {
                if (!outcome.available) this.host.messages.warn(t('project.editCheck.pane.editCheckIsUnavailableProjectMessage'));
                else {
                    const { issues } = lintBadgeCounts(this.lintFindings);
                    if (issues) this.host.messages.warn(t('project.editCheck.pane.editCheckIssueCountIssuesFoundMessage', { issueCount: issues, n: issues }));
                }
            }
        } catch (error) {
            if (notify) this.host.messages.error(t('project.editCheck.pane.couldNotCheckEditError', { value1: this.errorMessage(error) }));
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
        const label = lintBadgeLabel(this.lintRunning, this.lintChecked ? this.lintFindings : undefined);
        const hasErrors = this.lintFindings.some(finding => finding.severity === 'error');
        return (
            <div style={{ flex: '0 0 auto', minHeight: '28px', borderTop: AKARI_BORDER.hairline }}>
                <button
                    className='theia-button quiet'
                    data-akari-lint-running={this.lintRunning ? 'true' : undefined}
                    title={t('project.editCheck.pane.openEditCheckResultsAction')}
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
