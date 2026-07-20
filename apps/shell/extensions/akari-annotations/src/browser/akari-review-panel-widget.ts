import { MessageService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Annotation } from '../common/akari-annotations-protocol';
import { AnnotationStatusFilter, ReviewModel } from './review-model';

const STATUS_LABELS: Record<Annotation['status'], string> = {
    open: '未対応',
    addressed: '対応済み',
    resolved: '確認済み'
};
const STATUS_COLORS: Record<Annotation['status'], string> = {
    open: 'var(--theia-charts-blue)',
    addressed: '#d68a00',
    resolved: 'var(--theia-charts-green)'
};

/**
 * 注釈（レビューコメント）専用パネル。右サイドへ配置する。
 * タイムラインは編集（カット・字幕・オーバーレイ）に専念し、注釈の一覧・絞り込み・追加はここへ集約する。
 */
@injectable()
export class AkariReviewPanelWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-review-panel-widget';

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(ReviewModel)
    protected readonly model!: ReviewModel;

    protected readonly toolbar = document.createElement('div');
    protected readonly filterSelect = document.createElement('select');
    protected readonly composerRow = document.createElement('div');
    protected readonly timeLabel = document.createElement('span');
    protected readonly textInput = document.createElement('input');
    protected readonly addButton = document.createElement('button');
    protected readonly notice = document.createElement('div');
    protected readonly listContainer = document.createElement('div');
    protected readonly footer = document.createElement('div');

    @postConstruct()
    protected init(): void {
        this.id = AkariReviewPanelWidget.FACTORY_ID;
        this.title.label = '注釈';
        this.title.caption = '注釈（レビューコメント）';
        this.title.iconClass = 'codicon codicon-comment-discussion';
        this.title.closable = true;
        this.node.classList.add('akari-review-panel-widget');
        Object.assign(this.node.style, {
            display: 'grid',
            gridTemplateRows: 'auto auto auto minmax(0, 1fr) auto',
            height: '100%',
            overflow: 'hidden',
            background: 'var(--theia-editor-background)'
        });

        Object.assign(this.toolbar.style, {
            alignItems: 'center', display: 'flex', gap: '8px', minHeight: '38px',
            padding: '6px 10px', borderBottom: '1px solid var(--theia-widget-border)', boxSizing: 'border-box'
        });
        const heading = document.createElement('strong');
        heading.textContent = '注釈';
        heading.style.marginRight = 'auto';
        this.filterSelect.setAttribute('aria-label', '状態で絞り込み');
        const filterOptions: Array<[AnnotationStatusFilter, string]> = [
            ['all', 'すべて'], ['open', '未対応'], ['addressed', '対応済み'], ['resolved', '確認済み']
        ];
        for (const [value, label] of filterOptions) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            this.filterSelect.appendChild(option);
        }
        this.filterSelect.addEventListener('change', () => {
            this.model.statusFilter = this.filterSelect.value as AnnotationStatusFilter;
        });
        this.toolbar.append(heading, this.filterSelect);

        Object.assign(this.composerRow.style, {
            display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
            padding: '8px 10px', boxSizing: 'border-box',
            borderBottom: '1px solid var(--theia-widget-border)'
        });
        Object.assign(this.timeLabel.style, {
            fontVariantNumeric: 'tabular-nums', color: 'var(--theia-descriptionForeground)', fontSize: '11px'
        });
        this.timeLabel.title = 'タイムラインをクリックすると、この時刻が変わります。';
        this.textInput.type = 'text';
        this.textInput.placeholder = 'コメントを入力';
        this.textInput.setAttribute('aria-label', 'コメントを入力');
        Object.assign(this.textInput.style, { flex: '1', minWidth: '0' });
        this.textInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void this.submitAnnotation();
            }
        });
        this.addButton.type = 'button';
        this.addButton.className = 'theia-button main';
        this.addButton.textContent = '追加';
        this.addButton.addEventListener('click', () => void this.submitAnnotation());
        this.composerRow.append(this.timeLabel, this.textInput, this.addButton);

        Object.assign(this.notice.style, {
            display: 'none', padding: '7px 11px', color: 'var(--theia-warningForeground)',
            background: 'var(--theia-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--theia-inputValidation-warningBorder)', fontSize: '12px', lineHeight: '1.4'
        });
        Object.assign(this.listContainer.style, { minHeight: '0', overflow: 'auto', padding: '4px 10px' });
        Object.assign(this.footer.style, {
            height: '26px', minHeight: '26px', maxHeight: '26px', padding: '5px 10px', boxSizing: 'border-box',
            borderTop: '1px solid var(--theia-widget-border)', color: 'var(--theia-descriptionForeground)',
            fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        });
        this.footer.textContent = 'タイムラインで時刻を選び、ここにコメントを書きます。';

        this.node.append(this.toolbar, this.composerRow, this.notice, this.listContainer, this.footer);

        const style = document.createElement('style');
        style.textContent = `
    .akari-review-panel-widget .akari-review-row.akari-review-row-revealed {
        background: var(--theia-list-activeSelectionBackground);
        border-radius: 3px;
    }
`;
        this.node.appendChild(style);

        this.toDispose.push(this.model.onChanged(() => this.render()));
        this.toDispose.push(this.model.onReveal(id => this.revealAnnotation(id)));
        this.render();
    }

    protected render(): void {
        this.filterSelect.value = this.model.statusFilter;
        this.timeLabel.textContent = this.formatTimestamp(this.model.selectedSourceT);
        this.renderList();
    }

    protected renderList(): void {
        this.listContainer.replaceChildren();
        const filtered = this.model.filtered();
        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = this.model.annotations.length === 0
                ? 'まだ注釈はありません。'
                : '該当する注釈はありません。';
            empty.style.color = 'var(--theia-descriptionForeground)';
            empty.style.padding = '8px 2px';
            this.listContainer.appendChild(empty);
            return;
        }
        for (const annotation of filtered) {
            this.listContainer.appendChild(this.renderAnnotationRow(annotation));
        }
    }

    protected renderAnnotationRow(annotation: Annotation): HTMLDivElement {
        const row = document.createElement('div');
        row.className = 'akari-review-row';
        row.setAttribute('data-annotation-row', annotation.id);
        Object.assign(row.style, {
            display: 'grid', gap: '4px', padding: '8px 6px', borderBottom: '1px solid var(--theia-widget-border)'
        });
        const head = document.createElement('div');
        Object.assign(head.style, { display: 'flex', alignItems: 'center', gap: '8px' });
        const time = document.createElement('button');
        time.type = 'button';
        time.textContent = this.formatTimestamp(annotation.sourceT);
        time.title = 'この時刻へジャンプ';
        Object.assign(time.style, {
            fontVariantNumeric: 'tabular-nums', background: 'none', border: 'none', padding: '0',
            color: 'var(--theia-textLink-foreground)', cursor: 'pointer', font: 'inherit'
        });
        time.addEventListener('click', () => this.model.requestSeek(annotation.sourceT));
        const badge = document.createElement('span');
        badge.textContent = STATUS_LABELS[annotation.status];
        Object.assign(badge.style, {
            color: STATUS_COLORS[annotation.status], fontSize: '11px',
            border: `1px solid ${STATUS_COLORS[annotation.status]}`, borderRadius: '999px', padding: '0 8px'
        });
        head.append(time, badge);
        if (annotation.status === 'addressed') {
            const resolveButton = document.createElement('button');
            resolveButton.type = 'button';
            resolveButton.className = 'theia-button secondary';
            resolveButton.textContent = '確認済みにする';
            resolveButton.setAttribute('data-resolve-button', annotation.id);
            resolveButton.style.marginLeft = 'auto';
            resolveButton.addEventListener('click', () => void this.resolveAnnotationById(annotation.id));
            head.appendChild(resolveButton);
        }
        const text = document.createElement('div');
        text.textContent = annotation.text;
        text.style.whiteSpace = 'pre-wrap';
        row.append(head, text);
        if (annotation.response) {
            const response = document.createElement('div');
            response.style.color = 'var(--theia-descriptionForeground)';
            response.style.fontSize = '12px';
            response.textContent = `対応（${annotation.response.action === 'edited' ? '編集しました' : '見送りました'}）: ${annotation.response.summary}`;
            row.appendChild(response);
        }
        return row;
    }

    /** タイムラインのピンから呼ばれる。該当行が絞り込みで隠れている場合は絞り込みを解除する。 */
    protected revealAnnotation(annotationId: string): void {
        const target = this.model.annotations.find(annotation => annotation.id === annotationId);
        if (target && this.model.statusFilter !== 'all' && target.status !== this.model.statusFilter) {
            this.model.statusFilter = 'all';
        }
        const row = this.listContainer.querySelector<HTMLDivElement>(`[data-annotation-row="${CSS.escape(annotationId)}"]`);
        if (!row) {
            return;
        }
        row.scrollIntoView({ block: 'nearest' });
        this.listContainer.querySelectorAll('.akari-review-row-revealed').forEach(
            highlighted => highlighted.classList.remove('akari-review-row-revealed')
        );
        row.classList.add('akari-review-row-revealed');
    }

    protected async submitAnnotation(): Promise<void> {
        const text = this.textInput.value.trim();
        if (!text) {
            return;
        }
        if (!this.model.location) {
            this.showNotice('プロジェクトを特定できません。タイムラインを開いてから追加してください。');
            return;
        }
        this.addButton.disabled = true;
        try {
            const result = await this.model.addAnnotation(text, this.model.selectedSourceT);
            this.textInput.value = '';
            this.hideNotice();
            this.footer.textContent = result.committed
                ? '注釈を追加しました。変更を記録しました。'
                : '注釈を追加しました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`注釈を追加できません: ${detail}`);
            this.messages.error(`注釈を追加できません: ${detail}`);
        } finally {
            this.addButton.disabled = false;
        }
    }

    protected async resolveAnnotationById(id: string): Promise<void> {
        try {
            await this.model.resolveAnnotation(id);
            this.hideNotice();
            this.footer.textContent = '注釈を確認済みにしました。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`更新できません: ${detail}`);
            this.messages.error(`更新できません: ${detail}`);
        }
    }

    protected showNotice(message: string): void {
        this.notice.textContent = message;
        this.notice.style.display = 'block';
    }

    protected hideNotice(): void {
        this.notice.textContent = '';
        this.notice.style.display = 'none';
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

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
