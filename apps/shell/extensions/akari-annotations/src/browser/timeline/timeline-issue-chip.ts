import type { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar';
import type { UiLintFinding } from '../../common/lint-message-ja';
import { timelineIssueCopyText, timelineIssueHeading, timelineIssueLabel, timelineIssueRows } from '../../common/timeline-issue-chip';

export const TIMELINE_ISSUE_ID = 'akari-timeline-issue';

export class TimelineIssueChip {
    private findings: readonly UiLintFinding[] = [];
    private savedVersion: string | undefined;
    private popup: HTMLElement | undefined;
    private backdrop: HTMLElement | undefined;

    constructor(private readonly bar: Pick<StatusBar, 'setElement' | 'removeElement'>,
        private readonly doc: Document, private readonly openReport: () => void) {}

    setFindings(findings: readonly UiLintFinding[], savedVersion?: string): void {
        this.findings = [...findings];
        this.savedVersion = savedVersion;
        this.close();
        if (!findings.length) {
            void this.bar.removeElement(TIMELINE_ISSUE_ID);
            return;
        }
        void this.bar.setElement(TIMELINE_ISSUE_ID, {
            text: timelineIssueLabel(findings.length),
            alignment: 0 as StatusBarAlignment,
            priority: -999,
            name: 'タイムラインの課題',
            className: 'akari-timeline-issue-status',
            color: 'var(--theia-editorWarning-foreground)',
            onclick: event => {
                const anchor = (event.target as Element).closest<HTMLElement>('#status-bar-akari-timeline-issue');
                if (anchor) this.toggle(anchor);
            }
        });
    }

    private toggle(anchor: HTMLElement): void {
        if (this.popup) { this.close(); return; }
        const popup = this.doc.createElement('div');
        popup.className = 'akari-timeline-issue-popup';
        popup.dataset.testid = 'akari-timeline-issue-popup';
        popup.setAttribute('role', 'dialog');
        const heading = this.doc.createElement('div');
        heading.className = 'akari-timeline-issue-heading';
        heading.textContent = timelineIssueHeading(this.findings.length, this.savedVersion);
        popup.appendChild(heading);
        const list = this.doc.createElement('div');
        list.className = 'akari-timeline-issue-list';
        const { rows, remaining } = timelineIssueRows(this.findings);
        for (const row of rows) {
            const item = this.doc.createElement('div');
            item.className = 'akari-timeline-issue-row';
            item.textContent = row;
            item.title = row;
            list.appendChild(item);
        }
        if (remaining) {
            const more = this.doc.createElement('div');
            more.textContent = `ほか ${remaining} 件`;
            list.appendChild(more);
        }
        popup.appendChild(list);
        const actions = this.doc.createElement('div');
        actions.className = 'akari-timeline-issue-actions';
        const copy = this.doc.createElement('button');
        copy.type = 'button';
        copy.textContent = 'コピー';
        copy.dataset.testid = 'akari-timeline-issue-copy';
        copy.onclick = () => void this.copy(popup);
        const report = this.doc.createElement('button');
        report.type = 'button';
        report.textContent = 'Lint レポートを開く';
        report.dataset.testid = 'akari-timeline-issue-open-report';
        report.onclick = () => { this.openReport(); this.close(); };
        actions.append(copy, report);
        popup.appendChild(actions);
        const backdrop = this.doc.createElement('div');
        backdrop.className = 'akari-timeline-issue-backdrop';
        backdrop.dataset.testid = 'akari-timeline-issue-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.onpointerdown = () => this.close();
        this.doc.body.append(backdrop, popup);
        const rect = anchor.getBoundingClientRect();
        popup.style.left = `${Math.max(8, Math.min(rect.left, this.doc.defaultView!.innerWidth - popup.offsetWidth - 8))}px`;
        popup.style.bottom = `${this.doc.defaultView!.innerHeight - rect.top + 6}px`;
        this.backdrop = backdrop;
        this.popup = popup;
        this.doc.addEventListener('keydown', this.onKeyDown, true);
        this.doc.addEventListener('pointerdown', this.onOutside, true);
        this.doc.defaultView?.addEventListener('blur', this.onBlur);
    }

    private async copy(popup: HTMLElement): Promise<void> {
        const content = timelineIssueCopyText(this.findings);
        try {
            await this.doc.defaultView!.navigator.clipboard.writeText(content);
        } catch {
            const fallback = this.doc.createElement('textarea');
            fallback.className = 'akari-timeline-issue-fallback';
            fallback.value = content;
            fallback.readOnly = true;
            fallback.setAttribute('aria-label', 'コピーする課題の全文');
            popup.appendChild(fallback);
            fallback.select();
        }
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    };
    private readonly onOutside = (event: PointerEvent): void => {
        if (!this.popup?.contains(event.target as Node)
            && !(event.target as Element).closest?.('#status-bar-akari-timeline-issue')) this.close();
    };
    private readonly onBlur = (): void => this.close();

    private close(): void {
        this.popup?.remove();
        this.popup = undefined;
        this.backdrop?.remove();
        this.backdrop = undefined;
        this.doc.removeEventListener('keydown', this.onKeyDown, true);
        this.doc.removeEventListener('pointerdown', this.onOutside, true);
        this.doc.defaultView?.removeEventListener('blur', this.onBlur);
    }

    dispose(): void {
        this.close();
        void this.bar.removeElement(TIMELINE_ISSUE_ID);
    }
}
