/** Mark regenerated status entries for inspection. */
export function installTimelineStatusSeat(doc: Document): () => void {
    const mark = (): void => {
        const issue = doc.getElementById('status-bar-akari-timeline-issue');
        const message = doc.getElementById('status-bar-akari-timeline-message');
        if (issue) issue.dataset.testid = 'akari-timeline-issue-chip';
        if (message) {
            message.dataset.testid = 'akari-timeline-message';
            message.title = message.textContent ?? '';
        }
    };
    const observer = new MutationObserver(mark);
    const awaitBar = new MutationObserver(() => attach());
    const attach = (): void => {
        const bar = doc.getElementById('theia-statusBar');
        if (!bar) return;
        awaitBar.disconnect();
        observer.observe(bar, { childList: true, characterData: true, subtree: true });
        mark();
    };
    attach();
    if (!doc.getElementById('theia-statusBar')) awaitBar.observe(doc.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); awaitBar.disconnect(); };
}
