export function daihonCaptionEditKey(key: string, isComposing: boolean, keyCode: number): 'commit' | 'cancel' | 'none' {
    if (isComposing || keyCode === 229) return 'none';
    if (key === 'Enter') return 'commit';
    if (key === 'Escape') return 'cancel';
    return 'none';
}
