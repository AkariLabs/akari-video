import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { PartnerInstallDisclosure } from '../common/akari-partner-protocol';

export class AkariPartnerInstallDialog extends AbstractDialog<boolean> {
    constructor(disclosure: PartnerInstallDisclosure, protected readonly windows: WindowService) {
        super({ title: `${disclosure.name} を導入しますか` });
        const notice = document.createElement('p');
        notice.textContent = 'AKARI Video の配布物ではなく、提供元のソフトです。';
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
        add('ソフト名', disclosure.name);
        add('提供元', disclosure.provider);
        add('取得元', externalLink(disclosure.sourceUrl, disclosure.sourceUrl));
        add('入れる場所', disclosure.location);
        add('環境変更', disclosure.environment);
        if (disclosure.connectionNote) {
            add('接続先', disclosure.connectionNote.replace(/^接続先:\s*/, ''));
        }
        add('利用条件', externalLink(disclosure.termsUrl, '提供元の利用規約・ライセンス'));
        this.contentNode.appendChild(details);
        this.appendCloseButton('やめる');
        this.appendAcceptButton('導入する');
    }

    get value(): boolean { return true; }
}
