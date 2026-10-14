export interface DaihonWordPress {
    time: number;
    x: number;
    y: number;
    row: string;
    index: number;
}

export interface DaihonPointerPress {
    time: number;
    x: number;
    y: number;
    button: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
}

export function matchWordDoublePress(previous: DaihonWordPress, current: DaihonPointerPress): boolean {
    return current.button === 0 && !current.altKey && !current.ctrlKey && !current.metaKey && !current.shiftKey
        && current.time >= previous.time && current.time - previous.time <= 500
        && Math.hypot(current.x - previous.x, current.y - previous.y) <= 6;
}
