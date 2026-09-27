export function captionRevealDestination(argument: unknown, _hasAnimatorOwner: boolean): {
    tabId: 'text' | 'motion'; sectionId: string; field?: string
} {
    const field = argument && typeof argument === 'object' && 'field' in argument ? argument.field : undefined;
    if (field === 'caption-effect') return { tabId: 'text', sectionId: 'style:effect' };
    if (field === 'caption-animation') return { tabId: 'motion', sectionId: 'motion:caption' };
    if (field === 'caption-style-stroke-color') return {
        tabId: 'text', sectionId: 'style:stroke', field
    };
    if (field === 'caption-style-bg-color') return {
        tabId: 'text', sectionId: 'style:background', field
    };
    if (field === 'caption-style-color') return { tabId: 'text', sectionId: 'style', field };
    return { tabId: 'text', sectionId: 'style', field: 'caption-style' };
}
