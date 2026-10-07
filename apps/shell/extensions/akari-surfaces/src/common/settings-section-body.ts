import { Disposable } from '@theia/core/lib/common';
import type { ContributionProvider } from '@theia/core/lib/common';

export const SettingsSectionBodyContributionSymbol = Symbol('SettingsSectionBodyContribution');

export interface SettingsSectionBodyContribution {
    readonly sectionId: string;
    render(host: HTMLElement): Disposable;
}

let provider: ContributionProvider<SettingsSectionBodyContribution> | undefined;
const mounted = new WeakMap<HTMLElement, Disposable>();

export function setSettingsSectionBodyProvider(value: ContributionProvider<SettingsSectionBodyContribution>): void {
    provider = value;
}

export function findSettingsSectionBody(sectionId: string): SettingsSectionBodyContribution | undefined {
    return provider?.getContributions().find(contribution => contribution.sectionId === sectionId);
}

export function mountSettingsSectionBody(host: HTMLElement, contribution: SettingsSectionBodyContribution): Disposable {
    mounted.get(host)?.dispose();
    let body: Disposable | undefined;
    const sync = (): void => {
        if (host.hidden) { body?.dispose(); body = undefined; }
        else if (!body) { body = contribution.render(host); }
    };
    const observer = new MutationObserver(sync);
    observer.observe(host, { attributes: true, attributeFilter: ['hidden'] });
    sync();
    const slot = Disposable.create(() => {
        observer.disconnect();
        body?.dispose();
        body = undefined;
        if (mounted.get(host) === slot) { mounted.delete(host); }
    });
    mounted.set(host, slot);
    return slot;
}
