export function transitionAskKey(key: string): 'cancel' | 'cycle' | 'press' | 'block' {
    if (key === 'Escape') return 'cancel';
    if (key === 'Tab') return 'cycle';
    if (key === 'Enter' || key === ' ') return 'press';
    return 'block';
}
