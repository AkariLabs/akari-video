import { BaseWidget } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { TimelineSelectionModel } from './timeline-selection-model';

const KIND_LABELS = {
    cut: 'クリップ',
    overlay: 'オーバーレイ',
    caption: '字幕'
} as const;

/**
 * タイムラインの選択内容を表示するだけの読み取り専用パネル。
 * 一度開けば常駐し、TimelineSelectionModel の変化に追従して内容を更新する。
 */
@injectable()
export class AkariInspectorWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-inspector-widget';

    @inject(TimelineSelectionModel)
    protected readonly model!: TimelineSelectionModel;

    protected readonly body = document.createElement('div');

    @postConstruct()
    protected init(): void {
        this.id = AkariInspectorWidget.FACTORY_ID;
        this.title.label = 'インスペクター';
        this.title.caption = '選択したクリップ・オーバーレイ・字幕の詳細（読み取り専用）';
        this.title.iconClass = 'codicon codicon-inspect';
        this.title.closable = true;
        this.node.classList.add('akari-inspector-widget');
        Object.assign(this.node.style, {
            height: '100%',
            overflow: 'auto',
            background: 'var(--theia-editor-background)'
        });
        Object.assign(this.body.style, {
            padding: '10px',
            display: 'grid',
            gap: '6px',
            alignContent: 'start'
        });
        this.node.appendChild(this.body);

        const style = document.createElement('style');
        style.textContent = `
    .akari-inspector-widget .akari-inspector-row {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 8px;
        font-size: 12px;
        line-height: 1.5;
    }
    .akari-inspector-widget .akari-inspector-row-label {
        color: var(--theia-descriptionForeground);
    }
    .akari-inspector-widget .akari-inspector-row-value {
        font-variant-numeric: tabular-nums;
        word-break: break-all;
    }
    .akari-inspector-widget .akari-inspector-heading {
        font-weight: 600;
        margin-bottom: 4px;
    }
    .akari-inspector-widget .akari-inspector-empty {
        color: var(--theia-descriptionForeground);
        padding: 4px 0;
    }
`;
        this.node.appendChild(style);

        this.toDispose.push(this.model.onChanged(() => this.render()));
        this.render();
    }

    protected render(): void {
        this.body.replaceChildren();
        const snapshot = this.model.snapshot;
        if (!snapshot) {
            const empty = document.createElement('div');
            empty.className = 'akari-inspector-empty';
            empty.textContent = 'タイムラインでクリップを選択してください。';
            this.body.appendChild(empty);
            return;
        }

        const heading = document.createElement('div');
        heading.className = 'akari-inspector-heading';
        heading.textContent = KIND_LABELS[snapshot.kind];
        this.body.appendChild(heading);

        if (snapshot.kind === 'cut') {
            this.appendRow('クリップ', snapshot.label);
            this.appendRow('素材', snapshot.sourceName || '(不明)');
            this.appendRow('素材 in', this.formatTimestamp(snapshot.sourceIn));
            this.appendRow('素材 out', this.formatTimestamp(snapshot.sourceOut));
            this.appendRow('出力位置', this.formatTimestamp(snapshot.outputStart));
            this.appendRow('尺', `${(snapshot.outputEnd - snapshot.outputStart).toFixed(2)} 秒`);
        } else if (snapshot.kind === 'overlay') {
            this.appendRow('ID', snapshot.id);
            this.appendRow('出力位置', this.formatTimestamp(snapshot.outputStart));
            this.appendRow('尺', `${snapshot.duration.toFixed(2)} 秒`);
        } else {
            this.appendRow('内容', snapshot.text);
            this.appendRow('素材 in', this.formatTimestamp(snapshot.sourceStart));
            this.appendRow('素材 out', this.formatTimestamp(snapshot.sourceEnd));
            this.appendRow(
                '出力位置',
                snapshot.outputStart !== undefined && snapshot.outputEnd !== undefined
                    ? `${this.formatTimestamp(snapshot.outputStart)} – ${this.formatTimestamp(snapshot.outputEnd)}`
                    : '(削除区間のため出力なし)'
            );
        }
    }

    protected appendRow(label: string, value: string): void {
        const row = document.createElement('div');
        row.className = 'akari-inspector-row';
        const labelElement = document.createElement('div');
        labelElement.className = 'akari-inspector-row-label';
        labelElement.textContent = label;
        const valueElement = document.createElement('div');
        valueElement.className = 'akari-inspector-row-value';
        valueElement.textContent = value;
        row.append(labelElement, valueElement);
        this.body.appendChild(row);
    }

    protected formatTimestamp(value: number): string {
        const milliseconds = Math.max(0, Math.round(value * 1000));
        const hours = Math.floor(milliseconds / 3_600_000);
        const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
        const seconds = Math.floor((milliseconds % 60_000) / 1000);
        const fraction = milliseconds % 1000;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:` +
            `${String(seconds).padStart(2, '0')}.${String(fraction).padStart(3, '0')}`;
    }
}
