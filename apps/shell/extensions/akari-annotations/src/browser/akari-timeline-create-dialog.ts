import { AbstractDialog, DialogError, DialogProps } from '@theia/core/lib/browser/dialogs';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { TIMELINE_ASPECT_PRESETS, slugifyTimelineName, uniqueTimelineSlug } from '../common/timeline-files';

export interface TimelineCreateResult {
    title: string;
    slug: string;
    width: number;
    height: number;
}

export interface AkariTimelineCreateDialogProps extends DialogProps {
    defaultAspect: { width: number; height: number };
    defaultTitle?: string;
    takenSlugs?: readonly string[];
    firstTimeline?: boolean;
}

export class AkariTimelineCreateDialog extends AbstractDialog<TimelineCreateResult | undefined> {
    protected readonly nameInput = document.createElement('input');
    protected readonly slugInput = document.createElement('input');
    protected readonly aspectSelect = document.createElement('select');
    protected readonly widthInput = document.createElement('input');
    protected readonly heightInput = document.createElement('input');
    protected slugEdited = false;

    constructor(protected readonly props: AkariTimelineCreateDialogProps) {
        super(props);
        this.contentNode.style.minWidth = '320px';
        this.contentNode.style.gap = '12px';
        this.nameInput.className = this.slugInput.className = 'theia-input';
        this.nameInput.value = props.defaultTitle ?? '';
        this.appendField('名前', this.nameInput);
        this.slugInput.value = this.suggestSlug();
        if (!props.firstTimeline) this.appendField('ファイル名（slug）', this.slugInput);
        this.nameInput.addEventListener('input', () => {
            if (!this.slugEdited) this.slugInput.value = this.suggestSlug();
            this.update();
        });
        this.slugInput.addEventListener('input', () => { this.slugEdited = true; this.update(); });
        for (const preset of TIMELINE_ASPECT_PRESETS) this.aspectSelect.add(new Option(preset.label, preset.id));
        this.aspectSelect.add(new Option('カスタム', 'custom'));
        const preset = TIMELINE_ASPECT_PRESETS.find(p => p.width === props.defaultAspect.width && p.height === props.defaultAspect.height);
        this.aspectSelect.value = preset?.id ?? 'custom';
        this.appendField('縦横比', this.aspectSelect);
        this.widthInput.value = String(props.defaultAspect.width);
        this.heightInput.value = String(props.defaultAspect.height);
        for (const input of [this.widthInput, this.heightInput]) {
            input.type = 'number';
            input.min = '1';
            input.step = '1';
            input.className = 'theia-input';
            input.addEventListener('input', () => this.update());
        }
        const dimensions = document.createElement('div');
        dimensions.style.display = preset ? 'none' : 'flex';
        dimensions.style.gap = '12px';
        this.appendField('幅（px）', this.widthInput, dimensions);
        this.appendField('高さ（px）', this.heightInput, dimensions);
        this.contentNode.appendChild(dimensions);
        this.aspectSelect.addEventListener('change', () => {
            const selected = TIMELINE_ASPECT_PRESETS.find(p => p.id === this.aspectSelect.value);
            if (selected) {
                this.widthInput.value = String(selected.width);
                this.heightInput.value = String(selected.height);
            }
            dimensions.style.display = selected ? 'none' : 'flex';
            this.update();
        });
        this.appendCloseButton('キャンセル');
        this.appendAcceptButton('作成');
    }

    protected appendField(text: string, input: HTMLElement, parent = this.contentNode): void {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.flexDirection = 'column';
        label.style.gap = '4px';
        label.append(document.createTextNode(text), input);
        parent.appendChild(label);
    }

    protected suggestSlug(): string {
        return uniqueTimelineSlug(slugifyTimelineName(this.nameInput.value), this.props.takenSlugs ?? []);
    }

    get value(): TimelineCreateResult {
        return {
            title: this.nameInput.value.trim() || 'タイムライン',
            slug: this.props.firstTimeline ? '' : this.slugInput.value,
            width: Number(this.widthInput.value), height: Number(this.heightInput.value)
        };
    }

    protected isValid(value: TimelineCreateResult): DialogError {
        if (!this.props.firstTimeline) {
            if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) return 'slug は半角小文字・数字をハイフンでつないでください。';
            if (this.props.takenSlugs?.includes(value.slug)) return 'この slug は使われています。';
        }
        if (![value.width, value.height].every(n => Number.isSafeInteger(n) && n >= 1)) return '幅と高さは 1 以上の整数にしてください。';
        return '';
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.nameInput.focus();
        this.nameInput.select();
    }

    protected handleEnter(event: KeyboardEvent): boolean | void {
        if (event.isComposing) return false;
        return super.handleEnter(event);
    }
}
