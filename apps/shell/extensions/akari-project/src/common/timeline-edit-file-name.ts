export function isTimelineEditFileName(name: string): boolean {
    return name === 'edit.json' || /^edit\.([a-z0-9]+(?:-[a-z0-9]+)*)\.json$/.test(name);
}
