import { t } from '../common/project-text';
import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common';
import { OpenerService, open } from '@theia/core/lib/browser';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { DiffUris } from '@theia/core/lib/browser/diff-uris';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ActionHistoryEntry, AkariProjectService } from '../common/akari-project-protocol';

@injectable()
export class ActionHistoryWidget extends ReactWidget {
    static readonly ID = 'akari-action-history';
    @inject(AkariProjectService) protected readonly service!: AkariProjectService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(OpenerService) protected readonly openers!: OpenerService;
    @inject(MessageService) protected readonly messages!: MessageService;
    private root?: string;
    private capable = false;
    private entries: ActionHistoryEntry[] = [];
    private busy = false;

    @postConstruct()
    protected init(): void {
        this.id = ActionHistoryWidget.ID;
        this.title.label = t('project.automation.history.title');
        this.title.closable = true;
        this.addClass('akari-action-history');
        this.update();
    }

    async refresh(): Promise<void> {
        this.root = (await this.workspace.roots)[0]?.resource.toString();
        try {
            const result = this.root ? await this.service.actionHistory(this.root) : { capable: false, entries: [] };
            this.capable = result.capable;
            this.entries = result.entries;
        } catch (error) {
            this.capable = false;
            this.entries = [];
            this.messages.error(String(error));
        }
        this.update();
    }

    private async showChanges(sha: string): Promise<void> {
        if (!this.root) return;
        try {
            const { pairs } = await this.service.prepareHistoryDiffs(this.root, sha);
            if (!pairs.length) this.messages.info(t('project.automation.history.noTextChanges'));
            for (const pair of pairs) {
                await open(this.openers, DiffUris.encode(new URI(pair.leftUri), new URI(pair.rightUri)), { mode: 'activate' });
            }
        } catch (error) { this.messages.error(String(error)); }
    }

    private async restore(entry: ActionHistoryEntry): Promise<void> {
        if (!this.root || this.busy) return;
        const confirmed = await new ConfirmDialog({
            title: t('project.automation.history.restoreTitle'),
            msg: t('project.automation.history.restoreQuestion', { summary: entry.summary })
        }).open();
        if (!confirmed) return;
        this.busy = true;
        this.update();
        try {
            await this.service.restoreBeforeAction(this.root, entry.sha);
            await this.refresh();
        } catch (error) { this.messages.error(String(error)); }
        finally { this.busy = false; this.update(); }
    }

    protected render(): React.ReactNode {
        const css = `.akari-action-history{overflow:auto;background:var(--theia-editor-background);color:var(--theia-foreground)}
            .akari-action-history main{max-width:850px;margin:auto;padding:28px 32px}
            .akari-action-history h2{font-size:20px;margin:0 0 20px}
            .akari-action-history ol{list-style:none;padding:0;margin:0}
            .akari-action-history li{border-bottom:1px solid var(--theia-widget-border);padding:13px 0}
            .akari-action-history .meta{display:flex;gap:12px;color:var(--theia-descriptionForeground);font-size:12px}
            .akari-action-history .summary{font-size:14px;margin:5px 0 9px}
            .akari-action-history .actions{display:flex;gap:8px}`;
        return <><style>{css}</style><main data-akari-action-history='true'>
            <h2>{t('project.automation.history.title')}</h2>
            {!this.capable ? <p>{t('project.automation.history.noGit')}</p>
                : !this.entries.length ? <p>{t('project.automation.history.empty')}</p>
                    : <ol>{this.entries.map(entry => <li key={entry.sha} data-akari-history-sha={entry.sha}>
                        <div className='meta'><time>{new Date(entry.occurredAt).toLocaleString()}</time>
                            <span>{t(`project.automation.actor.${entry.actor}`)}</span>
                            <span>{t('project.automation.history.fileCount', { n: entry.fileCount })}</span></div>
                        <div className='summary'>{entry.summary}</div>
                        <div className='actions'><button className='theia-button secondary' onClick={() => void this.showChanges(entry.sha)}>
                            {t('project.automation.history.viewChanges')}</button>
                            <button className='theia-button secondary' disabled={this.busy} onClick={() => void this.restore(entry)}>
                                {t('project.automation.history.restoreBefore')}</button></div>
                    </li>)}</ol>}
        </main></>;
    }
}
