// Static line art, including the five keyframe icons from the approved inspector mock.
const ICONS = {
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    diamond: '<path d="M12 4l8 8-8 8-8-8z"/>',
    more: '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18.5" cy="12" r="1.2" fill="currentColor"/>',
    jump: '<path d="M4 12h11M11 7l5 5-5 5M20 5v14"/>',
    scrub: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plateLine: '<rect x="2" y="4" width="20" height="6" rx="2"/><rect x="6" y="14" width="12" height="6" rx="2"/>',
    plateBlock: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M6 10h12M8 15h8"/>'
} as const;

export function createInspectorIcon(name: keyof typeof ICONS): HTMLElement {
    const icon = document.createElement('span');
    icon.className = 'akari-inspector-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false">${ICONS[name]}</svg>`;
    return icon;
}
