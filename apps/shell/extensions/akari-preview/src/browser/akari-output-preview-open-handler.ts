// F-50: akari-preview-open-handler.ts から機械移設（本文は無改変）。
import { isEditDataFileName } from '../common/edit-data-file';
import URI from '@theia/core/lib/common/uri';
import { OpenHandler } from '@theia/core/lib/browser';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariPreviewOpenHandler } from './akari-preview-open-handler';

@injectable()
export class AkariOutputPreviewOpenHandler implements OpenHandler {
    readonly id = 'akari-output-preview-open-handler';

    @inject(AkariPreviewOpenHandler)
    protected readonly previewHandler: AkariPreviewOpenHandler;

    canHandle(uri: URI): number {
        return isEditDataFileName(uri.path.base) ? 1200 : 0;
    }

    open(uri: URI, options?: any): Promise<WebviewWidget> {
        return this.previewHandler.openOutput(uri, options);
    }
}
