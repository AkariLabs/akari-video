import { AbstractDialog } from '@theia/core/lib/browser/dialogs';

export class AkariGpuPreferenceConsentDialog extends AbstractDialog<boolean> {
    constructor() {
        super({ title: '書き出し時の GPU 設定を許可しますか' });
        this.contentNode.setAttribute('data-akari-gpu-preference-consent', 'true');
        const explanation = document.createElement('p');
        explanation.textContent = '書き出しを速くするため、書き出しの間だけ Windows の「グラフィックスの設定」で AKARI Video に高性能 GPU を割り当てます。終わったら元に戻します。';
        this.contentNode.appendChild(explanation);
        this.appendButton('許可しない', false).addEventListener('click', () => {
            this.resolve?.(false);
            this.close();
        });
        this.appendAcceptButton('許可する');
    }

    get value(): boolean { return true; }
}
