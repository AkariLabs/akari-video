import * as React from '@theia/core/shared/react';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WidgetManager } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { PROJECT_LIST_WIDGET_ID } from 'akari-shell-strip/lib/common/rail-ids';
import { AkariHomeWidget } from './akari-home-widget';
import { projectListCss } from './home/project-list-view';

@injectable()
export class AkariProjectListWidget extends ReactWidget {
    static readonly ID = PROJECT_LIST_WIDGET_ID;
    @inject(WidgetManager) protected readonly widgets!: WidgetManager;

    @postConstruct()
    protected init(): void {
        this.id = AkariProjectListWidget.ID;
        this.title.label = 'プロジェクト一覧';
        this.title.caption = 'このチャンネルのプロジェクト';
        this.title.iconClass = 'codicon codicon-files';
        this.title.closable = true;
        this.update();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.widgets.getOrCreateWidget<AkariHomeWidget>(AkariHomeWidget.ID)
            .then(home => home.refreshProjectListData()).then(() => this.update());
    }

    protected override render(): React.ReactNode {
        const home = this.widgets.tryGetWidget<AkariHomeWidget>(AkariHomeWidget.ID);
        return <div className='akari-os-list-tab' style={{ height: '100%', overflow: 'auto', padding: '18px 22px', boxSizing: 'border-box' }}>
            <style>{projectListCss}</style>{home?.renderProjectListForTab()}
        </div>;
    }
}
