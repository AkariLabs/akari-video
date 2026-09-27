type Maker = { name: string; initials: string; background: string; color: string; logo?: string };
// Bundled catalog data; this extension does not import another extension's UI.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const makers: Record<string, Maker> = require('../../../../../../../packages/schemas/ai-makers.json');

export function stillMakerBadge(makerId: string, small = false): HTMLElement {
    const maker = makers[makerId];
    const mark = document.createElement('span');
    mark.className = `akari-inspector-ai-maker${small ? ' akari-inspector-ai-maker-small' : ''}`;
    mark.style.cssText = `display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;width:${small ? 16 : 22}px;height:${small ? 16 : 22}px;border-radius:5px;overflow:hidden;margin-left:${small ? 8 : 0}px;margin-right:${small ? 0 : 6}px;background:${maker?.background ?? '#526177'};color:${maker?.color ?? '#fff'};font-weight:700;font-size:${small ? 10 : 13}px`;
    if (maker?.logo) {
        const img = document.createElement('img');
        img.src = maker.logo;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:contain';
        mark.appendChild(img);
    } else mark.textContent = maker?.initials ?? makerId.slice(0, 1).toUpperCase();
    mark.setAttribute('data-akari-inspector-ai-maker', makerId);
    return mark;
}
