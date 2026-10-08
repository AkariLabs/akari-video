import * as React from '@theia/core/shared/react';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { AKARI_COMMANDS, RAIL_CHANNEL_WIDGET_ID } from 'akari-shell-strip/lib/common/rail-ids';
import { AkariSkillCatalogService } from 'akari-shell-strip/lib/browser/akari-skill-catalog-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { AkariProjectService } from 'akari-project/lib/common/akari-project-protocol';
import { AkariScopeService } from 'akari-shell-strip/lib/browser/akari-scope-service';
import { ProjectProgressService, stageSummary } from '../home/project-progress';
import { AkariChannelContextService, ChannelProject } from './akari-channel-context-service';
import { CHANNEL_DOC_KINDS, ChannelDocKind, channelDocFileName, channelDocTemplate, resolveChannelDocFileName } from './channel-docs';
import { ChannelAnswers, channelDesignPartnerPrompt, parseChannelMarkdown } from './channel-design-model';
import { ChannelDesignStart, ChannelDesignView, ChannelDesignWizard } from './channel-design-wizard';
import { ChannelTypesCatalog } from './channel-types-catalog';
import { ChannelTypeApplySheet, ChannelTypeBanner } from './channel-types-apply-sheet';
import { ApplyChoices, ApplyInputs, appliedTypeName, parseTypeUndo, planTypeApply } from './channel-types-apply';
import { ChannelTypeEntry, buildMyTypeJson, findChannelTypeByName } from './channel-types-model';
import { HELPER_KINDS, HELPER_KIND_LABELS, HELPER_NO_PARTNER_TEXT, HELPER_ROW_DESCRIPTION,
    HelperConsentSheet, HelperKind, buildHelperConsent, helperPrompt, parseHelperConsent } from './channel-helper';
import { DesignMdValues, defaultDesignValues, parseDesignMd } from './design-md-model';
import { DesignMdForm } from './channel-design-md-form';
import { ChannelSkillDraft, PRESET_CHANNEL_SKILLS, buildSkillMd, copiedSkillMd, parseSkillMd, validateSkillSlug } from './channel-skills-model';
import { ChannelSkillRow, ChannelSkillsSheet } from './channel-skills-sheet';
import { ChannelMemoryFiles } from './channel-memory-files';
import { ChannelMemorySheets, ChannelMemorySheetKind, readChannelMemoryCounts } from './channel-memory-sheets';

export const CHANNEL_WIDGET_ID = RAIL_CHANNEL_WIDGET_ID;
export const CHANNEL_WIDGET_LABEL = 'チャンネル';
const STYLE_ID = 'akari-channel-style';
const RAIL_TAB = `#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab[data-akari-rail-id="${RAIL_CHANNEL_WIDGET_ID}"]`;
const CSS = `
${RAIL_TAB} .lm-TabBar-tabIcon { display:none !important; }
${RAIL_TAB}[data-akari-channel-initial]::after { content:attr(data-akari-channel-initial); position:absolute; top:5px; left:50%; transform:translateX(-50%); width:25px; height:25px; border-radius:7px; display:grid; place-items:center; background:var(--akari-elevated,#454750); color:var(--theia-foreground,#fff); font-size:15px; font-weight:700; }
body[data-akari-rail-expanded="true"] ${RAIL_TAB}[data-akari-channel-initial]::after { left:calc(12px + 14px); }
${RAIL_TAB} .lm-TabBar-tabLabel { margin-top:25px; }
.akari-channel-panel { position:relative; display:flex; flex-direction:column; box-sizing:border-box; height:100%; padding:16px 14px; color:var(--theia-foreground); }
.akari-channel-heading { position:relative; display:block; width:100%; margin-bottom:14px; }
.akari-channel-heading-button { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border:0; background:transparent; color:inherit; font-weight:700; font-size:16px; text-align:left; cursor:pointer; }
.akari-channel-popover { position:absolute; top:100%; left:0; right:0; z-index:10; box-sizing:border-box; min-width:0; width:auto; padding:7px; border:1px solid var(--theia-widget-border); border-radius:9px; background:var(--theia-editorWidget-background,var(--theia-editor-background)); box-shadow:0 15px 40px rgba(0,0,0,.3); }
.akari-channel-popover hr { border:0; border-top:1px solid var(--theia-widget-border); margin:6px 0; }
.akari-channel-popover .akari-channel-check { width:14px; text-align:right; }
.akari-channel-popover .akari-channel-row > span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-channel-area { min-height:0; overflow-y:auto; }
.akari-channel-about { flex:1 1 auto; }
.akari-channel-projects { flex:0 0 auto; margin-top:auto; max-height:40%; }
.akari-channel-section { margin:0 0 12px; padding-top:12px; border-top:1px solid var(--akari-line,var(--theia-widget-border)); font-size:11px; opacity:.65; font-weight:700; }
.akari-channel-row { display:flex; width:100%; align-items:center; gap:8px; box-sizing:border-box; border:0; border-radius:7px; padding:8px; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.akari-channel-row:hover { background:var(--theia-list-hoverBackground,rgba(127,127,127,.12)); }
.akari-channel-row[aria-current="page"] { background:var(--theia-list-activeSelectionBackground,rgba(127,127,127,.16)); }
.akari-channel-row small { margin-left:auto; opacity:.6; white-space:nowrap; }
.akari-channel-doc-row { display:flex; align-items:center; gap:4px; }
.akari-channel-doc-row > .akari-channel-row { min-width:0; flex:1; }
.akari-channel-doc-row > small { margin-right:8px; opacity:.6; }
.akari-channel-create { flex:0 0 auto; border:0; border-radius:5px; padding:4px 7px; background:var(--theia-button-secondaryBackground); color:var(--theia-button-secondaryForeground); cursor:pointer; }
.akari-channel-project-card { display:flex; align-items:center; gap:8px; }
.akari-channel-project-thumb { display:block; flex:0 0 56px; box-sizing:border-box; width:56px; height:32px; overflow:hidden; border:1px solid var(--akari-line,var(--theia-widget-border)); border-radius:3px; background:var(--theia-editor-background); }
.akari-channel-project-thumb img { display:block; width:100%; height:100%; object-fit:cover; }
.akari-channel-project-body { display:flex; flex-direction:column; min-width:0; gap:3px; }
.akari-channel-project-body > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-channel-project-body small { margin-left:0; }
.akari-channel-row-hint { display:block; opacity:.6; font-size:11px; padding:0 8px 6px; }
.akari-channel-helper-menu { padding:0 0 4px 10px; }
`;

@injectable()
export class AkariChannelWidget extends ReactWidget {
    static readonly ID = CHANNEL_WIDGET_ID;
    @inject(AkariChannelContextService) protected readonly context!: AkariChannelContextService;
    @inject(AkariScopeService) protected readonly scope!: AkariScopeService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;
    @inject(FileService) protected readonly files!: FileService;
    @inject(AkariProjectService) protected readonly storeService!: AkariProjectService;
    @inject(ProjectProgressService) protected readonly progress!: ProjectProgressService;
    @inject(AkariSkillCatalogService) protected readonly skillCatalog!: AkariSkillCatalogService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    protected projectStages = new Map<string, string>();
    protected projectThumbnails = new Map<string, string[]>();
    protected channelDocFiles = new Map<ChannelDocKind, string>();
    protected channelSkills: ChannelSkillRow[] = [];
    protected akariSkills: { name: string; description: string }[] = [];
    protected docRefreshVersion = 0;
    protected memoryFiles?: ChannelMemoryFiles;
    protected memorySheet?: ChannelMemorySheetKind;
    protected memoryCounts = { people: 0, notes: 0, packs: 0 };
    protected popoverOpen = false;
    protected helperMenuOpen = false;
    protected sheet?: { kind: 'design-wizard'; answers?: ChannelAnswers; appliedType?: string; rest?: string }
        | { kind: 'design-start' }
        | { kind: 'types-catalog'; initialTypeId?: string; returnTo?: 'wizard' | 'view' }
        | { kind: 'types-apply'; type: ChannelTypeEntry; inputs: ApplyInputs; returnTo?: 'wizard' | 'view' }
        | { kind: 'helper-consent'; next: HelperKind }
        | { kind: 'design-view'; fileName: string; text: string; appliedType?: string; canUndo: boolean }
        | { kind: 'design-form'; values: DesignMdValues }
        | { kind: 'skills' };

    protected readonly onOutsidePointerDown = (event: PointerEvent): void => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        const heading = this.node.querySelector('.akari-channel-heading-button');
        const popover = this.node.querySelector('.akari-channel-popover');
        if (heading?.contains(target) || popover?.contains(target)) return;
        this.closePopover();
    };

    protected readonly onPopoverKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.closePopover();
    };

    @postConstruct()
    protected init(): void {
        this.memoryFiles = new ChannelMemoryFiles(this.files);
        this.id = AkariChannelWidget.ID;
        this.title.label = CHANNEL_WIDGET_LABEL;
        this.updateCaption();
        this.title.closable = false;
        this.addClass('akari-channel-widget');
        this.toDispose.push(this.context.onDidChange(() => { this.updateCaption(); this.update(); this.updateRailTab(); void this.refreshStages(); void this.refreshChannelDocs(); }));
        this.update();
        this.updateRailTab();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.installStyle();
        this.updateRailTab();
        setTimeout(() => this.updateRailTab(), 100);
        setTimeout(() => this.updateRailTab(), 500);
        void this.context.refresh();
        void this.refreshChannelDocs();
    }

    protected installStyle(): void {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    protected updateCaption(): void {
        this.title.caption = `${this.context.viewingChannel || 'チャンネル'} · チャンネルについて・プロジェクト一覧`;
    }

    protected togglePopover(): void {
        if (this.popoverOpen) { this.closePopover(); return; }
        this.popoverOpen = true;
        document.addEventListener('pointerdown', this.onOutsidePointerDown, true);
        document.addEventListener('keydown', this.onPopoverKeyDown, true);
        this.update();
    }

    protected closePopover(): void {
        document.removeEventListener('pointerdown', this.onOutsidePointerDown, true);
        document.removeEventListener('keydown', this.onPopoverKeyDown, true);
        if (this.popoverOpen) {
            this.popoverOpen = false;
            this.update();
        }
    }

    override dispose(): void {
        this.closePopover();
        super.dispose();
    }

    protected updateRailTab(): void {
        if (typeof document === 'undefined') return;
        const tab = document.querySelector<HTMLElement>(RAIL_TAB);
        if (!tab) return;
        tab.setAttribute('data-akari-channel-initial', (this.context.viewingChannel || 'チ').charAt(0));
    }

    protected async refreshStages(): Promise<void> {
        const projects = this.context.viewingChannel ? this.context.projectsOf(this.context.viewingChannel) : [];
        const stages = await Promise.all(projects.map(async project => {
            try { return [project.uri.toString(), stageSummary(await this.progress.readPresence(project.uri))] as const; }
            catch { return [project.uri.toString(), ''] as const; }
        }));
        this.projectStages = new Map(stages);
        const thumbnails = new Map<string, string[]>();
        for (const project of projects) {
            const key = project.uri.toString();
            try {
                const outcome = await this.storeService.resolveProjectCardThumbnails(key);
                thumbnails.set(key, outcome.available && outcome.frames?.length
                    ? outcome.frames.map(frame => project.uri.resolve(frame).toString()) : []);
            } catch { thumbnails.set(key, []); }
        }
        this.projectThumbnails = thumbnails;
        this.update();
    }

    protected async refreshChannelDocs(): Promise<void> {
        const version = ++this.docRefreshVersion;
        const root = this.context.rootUri;
        const channel = this.context.viewingChannel;
        const existing = new Set<string>();
        const skills: ChannelSkillRow[] = [];
        if (root && channel) {
            const dir = root.resolve('channels').resolve(channel);
            for (const kind of CHANNEL_DOC_KINDS) {
                const name = channelDocFileName(kind);
                try { if (await this.files.exists(dir.resolve(name))) existing.add(name); } catch { /* 表示は作成可能な状態にする。 */ }
            }
            try {
                const skillDirs = (await this.files.resolve(dir.resolve('skills'))).children ?? [];
                for (const skillDir of skillDirs.filter(item => item.isDirectory)) {
                    try {
                        const text = (await this.files.readFile(skillDir.resource.resolve('SKILL.md'))).value.toString();
                        const parsed = parseSkillMd(text);
                        if (parsed && !validateSkillSlug(parsed.slug) && skillDir.resource.path.base === parsed.slug) skills.push(parsed);
                    } catch { /* 読めないスキルは一覧から除く。 */ }
                }
            } catch { /* skills がまだ無ければ空の一覧にする。 */ }
        }
        if (version !== this.docRefreshVersion) return;
        this.channelDocFiles = new Map(CHANNEL_DOC_KINDS.flatMap(kind => {
            const name = resolveChannelDocFileName(kind, candidate => existing.has(candidate));
            return name ? [[kind, name] as const] : [];
        }));
        this.channelSkills = skills.sort((left, right) => left.slug.localeCompare(right.slug));
        const counts = root && channel && this.memoryFiles
            ? await readChannelMemoryCounts(this.memoryFiles, this.memoryFiles.channelDir(root, channel))
            : { people: 0, notes: 0, packs: 0 };
        if (version !== this.docRefreshVersion) return;
        this.memoryCounts = counts;
        this.update();
    }

    protected openMemorySheet(kind?: ChannelMemorySheetKind): void { this.memorySheet = kind; this.update(); }

    protected async openChannelDoc(kind: ChannelDocKind): Promise<void> {
        const root = this.context.rootUri;
        const channel = this.context.viewingChannel;
        if (!root || !channel) return;
        const dir = root.resolve('channels').resolve(channel);
        let name = channelDocFileName(kind);
        if (kind === 'channel' && !await this.files.exists(dir.resolve(name)) && await this.files.exists(dir.resolve('design.md'))) {
            name = 'design.md';
        }
        const uri = dir.resolve(name);
        try {
            if (!await this.files.exists(uri)) await this.files.create(uri, channelDocTemplate(kind, channel));
            await open(this.openerService, uri);
            void this.refreshChannelDocs();
        } catch { this.messages.error('文書を開けませんでした'); }
    }

    protected channelFile(name: string) {
        const root = this.context.rootUri;
        const channel = this.context.viewingChannel;
        return root && channel ? root.resolve('channels').resolve(channel).resolve(name) : undefined;
    }

    protected closeSheet = (): void => { this.sheet = undefined; this.update(); };

    protected async openDesignSheet(): Promise<void> {
        const uri = this.channelFile('channel.md');
        if (!uri) return;
        try {
            const legacyUri = this.channelFile('design.md');
            const existing = new Set<string>();
            if (await this.files.exists(uri)) existing.add('channel.md');
            if (legacyUri && await this.files.exists(legacyUri)) existing.add('design.md');
            const fileName = resolveChannelDocFileName('channel', name => existing.has(name));
            if (fileName) {
                const file = this.channelFile(fileName);
                if (!file) return;
                const text = (await this.files.readFile(file)).value.toString();
                this.sheet = { kind: 'design-view', fileName, text,
                    appliedType: fileName === 'channel.md' ? appliedTypeName(text) : undefined,
                    canUndo: fileName === 'channel.md' && !!this.channelFile('.akari/type-undo.json')
                        && await this.files.exists(this.channelFile('.akari/type-undo.json')!) };
            } else this.sheet = { kind: 'design-start' };
            this.update();
        } catch { void this.messages.error('チャンネル設計を読めませんでした'); }
    }

    protected async openDesignMdSheet(): Promise<void> {
        const uri = this.channelFile('design.md');
        if (!uri) return;
        try {
            this.sheet = { kind: 'design-form', values: await this.files.exists(uri)
                ? parseDesignMd((await this.files.readFile(uri)).value.toString()) : defaultDesignValues() };
            this.update();
        } catch { void this.messages.error('デザインを読めませんでした'); }
    }

    protected async openSkillsSheet(): Promise<void> {
        this.sheet = { kind: 'skills' };
        this.update();
        try {
            const root = this.context.currentProjectUri ?? (await this.workspace.roots)[0]?.resource;
            this.akariSkills = await this.skillCatalog.loadSkills(root);
        }
        catch { this.akariSkills = []; }
        if (this.sheet?.kind === 'skills') this.update();
    }

    protected async addChannelSkill(draft: ChannelSkillDraft): Promise<void> {
        const uri = this.channelFile(`skills/${draft.slug}/SKILL.md`);
        if (!uri || validateSkillSlug(draft.slug)) return;
        try {
            if (await this.files.exists(uri)) { void this.messages.warn(`/${draft.slug} はもうあります`); return; }
            await this.files.create(uri, buildSkillMd(draft));
            void this.messages.info(`/${draft.slug} を足しました`);
            await this.refreshChannelDocs();
        } catch { void this.messages.error(`/${draft.slug} を足せませんでした`); }
    }

    protected async copyAkariSkill(name: string): Promise<void> {
        if (validateSkillSlug(name) || !this.akariSkills.some(skill => skill.name === name)) return;
        const root = this.context.currentProjectUri ?? (await this.workspace.roots)[0]?.resource;
        const uri = this.channelFile(`skills/my-${name}/SKILL.md`);
        if (!root || !uri) return;
        try {
            if (await this.files.exists(uri)) { void this.messages.warn(`/my-${name} はもうあります`); return; }
            const source = (await this.files.readFile(root.resolve(`.claude/skills/${name}/SKILL.md`))).value.toString();
            await this.files.create(uri, copiedSkillMd(name, source));
            void this.messages.info(`/my-${name} として写しました。元の /${name} は Akari の更新で変わりますが、写しは変わりません`);
            await this.refreshChannelDocs();
        } catch { void this.messages.error(`/${name} を写せませんでした`); }
    }

    protected async openChannelSkill(slug: string): Promise<void> {
        const uri = this.channelFile(`skills/${slug}/SKILL.md`);
        if (!uri || validateSkillSlug(slug)) return;
        try { await open(this.openerService, uri); }
        catch { void this.messages.error(`/${slug} を開けませんでした`); }
    }

    protected async removeChannelSkill(slug: string): Promise<void> {
        const dir = this.channelFile(`skills/${slug}`);
        if (!dir || validateSkillSlug(slug)) return;
        try {
            await this.files.delete(dir, { recursive: true });
            void this.messages.info(`/${slug} を消しました`);
            await this.refreshChannelDocs();
        } catch { void this.messages.error(`/${slug} を消せませんでした`); }
    }

    protected async saveSheetFile(name: string, text: string): Promise<void> {
        const uri = this.channelFile(name);
        if (!uri) return;
        try {
            if (await this.files.exists(uri)) await this.files.writeFile(uri, BinaryBuffer.fromString(text));
            else await this.files.create(uri, text);
            void this.messages.info(name === 'channel.md' ? 'channel.md を書きました' : 'design.md を書きました');
            this.closeSheet();
            await this.refreshChannelDocs();
        } catch { void this.messages.error(`${name} を書けませんでした`); }
    }

    protected async saveMyType(): Promise<void> {
        const channelName = this.context.viewingChannel;
        const root = this.channelFile('.akari');
        if (!root || !channelName) return;
        try {
            const read = async (name: string): Promise<string | undefined> => {
                const uri = this.channelFile(name);
                return uri && await this.files.exists(uri) ? (await this.files.readFile(uri)).value.toString() : undefined;
            };
            const text = buildMyTypeJson({ channelName, channelMd: await read('channel.md'), designMd: await read('design.md'),
                skillSlugs: this.channelSkills.map(skill => skill.slug), now: new Date().toISOString() });
            if (!await this.files.exists(root)) await this.files.createFolder(root);
            const uri = root.resolve('my-type.json');
            if (await this.files.exists(uri)) await this.files.writeFile(uri, BinaryBuffer.fromString(text));
            else await this.files.create(uri, text);
            void this.messages.info('自分の型として残しました。人に公開するかはあとで選べます');
        } catch { void this.messages.error('自分の型を残せませんでした'); }
    }

    protected async openSheetFile(name: string, text?: string): Promise<void> {
        const uri = this.channelFile(name);
        if (!uri) return;
        try {
            if (!await this.files.exists(uri) && text !== undefined) {
                await this.files.create(uri, text);
                await this.refreshChannelDocs();
            }
            await open(this.openerService, uri);
            this.closeSheet();
        } catch { void this.messages.error('文書を開けませんでした'); }
    }

    protected async askPartner(prompt: string): Promise<void> {
        this.closeSheet();
        await this.commands.executeCommand(AKARI_COMMANDS.partnerOpen).catch(() => undefined);
        const result = await this.commands.executeCommand(AKARI_COMMANDS.partnerTypePrompt, prompt).catch(() => 'unsupported');
        if (result === 'no-partner') void this.messages.info('右の「パートナー」からパートナーを開くと、一緒に設計できます');
    }

    protected async readChannelText(path: string): Promise<string | undefined> {
        const uri = this.channelFile(path);
        return uri && await this.files.exists(uri) ? (await this.files.readFile(uri)).value.toString() : undefined;
    }

    protected async writeChannelText(path: string, value: string): Promise<void> {
        const uri = this.channelFile(path);
        if (!uri) throw new Error('チャンネルがありません');
        const parts = path.split('/');
        for (let index = 1; index < parts.length; index++) {
            const folder = this.channelFile(parts.slice(0, index).join('/'));
            if (folder && !await this.files.exists(folder)) await this.files.createFolder(folder);
        }
        if (await this.files.exists(uri)) await this.files.writeFile(uri, BinaryBuffer.fromString(value));
        else await this.files.create(uri, value);
    }

    protected async openTypeApply(type: ChannelTypeEntry): Promise<void> {
        const returnTo = this.sheet?.kind === 'types-catalog' ? this.sheet.returnTo : undefined;
        try {
            const [channelMd, designMd, wordBookText, notesText] = await Promise.all([
                this.readChannelText('channel.md'), this.readChannelText('design.md'),
                this.readChannelText('.akari/memory/word-book.json'), this.readChannelText('.akari/memory/notes.json')
            ]);
            const existingSkillTexts: Record<string, string> = {};
            for (const skill of this.channelSkills) {
                const value = await this.readChannelText(`skills/${skill.slug}/SKILL.md`);
                if (value !== undefined) existingSkillTexts[skill.slug] = value;
            }
            this.sheet = { kind: 'types-apply', type, returnTo, inputs: { channelMd, designMd, wordBookText, notesText,
                existingSkillSlugs: this.channelSkills.map(skill => skill.slug), existingSkillTexts } };
            this.update();
        } catch { void this.messages.error('型の重なりを読めませんでした'); }
    }

    protected async applyType(type: ChannelTypeEntry, inputs: ApplyInputs, choices: ApplyChoices): Promise<void> {
        const channelName = this.context.viewingChannel;
        if (!channelName) return;
        try {
            const { writes, undo } = planTypeApply(type, inputs, choices, channelName, new Date().toISOString());
            for (const [path, value] of Object.entries(writes)) await this.writeChannelText(path, value);
            await this.writeChannelText('.akari/type-undo.json', JSON.stringify(undo, null, 2));
            void this.messages.info(`「${type.name}」を当てました。テンプレ・字幕スタイル・スキルの下書きが入ります`);
            await this.refreshChannelDocs();
            await this.openDesignSheet();
        } catch { void this.messages.error('型を当てられませんでした'); }
    }

    protected async undoType(): Promise<void> {
        try {
            const undo = parseTypeUndo(await this.readChannelText('.akari/type-undo.json'));
            if (!undo) throw new Error('戻す記録がありません');
            for (const [path, value] of Object.entries(undo.files)) {
                const uri = this.channelFile(path);
                if (!uri) throw new Error('チャンネルがありません');
                if (value !== null) await this.writeChannelText(path, value);
                else if (path.startsWith('skills/')) {
                    const dir = this.channelFile(path.split('/').slice(0, 2).join('/'));
                    if (dir && await this.files.exists(dir)) await this.files.delete(dir, { recursive: true });
                } else if (await this.files.exists(uri)) await this.files.delete(uri);
            }
            const undoFile = this.channelFile('.akari/type-undo.json');
            if (undoFile && await this.files.exists(undoFile)) await this.files.delete(undoFile);
            void this.messages.info('1 つ前に戻しました');
            await this.refreshChannelDocs();
            await this.openDesignSheet();
        } catch { void this.messages.error('1 つ前に戻せませんでした'); }
    }

    protected async runHelper(kind: HelperKind): Promise<void> {
        if (!this.context.viewingChannel) return;
        this.helperMenuOpen = false;
        try {
            if (!parseHelperConsent(await this.readChannelText('.akari/helper.json'))) {
                this.sheet = { kind: 'helper-consent', next: kind };
                this.update();
                return;
            }
            await this.askHelper(kind);
        } catch { void this.messages.error('ヘルパーを開けませんでした'); }
    }

    protected async allowHelper(kind: HelperKind): Promise<void> {
        try {
            await this.writeChannelText('.akari/helper.json', buildHelperConsent(new Date().toISOString()));
            await this.askHelper(kind);
        } catch { void this.messages.error('ヘルパーの確認を保存できませんでした'); }
    }

    protected async askHelper(kind: HelperKind): Promise<void> {
        const channelName = this.context.viewingChannel;
        if (!channelName) return;
        this.closeSheet();
        await this.commands.executeCommand(AKARI_COMMANDS.partnerOpen).catch(() => undefined);
        const result = await this.commands.executeCommand(AKARI_COMMANDS.partnerTypePrompt, helperPrompt(kind, channelName)).catch(() => 'unsupported');
        if (result === 'no-partner') void this.messages.info(HELPER_NO_PARTNER_TEXT);
    }

    protected async openProjectList(): Promise<void> {
        const channel = this.context.viewingChannel;
        await this.commands.executeCommand(AKARI_COMMANDS.openProjectList, ...(channel ? [{ channel }] : []));
    }

    protected async chooseChannel(name: string): Promise<void> {
        this.closePopover();
        if (name === '__new__') {
            await this.commands.executeCommand('akari.home.newChannel');
            return;
        }
        this.closeSheet();
        this.context.setViewingChannel(name);
        this.updateCaption();
        if (this.scope.scope === 'project') await this.openProjectList();
    }

    protected async openProject(project: ChannelProject, target: HTMLElement): Promise<void> {
        const rect = target.getBoundingClientRect();
        await this.commands.executeCommand(AKARI_COMMANDS.openProject, {
            uri: project.uri.toString(), originRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        });
    }

    protected override render(): React.ReactNode {
        const channel = this.context.viewingChannel;
        const projects = channel ? this.context.projectsOf(channel) : [];
        return <div className='akari-channel-panel'>
            <div className='akari-channel-heading'>
                <button type='button' className='akari-channel-heading-button' aria-haspopup='menu' aria-expanded={this.popoverOpen}
                    onClick={() => this.togglePopover()}>{channel || 'チャンネル'} ▾</button>
                {this.popoverOpen && <div className='akari-channel-popover' role='menu' aria-label='チャンネルを切り替える'>
                    {this.context.channels.map(name => <button key={name} type='button' className='akari-channel-row'
                        role='menuitemradio' aria-checked={channel === name} onClick={() => void this.chooseChannel(name)}>
                        <span>{name}</span><small>プロジェクト {this.context.projectsOf(name).length}</small>
                        <span className='akari-channel-check' aria-hidden='true'>{channel === name ? '✓' : ''}</span>
                    </button>)}
                    <hr />
                    <button type='button' className='akari-channel-row' role='menuitem'
                        onClick={() => void this.chooseChannel('__new__')}>新しいチャンネル…</button>
                </div>}
            </div>
            <div className='akari-channel-area akari-channel-about'>
                <div className='akari-channel-section'>このチャンネル</div>
                <button type='button' className='akari-channel-row' aria-current={this.scope.scope === 'channel' ? 'page' : undefined}
                    onClick={() => void this.openProjectList()}>プロジェクト一覧</button>
                {CHANNEL_DOC_KINDS.map(kind => <div className='akari-channel-doc-row' key={kind}>
                    <button type='button' className='akari-channel-row' onClick={() => kind === 'people' || kind === 'notes' ? this.openMemorySheet(kind)
                        : void (kind === 'channel' ? this.openDesignSheet() : this.openDesignMdSheet())}>
                        {{ channel: 'チャンネル設計', design: 'デザイン', people: '人とモノ', notes: '辞書とメモ' }[kind]}
                    </button>
                    {kind === 'people' || kind === 'notes'
                        ? <small>{kind === 'people' ? `${this.memoryCounts.people} 件${this.memoryCounts.packs > 0 ? ` · ☆${this.memoryCounts.packs}` : ''}` : `${this.memoryCounts.notes} 件`}</small>
                        : this.channelDocFiles.has(kind) ? <small>あり</small>
                        : <button type='button' className='akari-channel-create' onClick={() => void (kind === 'channel' ? this.openDesignSheet() : this.openDesignMdSheet())}>作る</button>}
                </div>)}
                <div className='akari-channel-doc-row'><button type='button' className='akari-channel-row' onClick={() => void this.openSkillsSheet()}>スキル</button>
                    <small>{this.channelSkills.length} 個</small></div>
                <div className='akari-channel-doc-row'><button type='button' className='akari-channel-row' data-akari-helper-row
                    onClick={() => void this.runHelper('default')}>ヘルパー</button>
                    <button type='button' className='akari-channel-create' data-akari-helper-menu aria-expanded={this.helperMenuOpen}
                        onClick={() => { this.helperMenuOpen = !this.helperMenuOpen; this.update(); }}>▾</button></div>
                <small className='akari-channel-row-hint'>{HELPER_ROW_DESCRIPTION}</small>
                {this.helperMenuOpen && <div className='akari-channel-helper-menu'>{HELPER_KINDS.map(kind =>
                    <button key={kind} type='button' className='akari-channel-row' data-akari-helper-kind={kind}
                        onClick={() => void this.runHelper(kind)}>{HELPER_KIND_LABELS[kind]}</button>)}</div>}
            </div>
            <div className='akari-channel-area akari-channel-projects'>
                <div className='akari-channel-section'>プロジェクト</div>
                {projects.map(project => <button key={project.uri.toString()} type='button' className='akari-channel-row akari-channel-project-card'
                aria-current={this.context.currentProjectUri?.toString() === project.uri.toString() ? 'page' : undefined}
                onClick={event => void this.openProject(project, event.currentTarget)}>
                    <span className='akari-channel-project-thumb'>{this.projectThumbnails.get(project.uri.toString())?.[0]
                        ? <img src={this.projectThumbnails.get(project.uri.toString())?.[0]} alt='' /> : <span />}</span>
                    <span className='akari-channel-project-body'><span>{project.title || project.name}</span>
                        <small>{this.context.currentProjectUri?.toString() === project.uri.toString() ? '開いています' : this.projectStages.get(project.uri.toString()) ?? ''}</small></span>
                </button>)}
            </div>
            {this.sheet?.kind === 'design-start' && <ChannelDesignStart
                onFromType={() => { this.sheet = { kind: 'types-catalog' }; this.update(); }}
                onFromQuestions={() => { this.sheet = { kind: 'design-wizard' }; this.update(); }} onClose={this.closeSheet} />}
            {this.sheet?.kind === 'types-catalog' && <ChannelTypesCatalog channelName={channel || ''}
                initialTypeId={this.sheet.initialTypeId}
                onApply={type => void this.openTypeApply(type)}
                onSaveMyType={() => void this.saveMyType()} onClose={this.closeSheet} />}
            {this.sheet?.kind === 'types-apply' && <ChannelTypeApplySheet type={this.sheet.type} channelName={channel || ''}
                inputs={this.sheet.inputs} onApply={choices => {
                    if (this.sheet?.kind === 'types-apply') void this.applyType(this.sheet.type, this.sheet.inputs, choices);
                }} onBack={() => {
                    if (this.sheet?.kind !== 'types-apply') return;
                    this.sheet = { kind: 'types-catalog', initialTypeId: this.sheet.type.id, returnTo: this.sheet.returnTo };
                    this.update();
                }} onClose={this.closeSheet} />}
            {this.sheet?.kind === 'helper-consent' && <HelperConsentSheet channelName={channel || ''}
                onAllow={() => { if (this.sheet?.kind === 'helper-consent') void this.allowHelper(this.sheet.next); }}
                onCancel={this.closeSheet} />}
            {this.sheet?.kind === 'design-wizard' && <ChannelDesignWizard channelName={channel || ''}
                initialAnswers={this.sheet.answers} initialAppliedType={this.sheet.appliedType} rest={this.sheet.rest} hasProKey={false}
                onCreate={markdown => void this.saveSheetFile('channel.md', markdown)}
                onPartner={answers => void this.askPartner(channelDesignPartnerPrompt(answers))}
                onNotice={text => { void this.messages.info(text); }}
                onCatalog={() => { this.sheet = { kind: 'types-catalog', returnTo: 'wizard' }; this.update(); }}
                onClose={this.closeSheet} />}
            {this.sheet?.kind === 'design-view' && <ChannelDesignView fileName={this.sheet.fileName} text={this.sheet.text}
                banner={this.sheet.appliedType && <ChannelTypeBanner typeName={this.sheet.appliedType} canUndo={this.sheet.canUndo}
                    onCatalog={() => {
                        const typeId = this.sheet?.kind === 'design-view' ? findChannelTypeByName(this.sheet.appliedType ?? '')?.id : undefined;
                        this.sheet = { kind: 'types-catalog', initialTypeId: typeId, returnTo: 'view' };
                        this.update();
                    }} onUndo={() => void this.undoType()} />}
                onRedesign={() => {
                    const parsed = this.sheet?.kind === 'design-view' && this.sheet.fileName === 'channel.md'
                        ? parseChannelMarkdown(this.sheet.text) : undefined;
                    this.sheet = { kind: 'design-wizard', answers: parsed?.answers, appliedType: parsed?.appliedType, rest: parsed?.rest };
                    this.update();
                }}
                onOpenFile={() => { if (this.sheet?.kind === 'design-view') void this.openSheetFile(this.sheet.fileName); }}
                onPartner={() => void this.askPartner('/channel-design channel.md を読んで、ほかとの違い・見る人の困りごと・続けられる量を一緒に深掘りしてください')}
                onHelper={() => void this.runHelper('default')}
                onCatalog={() => {
                    const typeId = this.sheet?.kind === 'design-view' ? findChannelTypeByName(parseChannelMarkdown(this.sheet.text).appliedType ?? '')?.id : undefined;
                    this.sheet = { kind: 'types-catalog', initialTypeId: typeId, returnTo: 'view' };
                    this.update();
                }}
                onClose={this.closeSheet} />}
            {this.sheet?.kind === 'design-form' && <DesignMdForm channelName={channel || ''} initial={this.sheet.values}
                onSave={text => void this.saveSheetFile('design.md', text)}
                onOpenFile={text => void this.openSheetFile('design.md', text)} onHelper={() => void this.runHelper('design')}
                onClose={this.closeSheet} />}
            {this.sheet?.kind === 'skills' && <ChannelSkillsSheet skills={this.channelSkills} presets={PRESET_CHANNEL_SKILLS} akariSkills={this.akariSkills}
                onAddPreset={draft => void this.addChannelSkill(draft)} onCreate={draft => void this.addChannelSkill(draft)}
                onCopyAkari={name => void this.copyAkariSkill(name)} onOpen={slug => void this.openChannelSkill(slug)}
                onRemove={slug => void this.removeChannelSkill(slug)} onClose={this.closeSheet} />}
            <ChannelMemorySheets open={this.memorySheet} channel={channel} root={this.context.rootUri} files={this.memoryFiles!}
                onClose={() => this.openMemorySheet(undefined)} onOpen={kind => this.openMemorySheet(kind)}
                onTypePrompt={text => void this.commands.executeCommand('akari.partner.typePrompt', text)}
                onChanged={() => void this.refreshChannelDocs()} />
        </div>;
    }
}
