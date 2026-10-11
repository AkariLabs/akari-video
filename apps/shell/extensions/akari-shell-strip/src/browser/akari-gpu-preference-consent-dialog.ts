import { t } from '../common/shell-text';
import { AbstractDialog } from '@theia/core/lib/browser/dialogs';

export class AkariGpuPreferenceConsentDialog extends AbstractDialog<boolean> {
    constructor() {
        super({ title: t('shell.exportDialog.gpuConsent.allowGpuSettingsExportMessage') });
        this.contentNode.setAttribute('data-akari-gpu-preference-consent', 'true');
        const explanation = document.createElement('p');
        explanation.textContent = t('shell.exportDialog.gpuConsent.speedUpExportAkariVideoUseHighPerformanceGpuWindowsMessage');
        this.contentNode.appendChild(explanation);
        this.appendButton(t('shell.exportDialog.gpuConsent.declineAction'), false).addEventListener('click', () => {
            this.resolve?.(false);
            this.close();
        });
        this.appendAcceptButton(t('shell.exportDialog.gpuConsent.allowAction'));
    }

    get value(): boolean { return true; }
}
