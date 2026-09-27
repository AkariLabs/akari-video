import type { AiMaker } from '../../common/ai-models-protocol';

/** Shared maker mark for the AI model catalog and subscription connections. */
export function makerBadge(makers: Record<string, AiMaker>, makerId: string, withName = true): HTMLElement {
    const maker = makers[makerId];
    const wrap = document.createElement('span');
    wrap.className = 'akari-ai-maker';
    const icon = document.createElement('span');
    icon.className = 'akari-ai-maker-icon';
    icon.style.background = maker?.background || '#526177';
    icon.style.color = maker?.color || '#fff';
    if (maker?.logo) {
        const image = document.createElement('img');
        image.src = maker.logo;
        image.alt = '';
        icon.appendChild(image);
    } else icon.textContent = maker?.initials || makerId.slice(0, 1).toUpperCase();
    wrap.appendChild(icon);
    if (withName) {
        const name = document.createElement('span');
        name.textContent = maker?.name || makerId;
        wrap.appendChild(name);
    }
    return wrap;
}
