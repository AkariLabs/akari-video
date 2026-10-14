import * as React from '@theia/core/shared/react';

export type ChatIconName =
    | 'brain' | 'file' | 'pencil' | 'terminal' | 'sparkle' | 'globe'
    | 'search' | 'dot' | 'mic' | 'clip' | 'send' | 'stop'
    | 'plus' | 'history' | 'check' | 'chat' | 'down';

const paths: Record<ChatIconName, React.ReactNode> = {
    brain: <>
        <path d='M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V4a3 3 0 0 0-3 0z' />
        <path d='M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0' />
    </>,
    file: <>
        <path d='M6 3h8l4 4v14H6z' />
        <path d='M14 3v4h4' />
    </>,
    pencil: <path d='M4 20h4L19 9l-4-4L4 16z' />,
    terminal: <>
        <path d='M4 6l5 5-5 5' />
        <path d='M11 18h9' />
    </>,
    sparkle: <>
        <path d='M12 3v4M12 17v4M3 12h4M17 12h4' />
        <path d='M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6' />
    </>,
    globe: <>
        <circle cx='12' cy='12' r='9' />
        <path d='M3 12h18M12 3a15 15 0 0 0 0 18M12 3a15 15 0 0 1 0 18' />
    </>,
    search: <>
        <circle cx='11' cy='11' r='6' />
        <path d='M20 20l-4-4' />
    </>,
    dot: <circle cx='12' cy='12' r='2' fill='currentColor' stroke='none' />,
    mic: <>
        <rect x='9' y='3' width='6' height='12' rx='3' />
        <path d='M5 11a7 7 0 0 0 14 0M12 18v3' />
    </>,
    clip: <path d='M20 11.5l-8.4 8.4a5 5 0 0 1-7.1-7.1l8.8-8.8a3.3 3.3 0 0 1 4.7 4.7l-8.8 8.8a1.7 1.7 0 0 1-2.4-2.4l8.1-8.1' />,
    send: <path d='M12 19V5M6 11l6-6 6 6' />,
    stop: <rect x='5' y='5' width='14' height='14' rx='2' fill='currentColor' stroke='none' />,
    plus: <path d='M12 5v14M5 12h14' />,
    history: <>
        <path d='M8 6h12M8 12h12M8 18h12' />
        <path d='M4 6h.01M4 12h.01M4 18h.01' />
    </>,
    check: <path d='M5 12l5 5 9-10' />,
    chat: <path d='M4 5h16v11H9l-5 4z' />,
    down: <path d='M6 9l6 6 6-6' />
};

export function ChatIcon({ name, size = 18 }: { name: ChatIconName; size?: number }): React.ReactNode {
    return <svg
        aria-hidden='true'
        width={size}
        height={size}
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth={1.8}
        strokeLinecap='round'
        strokeLinejoin='round'
    >{paths[name]}</svg>;
}

export function AkariLamp({ size = 26 }: { size?: number }): React.ReactNode {
    return <svg width={size} height={size} viewBox='0 0 32 32' aria-hidden='true'>
        <rect width='32' height='32' rx='8' fill='#0a0a0a' stroke='rgba(255,255,255,.14)' />
        <circle cx='16' cy='16' r='7' fill='#f97316' />
        <circle cx='16' cy='16' r='3.4' fill='#fdba74' />
    </svg>;
}
