export function captionsButtonLabel(states: readonly ('none' | 'running' | 'done')[]): string {
    return states.some(state => state === 'done') ? '字幕を作る' : '文字起こしして字幕を作る';
}
