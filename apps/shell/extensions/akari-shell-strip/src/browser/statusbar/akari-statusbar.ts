import { injectable } from '@theia/core/shared/inversify';
import { StatusBarEntry, StatusBarImpl } from '@theia/core/lib/browser/status-bar/status-bar';
import { isEditorStatusItem } from './editor-status-item-filter';

@injectable()
export class AkariStatusBar extends StatusBarImpl {
    override setElement(id: string, entry: StatusBarEntry): Promise<void> {
        if (isEditorStatusItem(id)) {
            return super.removeElement(id);
        }
        return super.setElement(id, entry);
    }
}
