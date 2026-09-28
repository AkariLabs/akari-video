/** Keep this filename rule in sync with akari-annotations/common/timeline-files.ts. */
export function isEditDataFileName(name: string): boolean {
    return name === 'edit.json' || /^edit\.([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.test(name);
}
