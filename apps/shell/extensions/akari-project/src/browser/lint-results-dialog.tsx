import * as React from '@theia/core/shared/react';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { EditLintFinding } from '../common/akari-project-protocol';
import { lintPartnerPrompt, summarizeLintFindings } from '../common/lint-results';
import { AKARI_BORDER, AKARI_FAINT, AKARI_INK, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

const STYLE_ID = 'akari-lint-results-dialog-style';
const PARTNER_COMMAND = 'akari.partner.injectPrompt';
const SEVERITY_LABEL = { error: 'エラー', warning: '注意', info: '情報' } as const;

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
.akari-lint-results-dialog .dialogBlock { width:min(720px, calc(100vw - 48px))!important; max-width:none!important; height:min(560px, calc(100vh - 48px))!important; padding:0!important; border:${AKARI_BORDER.edge}!important; border-radius:${AKARI_RADIUS.card}px!important; background:${AKARI_SURFACE.raised}!important; overflow:hidden; }
.akari-lint-results-dialog .dialogTitle,.akari-lint-results-dialog .dialogControl { display:none!important; }
.akari-lint-results-dialog .dialogContent { height:100%!important; max-height:none!important; padding:0!important; overflow:hidden!important; }
.akari-lint-results-dialog .popup { height:100%; display:flex; flex-direction:column; color:${AKARI_INK}; background:${AKARI_SURFACE.raised}; }
.akari-lint-results-dialog .lint-list { min-height:0; flex:1 1 auto; overflow-y:auto; }
`;
    document.head.appendChild(style);
}

function lastRunLabel(time?: number): string {
    if (time === undefined) return 'まだ実行していません';
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes} 分前`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours} 時間前` : `${Math.floor(hours / 24)} 日前`;
}

export interface LintResultsState {
    findings: readonly EditLintFinding[];
    running: boolean;
    checkedAt?: number;
    rerun: () => Promise<void>;
}

/** フロントエンド起動時に生成し、所有外のパネルから開けるダイアログ。 */
export class LintResultsDialog extends ReactDialog<void> implements FrontendApplicationContribution {
    static instance: LintResultsDialog | undefined;
    protected state: LintResultsState = { findings: [], running: false, rerun: async () => undefined };

    constructor(
        protected readonly commands: CommandService,
        protected readonly messages: MessageService
    ) {
        super({ title: '編集内容のチェック', maxWidth: 720 });
        this.addClass('akari-lint-results-dialog');
        ensureStyle();
        LintResultsDialog.instance = this;
    }

    get value(): void { return undefined; }

    onStart(): void { /* The dialog is instantiated at frontend startup. */ }

    setState(state: LintResultsState): void {
        this.state = state;
        this.update();
    }

    showResults(state: LintResultsState): void {
        this.setState(state);
        if (!this.isAttached) void this.open(false);
    }

    protected async sendToPartner(): Promise<void> {
        try {
            const sent = await this.commands.executeCommand(PARTNER_COMMAND, lintPartnerPrompt(this.state.findings));
            if (sent !== false) this.close();
        } catch (error) {
            this.messages.error(`パートナーに送れませんでした: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected render(): React.ReactNode {
        const { findings, running, checkedAt } = this.state;
        const summary = summarizeLintFindings(findings);
        return (
            <div className='popup' role='dialog' aria-modal='true' aria-labelledby='akari-lint-dialog-title'>
                <div style={{ flex: '0 0 auto', padding: '18px 20px 14px', borderBottom: AKARI_BORDER.hairline }}>
                    <div id='akari-lint-dialog-title' style={{ fontSize: '16px', fontWeight: 700 }}>編集内容のチェック</div>
                    <div style={{ marginTop: '3px', color: AKARI_FAINT, fontSize: '12px' }}>最終実行: {lastRunLabel(checkedAt)}</div>
                </div>
                <div style={{ display: 'flex', flex: '0 0 auto', padding: '14px 20px', gap: '10px', borderBottom: AKARI_BORDER.hairline }}>
                    {(['error', 'warning', 'info'] as const).map(severity => (
                        <div key={severity} style={{ flex: 1, padding: '10px', border: AKARI_BORDER.hairline,
                            borderRadius: `${AKARI_RADIUS.panel}px`, background: AKARI_SURFACE.card,
                            color: summary[severity] === 0 ? AKARI_FAINT : AKARI_INK }}>
                            <div style={{ fontSize: '20px', fontWeight: 700 }}>{summary[severity]}</div>
                            <div style={{ fontSize: '11px' }}>{SEVERITY_LABEL[severity]}</div>
                        </div>
                    ))}
                </div>
                <div className='lint-list' style={{ padding: '10px 20px' }}>
                    {running ? <div style={{ padding: '12px 0' }}>確認しています…</div> : summary.ordered.length === 0 ?
                        <div style={{ padding: '12px 0' }}>指摘はありません。</div> : summary.ordered.map((finding, index) => (
                            <div key={index} title={finding.check} style={{ display: 'flex', gap: '10px', padding: '12px 0',
                                borderBottom: AKARI_BORDER.hairline }}>
                                <span style={{ flex: '0 0 auto', alignSelf: 'flex-start', padding: '2px 6px',
                                    borderRadius: `${AKARI_RADIUS.chip}px`, border: AKARI_BORDER.hairline,
                                    color: finding.severity === 'error' ? 'var(--akari-danger)' :
                                        finding.severity === 'warning' ? 'var(--akari-warning)' : AKARI_FAINT }}>
                                    {SEVERITY_LABEL[finding.severity]}
                                </span>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ overflowWrap: 'anywhere' }}>{finding.message}</div>
                                    {finding.path && <div style={{ marginTop: '4px', fontSize: '11px', color: AKARI_FAINT,
                                        fontFamily: 'var(--theia-code-font-family, monospace)', overflowWrap: 'anywhere' }}>{finding.path}</div>}
                                </div>
                            </div>
                        ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '8px', padding: '14px 20px',
                    flex: '0 0 auto', borderTop: AKARI_BORDER.hairline }}>
                    <button type='button' className='theia-button secondary' disabled={running || findings.length === 0}
                        onClick={() => void this.sendToPartner()}>パートナーに直してもらう</button>
                    <button type='button' className='theia-button secondary' disabled={running}
                        onClick={() => void this.state.rerun()}>もう一度チェック</button>
                    <button type='button' className='theia-button' disabled={running} onClick={() => this.close()}>閉じる</button>
                </div>
            </div>
        );
    }
}
