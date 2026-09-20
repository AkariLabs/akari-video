export function installDaihonFocusPulseStyle(): void {
    if (document.getElementById('akari-daihon-focus-pulse-style')) return;
    const style = document.createElement('style');
    style.id = 'akari-daihon-focus-pulse-style';
    style.textContent = `
@keyframes akariDaihonFocusPulse {
    0%, 100% { outline: 2px solid transparent; outline-offset: 2px; }
    50% { outline: 2px solid var(--akari-focus-pulse, var(--akari-accent, #f97316)); outline-offset: 2px; }
}
.akari-focus-pulse { animation: akariDaihonFocusPulse 1.6s ease-in-out; }`;
    document.head.appendChild(style);
}

const pulseTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function triggerFocusPulse(element: HTMLElement, durationMs = 1600): void {
    clearTimeout(pulseTimers.get(element));
    element.classList.remove('akari-focus-pulse');
    void element.offsetWidth; // Restart the animation when the same element is targeted again.
    element.classList.add('akari-focus-pulse');
    pulseTimers.set(element, setTimeout(() => {
        element.classList.remove('akari-focus-pulse');
        pulseTimers.delete(element);
    }, durationMs));
}
