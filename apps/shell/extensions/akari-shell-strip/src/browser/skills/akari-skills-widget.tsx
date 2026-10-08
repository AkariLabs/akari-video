import * as React from '@theia/core/shared/react';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandRegistry, CommandService, DisposableCollection, MessageService } from '@theia/core/lib/common';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { SkillEntry } from '../../common/skill-catalog';
import { AKARI_COMMANDS, RAIL_SKILLS_WIDGET_ID } from '../../common/rail-ids';
import { AkariSkillCatalogService } from '../akari-skill-catalog-service';
import { SKILLS_PANEL_TEXT, skillAskOutcomeMessage, skillPromptText, skillsPanelNote } from './skills-panel-model';

const panelCss = `
.akari-skills-panel { box-sizing: border-box; height: 100%; overflow: auto; padding: 12px; color: var(--theia-foreground); font-size: var(--theia-ui-font-size1); }
.akari-skills-panel h2 { margin: 0 0 3px; font-size: 1.2em; font-weight: 600; }
.akari-skills-panel .subtitle, .akari-skills-panel .note, .akari-skills-panel .description { color: var(--theia-descriptionForeground); }
.akari-skills-panel .subtitle { margin: 0 0 12px; }
.akari-skills-panel .note { margin: 0 0 16px; line-height: 1.5; }
.akari-skills-panel ul { list-style: none; padding: 0; margin: 0; }
.akari-skills-panel li { padding: 11px 0; border-top: 1px solid var(--theia-panel-border); }
.akari-skills-panel .name { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.akari-skills-panel code { font-family: var(--theia-code-font-family); font-size: 0.95em; }
.akari-skills-panel .description { margin: 6px 0 9px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.akari-skills-panel button { cursor: pointer; }
.akari-skills-panel .add-section { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--theia-panel-border); }
.akari-skills-panel .add-section h3 { margin: 0 0 10px; font-size: 1em; font-weight: 600; }
`;

@injectable()
export class AkariSkillsWidget extends ReactWidget {
    static readonly ID = RAIL_SKILLS_WIDGET_ID;

    @inject(AkariSkillCatalogService) protected readonly catalog!: AkariSkillCatalogService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(FileService) protected readonly files!: FileService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(CommandRegistry) protected readonly registry!: CommandRegistry;
    @inject(MessageService) protected readonly messages!: MessageService;

    protected skills: SkillEntry[] = [];
    protected projectName: string | undefined;
    protected watcher = new DisposableCollection();
    protected watchVersion = 0;
    protected loadVersion = 0;
    protected skillsUri: URI | undefined;

    @postConstruct()
    protected init(): void {
        this.id = AkariSkillsWidget.ID;
        this.title.label = 'スキル';
        this.title.caption = 'パートナーに頼める決まった仕事（/呼び名）';
        this.title.iconClass = 'codicon codicon-zap';
        this.title.closable = false;
        this.toDispose.push({ dispose: () => this.watcher.dispose() });
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.watchRoot()));
        this.toDispose.push(this.files.onDidFilesChange(event => {
            const skillsUri = this.skillsUri;
            if (skillsUri && event.changes.some(change =>
                skillsUri.isEqualOrParent(change.resource) || change.resource.isEqualOrParent(skillsUri))) {
                void this.reload();
            }
        }));
        void this.watchRoot();
        this.update();
    }

    protected async watchRoot(): Promise<void> {
        const version = ++this.watchVersion;
        this.watcher.dispose();
        this.watcher = new DisposableCollection();
        this.skillsUri = undefined;
        await this.reload();
        const root = (await this.workspace.roots)[0]?.resource;
        if (version !== this.watchVersion || this.isDisposed || !root) return;
        const skillsUri = root.resolve('.claude/skills');
        this.skillsUri = skillsUri;
        try {
            const watcher = this.files.watch(skillsUri, { recursive: true, excludes: [] });
            if (version === this.watchVersion && !this.isDisposed) this.watcher.push(watcher);
            else watcher.dispose();
        } catch { /* スキルのフォルダがまだない場合も一覧は表示する。 */ }
    }

    protected async reload(): Promise<void> {
        const version = ++this.loadVersion;
        const root = (await this.workspace.roots)[0]?.resource;
        const skills = await this.catalog.loadSkills(root);
        if (version !== this.loadVersion || this.isDisposed) return;
        this.skills = skills;
        this.projectName = root?.path.base;
        this.update();
    }

    protected async askSkill(name: string): Promise<void> {
        let result: unknown;
        try {
            if (this.registry.getCommand(AKARI_COMMANDS.partnerTypePrompt)) {
                result = await this.commands.executeCommand(AKARI_COMMANDS.partnerTypePrompt, skillPromptText(name));
            }
        } catch { /* パートナーが閉じている場合と同じ案内を出す。 */ }
        if (result === 'unsupported') {
            try { await navigator.clipboard?.writeText(skillPromptText(name)); } catch { /* コピー不可でも案内を出す。 */ }
        }
        const message = skillAskOutcomeMessage(result, name);
        if (message.kind === 'warn') void this.messages.warn(message.text);
        if (message.kind === 'info') void this.messages.info(message.text);
    }

    protected override render(): React.ReactNode {
        const note = skillsPanelNote(this.projectName).split('`/呼び名`');
        return <div className='akari-skills-panel'>
            <style>{panelCss}</style>
            <h2>{SKILLS_PANEL_TEXT.heading}</h2>
            <p className='subtitle'>{SKILLS_PANEL_TEXT.subtitle}</p>
            <p className='note'>{note[0]}<code>/呼び名</code>{note[1]}</p>
            {this.skills.length ? <ul>{this.skills.map(skill => <li key={skill.name}>
                <div className='name'><strong>{skill.name}</strong><code>/{skill.name}</code></div>
                <p className='description'>{skill.description}</p>
                <button className='theia-button secondary' onClick={() => void this.askSkill(skill.name)}>{SKILLS_PANEL_TEXT.ask}</button>
            </li>)}</ul> : <p>{SKILLS_PANEL_TEXT.empty}</p>}
            <section className='add-section'>
                <h3>足す</h3>
                <button className='theia-button secondary' onClick={() => void this.messages.info(SKILLS_PANEL_TEXT.addHint)}>{SKILLS_PANEL_TEXT.add}</button>
            </section>
        </div>;
    }
}
