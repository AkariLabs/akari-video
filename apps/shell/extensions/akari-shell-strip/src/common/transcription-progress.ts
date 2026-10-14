/** The transcript UI marks an active job explicitly; its displayed language is irrelevant. */
export function hasActiveTranscription(root: Pick<Document, 'querySelector'>): boolean {
    return Boolean(root.querySelector('[data-akari-transcribe-progress]'));
}
