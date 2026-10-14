import { t } from '../common/partner-text';
import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { PartnerInstallDisclosure } from '../common/akari-partner-protocol';

export class AkariPartnerInstallDialog extends AbstractDialog<boolean> {
    constructor(disclosure: PartnerInstallDisclosure, protected readonly windows: WindowService) {
        super({ title: t('partner.partnerPanel.installDialog.installConfirmTitle', { value1: disclosure.name }) });
        const notice = document.createElement('p');
        notice.textContent = t('partner.partnerPanel.installDialog.softwareComesProviderNotPartAkariVideoMessage');
        Object.assign(notice.style, { fontWeight: '600', margin: '0 0 16px' });
        this.contentNode.appendChild(notice);

        const details = document.createElement('dl');
        Object.assign(details.style, {
            display: 'grid', gridTemplateColumns: '8em minmax(0, 1fr)', gap: '10px 12px', margin: '0'
        });
        const add = (label: string, value: string | HTMLElement): void => {
            const term = document.createElement('dt');
            term.textContent = label;
            term.style.fontWeight = '600';
            const description = document.createElement('dd');
            Object.assign(description.style, { margin: '0', minWidth: '0', overflowWrap: 'anywhere' });
            description.append(value);
            details.append(term, description);
        };
        const externalLink = (url: string, label: string): HTMLElement => {
            const link = document.createElement('a');
            link.href = url;
            link.textContent = label;
            link.addEventListener('click', event => {
                event.preventDefault();
                this.windows.openNewWindow(url, { external: true });
            });
            return link;
        };
        add(t('partner.partnerPanel.installDialog.softwareLabel'), disclosure.name);
        add(t('partner.partnerPanel.installDialog.providerLabel'), disclosure.provider);
        add(t('partner.partnerPanel.installDialog.sourceLabel'), externalLink(disclosure.sourceUrl, disclosure.sourceUrl));
        add(t('partner.partnerPanel.installDialog.installLocationAction'), disclosure.location);
        add(t('partner.partnerPanel.installDialog.environmentChangesLabel'), disclosure.environment);
        if (disclosure.connectionNote) {
            add(t('partner.partnerPanel.installDialog.connectionDestinationLabel'), disclosure.connectionDetail ?? disclosure.connectionNote);
        }
        add(t('partner.partnerPanel.installDialog.termsLabel'), externalLink(disclosure.termsUrl, t('partner.partnerPanel.installDialog.providerTermsLicenseText')));
        this.contentNode.appendChild(details);
        this.appendCloseButton(t('partner.partnerPanel.installDialog.cancelAction'));
        this.appendAcceptButton(t('partner.partnerPanel.installDialog.installAction'));
    }

    get value(): boolean { return true; }
}
