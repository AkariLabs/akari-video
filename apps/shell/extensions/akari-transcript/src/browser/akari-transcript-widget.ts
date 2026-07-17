import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BaseWidget } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/shared/@lumino/messaging';
import * as monaco from '@theia/monaco-editor-core';
import {
    Caption,
    parseCaptions,
    regenerateCaptions,
    replaceCaptionLine
} from './caption-store';
import { AKARI_TRANSCRIPT_SEEK_REQUESTED } from './akari-transcript-commands';

interface KeepRange {
    in: number;
    out: number;
}

@injectable()
export class AkariTranscriptWidget extends BaseWidget {
    static readonly FACTORY_ID = 'akari-transcript-widget';

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(CommandService)
    protected readonly commands: CommandService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    protected readonly toolbar = document.createElement('div');
    protected readonly generateButton = document.createElement('button');
    protected readonly notice = document.createElement('div');
    protected readonly editorHost = document.createElement('div');
    protected readonly footer = document.createElement('div');
    protected editor: monaco.editor.IStandaloneCodeEditor | undefined;
    protected decorations: string[] = [];
    protected analysisUri: URI | undefined;
    protected captionsUri: URI | undefined;
    protected editUri: URI | undefined;
    protected analysisSource = '';
    protected videoUri = '';
    protected captions: Caption[] = [];
    protected baselineLines: string[] = [];
    protected keepRanges: KeepRange[] = [];
    protected applyingModel = false;
    protected saveTimer = 0;
    protected saveTail = Promise.resolve();
    protected recentWrite = 0;
    protected configured = false;

    @postConstruct()
    protected init(): void {
        this.id = `${AkariTranscriptWidget.FACTORY_ID}-unconfigured`;
        this.title.label = '文字起こし';
        this.title.caption = '文字起こしを編集';
        this.title.iconClass = 'codicon codicon-comment-discussion';
        this.title.closable = true;
        this.node.classList.add('akari-transcript-widget');
        Object.assign(this.node.style, {
            display: 'grid',
            gridTemplateRows: 'auto auto minmax(0, 1fr) auto',
            height: '100%',
            overflow: 'hidden',
            background: 'var(--theia-editor-background)'
        });

        Object.assign(this.toolbar.style, {
            alignItems: 'center',
            display: 'flex',
            gap: '10px',
            minHeight: '38px',
            padding: '6px 10px',
            borderBottom: '1px solid var(--theia-widget-border)',
            boxSizing: 'border-box'
        });
        const heading = document.createElement('strong');
        heading.textContent = '文字起こし';
        heading.style.marginRight = 'auto';
        this.generateButton.type = 'button';
        this.generateButton.className = 'theia-button secondary';
        this.generateButton.textContent = '文字起こしから字幕を作成';
        this.generateButton.addEventListener('click', () => void this.generate());
        this.toolbar.append(heading, this.generateButton);

        Object.assign(this.notice.style, {
            display: 'none',
            padding: '7px 11px',
            color: 'var(--theia-warningForeground)',
            background: 'var(--theia-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--theia-inputValidation-warningBorder)',
            fontSize: '12px',
            lineHeight: '1.4'
        });
        this.editorHost.style.minHeight = '0';
        this.editorHost.style.height = '100%';
        Object.assign(this.footer.style, {
            minHeight: '26px',
            padding: '5px 10px',
            boxSizing: 'border-box',
            borderTop: '1px solid var(--theia-widget-border)',
            color: 'var(--theia-descriptionForeground)',
            fontSize: '11px'
        });
        this.footer.textContent = '行をクリックするとプレビュー位置を選択します。プレビューを開いていればその場でシークします。';
        this.node.append(this.toolbar, this.notice, this.editorHost, this.footer);

        const style = document.createElement('style');
        style.textContent = `
            .akari-transcript-widget .akari-transcript-cut {
                color: var(--theia-disabledForeground, #888) !important;
                opacity: .72;
                text-decoration: line-through !important;
            }
            .akari-transcript-widget .akari-transcript-cut-line {
                background: color-mix(in srgb, var(--theia-editor-background) 82%, var(--theia-disabledForeground, #888));
            }
        `;
        this.node.appendChild(style);
    }

    async configure(analysisUri: URI): Promise<void> {
        if (this.configured) {
            return;
        }
        this.configured = true;
        this.analysisUri = analysisUri;
        this.id = `${AkariTranscriptWidget.FACTORY_ID}-${this.hash(analysisUri.toString())}`;
        this.title.caption = analysisUri.toString();

        const root = await this.workspaceRootFor(analysisUri);
        if (!root) {
            this.showNotice('先にプロジェクトを開いてください。');
            return;
        }
        this.captionsUri = root.resolve('project/captions.json');
        this.editUri = root.resolve('project/edit.json');
        try {
            this.analysisSource = await this.readText(analysisUri);
            const analysis = JSON.parse(this.analysisSource);
            this.videoUri = typeof analysis?.source === 'string'
                ? analysisUri.parent.resolve(analysis.source).toString()
                : '';
        } catch (error) {
            this.showNotice(`文字起こしを読み取れません: ${this.errorMessage(error)}`);
            return;
        }

        await this.reloadAll();
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (this.editUri && event.contains(this.editUri)) {
                void this.reloadEdit();
            }
            if (this.captionsUri && event.contains(this.captionsUri) && Date.now() - this.recentWrite > 1000) {
                void this.reloadCaptions();
            }
        }));
        try {
            this.toDispose.push(await this.fileService.watch(root, { recursive: true, excludes: [] }));
        } catch (error) {
            console.warn('[akari-transcript] file watching is unavailable', error);
        }
    }

    protected override onAfterAttach(message: Message): void {
        super.onAfterAttach(message);
        if (this.editor) {
            this.editor.layout();
            return;
        }
        this.editor = monaco.editor.create(this.editorHost, {
            value: this.baselineLines.join('\n'),
            language: 'plaintext',
            automaticLayout: true,
            glyphMargin: true,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 4,
            minimap: { enabled: false },
            padding: { top: 10, bottom: 10 },
            renderLineHighlight: 'line',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            wrappingIndent: 'same'
        });
        this.editor.updateOptions({ readOnly: this.captions.length === 0 });
        this.toDispose.push(this.editor);
        this.toDispose.push(this.editor.onDidChangeModelContent(() => this.onEditorChanged()));
        this.toDispose.push(this.editor.onMouseDown(event => {
            const lineNumber = event.target.position?.lineNumber;
            if (lineNumber) {
                void this.requestSeek(lineNumber - 1);
            }
        }));
        this.applyDecorations();
    }

    protected async reloadAll(): Promise<void> {
        await Promise.all([this.reloadCaptions(), this.reloadEdit()]);
    }

    protected async reloadCaptions(): Promise<void> {
        if (!this.captionsUri) {
            return;
        }
        try {
            const source = await this.readText(this.captionsUri);
            const parsed = parseCaptions(source);
            this.captions = parsed.captions;
            this.baselineLines = this.captions.map(caption => this.displayText(caption.text));
            this.generateButton.textContent = '文字起こしから更新';
            this.setEditorValue(this.baselineLines.join('\n'), false);
            this.showWarnings(parsed.warnings);
        } catch (error) {
            if (await this.fileService.exists(this.captionsUri)) {
                this.captions = [];
                this.baselineLines = [];
                this.setEditorValue('', true);
                this.showNotice(`字幕を読み取れません: ${this.errorMessage(error)}`);
            } else {
                this.captions = [];
                this.baselineLines = [];
                this.generateButton.textContent = '文字起こしから字幕を作成';
                this.setEditorValue('', true);
                this.showNotice('字幕はまだありません。「文字起こしから字幕を作成」を押すと編集を始められます。');
            }
        }
        this.applyDecorations();
        await this.checkOverlayCoverage();
    }

    protected async reloadEdit(): Promise<void> {
        this.keepRanges = [];
        if (this.editUri) {
            try {
                const edit = JSON.parse(await this.readText(this.editUri));
                if (Array.isArray(edit?.cuts)) {
                    this.keepRanges = edit.cuts.flatMap((value: any) => {
                        const input = Number(value?.in);
                        const output = Number(value?.out);
                        return Number.isFinite(input) && Number.isFinite(output) && input < output
                            ? [{ in: input, out: output }]
                            : [];
                    });
                }
            } catch {
                // A missing edit file means the full source is retained.
            }
        }
        this.applyDecorations();
        await this.checkOverlayCoverage();
    }

    protected async generate(): Promise<void> {
        if (!this.captionsUri || !this.analysisUri) {
            return;
        }
        this.generateButton.disabled = true;
        try {
            this.analysisSource = await this.readText(this.analysisUri);
            const existing = await this.fileService.exists(this.captionsUri)
                ? await this.readText(this.captionsUri)
                : undefined;
            const generated = regenerateCaptions(this.analysisSource, existing);
            await this.fileService.createFolder(this.captionsUri.parent, { fromUserGesture: false });
            this.recentWrite = Date.now();
            await this.fileService.writeFile(this.captionsUri, BinaryBuffer.fromString(generated.source));
            await this.reloadCaptions();
            this.showWarnings(generated.warnings);
            this.footer.textContent = '字幕を更新しました。編集済みの行は保持されています。';
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`字幕を作成できません: ${detail}`);
            this.messages.error(`字幕を作成できません: ${detail}`);
        } finally {
            this.generateButton.disabled = false;
        }
    }

    protected onEditorChanged(): void {
        if (this.applyingModel || !this.editor) {
            return;
        }
        window.clearTimeout(this.saveTimer);
        const lines = this.editor.getValue().split('\n');
        if (lines.length !== this.captions.length) {
            this.showNotice('行の追加・削除・分割・結合はまだ保存できません。行数を元に戻すと保存を再開します。');
            return;
        }
        this.hideNotice();
        this.saveTimer = window.setTimeout(() => {
            this.saveTail = this.saveTail.then(() => this.saveChangedLines());
        }, 450);
    }

    protected async saveChangedLines(): Promise<void> {
        if (!this.editor || !this.captionsUri) {
            return;
        }
        const lines = this.editor.getValue().split('\n');
        if (lines.length !== this.captions.length) {
            return;
        }
        const changed = lines
            .map((text, index) => ({ text, index }))
            .filter(({ text, index }) => text !== this.baselineLines[index]);
        if (changed.length === 0) {
            return;
        }
        try {
            let source = await this.readText(this.captionsUri);
            for (const change of changed) {
                const caption = this.captions[change.index];
                source = replaceCaptionLine(source, caption.id, change.text);
            }
            this.recentWrite = Date.now();
            await this.fileService.writeFile(this.captionsUri, BinaryBuffer.fromString(source));
            for (const change of changed) {
                const caption = this.captions[change.index];
                caption.text = change.text;
                caption.edited = true;
                this.baselineLines[change.index] = change.text;
            }
            this.footer.textContent = changed.length === 1
                ? 'この行の変更を保存しました。'
                : `${changed.length} 行の変更を保存しました。`;
        } catch (error) {
            const detail = this.errorMessage(error);
            this.showNotice(`変更を保存できません: ${detail}`);
            this.messages.error(`変更を保存できません: ${detail}`);
        }
    }

    protected applyDecorations(): void {
        if (!this.editor) {
            return;
        }
        const model = this.editor.getModel();
        const decorations: monaco.editor.IModelDeltaDecoration[] = this.captions.map((caption, index) => {
            const isCut = this.keepRanges.length > 0
                && !this.keepRanges.some(range => caption.end > range.in && caption.start < range.out);
            return {
                range: new monaco.Range(index + 1, 1, index + 1, model?.getLineMaxColumn(index + 1) ?? 1),
                options: {
                    isWholeLine: true,
                    className: isCut ? 'akari-transcript-cut-line' : undefined,
                    inlineClassName: isCut ? 'akari-transcript-cut' : undefined,
                    hoverMessage: {
                        value: `**開始:** ${this.formatTimestamp(caption.start)}  \n**終了:** ${this.formatTimestamp(caption.end)}`
                    },
                    overviewRuler: isCut ? {
                        color: 'rgba(128, 128, 128, 0.7)',
                        position: monaco.editor.OverviewRulerLane.Right
                    } : undefined
                }
            };
        });
        this.decorations = this.editor.deltaDecorations(this.decorations, decorations);
    }

    protected async requestSeek(index: number): Promise<void> {
        const caption = this.captions[index];
        if (!caption) {
            return;
        }
        const handled = await this.commands.executeCommand<boolean>(AKARI_TRANSCRIPT_SEEK_REQUESTED.id, {
            videoUri: this.videoUri,
            time: caption.start,
            captionId: caption.id
        });
        this.footer.textContent = handled
            ? `${this.formatTimestamp(caption.start)} にプレビューをシークしました。`
            : `${this.formatTimestamp(caption.start)} を選択しました。プレビューを開くとここからジャンプできます。`;
    }

    protected async checkOverlayCoverage(): Promise<void> {
        if (!this.editUri || this.captions.length === 0) {
            return;
        }
        try {
            const edit = JSON.parse(await this.readText(this.editUri));
            const overlayIds = new Set((Array.isArray(edit?.overlays) ? edit.overlays : [])
                .map((overlay: any) => String(overlay?.id ?? ''))
                .filter(Boolean));
            const missing = this.captions.filter(caption => !overlayIds.has(caption.id));
            if (missing.length > 0) {
                this.showNotice(`${missing.length} 件の字幕は映像上の表示とまだ対応していません。字幕の編集は続けられます。`);
            }
        } catch {
            // Overlay coverage is advisory and never blocks transcript editing.
        }
    }

    protected setEditorValue(value: string, readOnly: boolean): void {
        if (!this.editor) {
            return;
        }
        this.applyingModel = true;
        try {
            this.editor.setValue(value);
            this.editor.updateOptions({ readOnly });
        } finally {
            this.applyingModel = false;
        }
    }

    protected showWarnings(warnings: readonly string[]): void {
        if (warnings.length > 0) {
            this.showNotice(warnings.join(' '));
        } else {
            this.hideNotice();
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

    protected displayText(text: string): string {
        return text.replace(/\r?\n/g, ' ');
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

    protected async workspaceRootFor(uri: URI): Promise<URI | undefined> {
        const roots = await this.workspaceService.roots;
        return roots.find(root => root.resource.isEqualOrParent(uri))?.resource ?? roots[0]?.resource;
    }

    protected async readText(uri: URI): Promise<string> {
        return (await this.fileService.readFile(uri)).value.toString();
    }

    protected hash(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
