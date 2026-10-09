import * as React from '@theia/core/shared/react';
import * as ReactDOM from '@theia/core/shared/react-dom';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import { CommandRegistry, CommandService, DisposableCollection, MessageService } from '@theia/core/lib/common';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { SkillEntry } from '../../common/skill-catalog';
import { AKARI_COMMANDS, RAIL_SKILLS_WIDGET_ID } from '../../common/rail-ids';
import { AkariSkillCatalogService } from '../akari-skill-catalog-service';
import { SKILLS_PANEL_TEXT, groupSkillsByCategory, skillAskOutcomeMessage, skillPromptText } from './skills-panel-model';
import { SkillPictogram } from './skill-pictograms';
import { readProjectTitle } from './project-title';

export function skillDescriptionLead(description: string): string {
    // 先頭の引用符（SKILL.md の description が "…" で始まるもの）は見せない
    const text = description.replace(/^["'“”「『]+/, '');
    const boundary = text.search(/[。（—:]/);
    return boundary < 0 ? text : text.slice(0, boundary);
}

const panelCss = `
.akari-skills-panel { box-sizing: border-box; height: 100%; overflow: auto; padding: 12px; color: var(--theia-foreground); font-size: var(--theia-ui-font-size1); }
.akari-skills-panel h2 { margin: 0 0 3px; font-size: 1.2em; font-weight: 600; }
.akari-skills-panel .subtitle { margin: 0 0 13px; color: var(--theia-descriptionForeground); font-size: 11px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; white-space: normal; overflow: hidden; }
.akari-skills-panel .skill-group { margin: 0 0 10px; }
.akari-skills-panel .skill-group h3 { margin: 0 0 5px; padding: 6px 0 2px; border-top: 1px solid var(--theia-panel-border); color: var(--theia-descriptionForeground); font-size: 11px; }
.akari-skills-panel .skill-list { display: flex; flex-direction: column; gap: 5px; list-style: none; padding: 0; margin: 0; }
.akari-skills-panel .skill-card { box-sizing: border-box; display: flex; align-items: center; gap: 5px; width: 100%; min-height: 64px; padding: 5px; border: 0; border-radius: 8px; background: var(--theia-editorWidget-background); color: var(--theia-foreground); cursor: pointer; }
.akari-skills-panel .skill-card:hover,.akari-skills-panel .skill-card:focus-visible { background: var(--theia-list-hoverBackground); }
.akari-skills-panel .skill-card:focus-visible { outline: 2px solid var(--theia-focusBorder); outline-offset: 1px; }
.akari-skills-panel .skill-art { flex: none; display: flex; align-items: center; justify-content: center; width: 64px; height: 44px; border-radius: 5px; background: var(--theia-editor-background); color: var(--theia-descriptionForeground); }
.akari-skills-panel .skill-art svg { display: block; }
.akari-skills-panel .skill-copy { display: flex; flex-direction: column; justify-content: center; min-width: 0; flex: 1; line-height: 1.3; text-align: left; }
.akari-skills-panel .skill-name-row { display: flex; align-items: center; min-width: 0; width: 100%; }
.akari-skills-panel .skill-name { display: block; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-family: var(--theia-code-font-family); font-size: 11px; font-weight: 700; white-space: nowrap; }
.akari-skills-panel .skill-description { display: block; min-width: 0; font-size: 10px; color: var(--theia-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.akari-skills-panel .skill-more { flex: none; width: 18px; height: 20px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--theia-descriptionForeground); font-size: 17px; line-height: 17px; }
.akari-skills-panel .skill-more:hover,.akari-skills-panel .skill-more:focus-visible { background: var(--theia-list-hoverBackground); color: var(--theia-foreground); }
.akari-skills-panel button { cursor: pointer; }
.akari-skills-panel .add-section { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--theia-panel-border); }
.akari-skills-panel .add-section h3 { margin: 0 0 10px; font-size: 1em; font-weight: 600; }
.akari-skill-tip { box-sizing: border-box; position: fixed; width: 280px; z-index: 10000; padding: 12px; border: 1px solid var(--theia-panel-border); border-radius: 8px; background: var(--theia-editorWidget-background); color: var(--theia-foreground); box-shadow: 0 8px 24px rgba(0,0,0,.25); pointer-events: none; }
.akari-skill-tip strong,.akari-skill-tip code { display: block; overflow-wrap: anywhere; }
.akari-skill-tip code { margin-top: 3px; color: var(--theia-descriptionForeground); font-family: var(--theia-code-font-family); font-size: 11px; }
.akari-skill-tip p { margin: 9px 0 0; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.akari-skill-tip .project { color: var(--theia-descriptionForeground); font-size: 11px; }
.akari-skill-menu { box-sizing: border-box; position: fixed; z-index: 10001; min-width: 168px; padding: 4px; border: 1px solid var(--theia-panel-border); border-radius: 6px; background: var(--theia-editorWidget-background); box-shadow: 0 8px 24px rgba(0,0,0,.25); }
.akari-skill-menu button { display: block; width: 100%; padding: 7px 9px; border: 0; border-radius: 4px; background: transparent; color: var(--theia-foreground); text-align: left; font: inherit; cursor: pointer; }
.akari-skill-menu button:hover,.akari-skill-menu button:focus-visible { background: var(--theia-list-hoverBackground); }
`;

interface PopupState { skill: SkillEntry; rect: DOMRect }
interface TipState extends PopupState { panelRight: number }

function SkillsCards({ skills, projectName, onAsk, onCopy, onOpen }: {
    skills: SkillEntry[];
    projectName: string | undefined;
    onAsk: (name: string) => void;
    onCopy: (name: string) => void;
    onOpen: (name: string) => void;
}): React.ReactElement {
    const [tip, setTip] = React.useState<TipState>();
    const [menu, setMenu] = React.useState<PopupState>();
    const [tipTop, setTipTop] = React.useState(0);
    const timer = React.useRef<ReturnType<typeof setTimeout>>();
    const tipRef = React.useRef<HTMLDivElement>(null);
    const menuRef = React.useRef<HTMLDivElement>(null);
    const menuButtonRef = React.useRef<HTMLButtonElement | null>(null);

    const hideTip = (): void => { clearTimeout(timer.current); setTip(undefined); };
    const tipState = (skill: SkillEntry, target: HTMLElement): TipState => {
        const rect = target.getBoundingClientRect();
        const panel = target.closest('.lm-DockPanel, .theia-side-panel') || document.getElementById('theia-left-side-panel');
        return { skill, rect, panelRight: panel?.getBoundingClientRect().right ?? rect.right };
    };
    React.useLayoutEffect(() => {
        if (tip && tipRef.current) {
            setTipTop(Math.max(8, Math.min(tip.rect.top, window.innerHeight - tipRef.current.offsetHeight - 8)));
        }
    }, [tip]);
    React.useEffect(() => {
        if (!menu) return;
        const onPointerDown = (event: PointerEvent): void => {
            const target = event.target as Node;
            if (!menuRef.current?.contains(target) && !menuButtonRef.current?.contains(target)) setMenu(undefined);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') { setMenu(undefined); menuButtonRef.current?.focus(); }
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
    }, [menu]);
    React.useEffect(() => () => clearTimeout(timer.current), []);

    return <>
        {groupSkillsByCategory(skills).map(group => <section className='skill-group' key={group.category}>
            <h3>{group.label}</h3>
            <ul className='skill-list'>{group.skills.map(skill => <li key={skill.name}>
                <div className='skill-card' role='button' tabIndex={0} aria-label={`${skill.name} をパートナーに頼む`}
                    onMouseEnter={event => {
                        const nextTip = tipState(skill, event.currentTarget);
                        clearTimeout(timer.current);
                        timer.current = setTimeout(() => { if (!menu) setTip(nextTip); }, 350);
                    }}
                    onMouseLeave={hideTip}
                    onFocus={event => { if (event.target === event.currentTarget && !menu) setTip(tipState(skill, event.currentTarget)); }}
                    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) hideTip(); }}
                    onClick={() => onAsk(skill.name)}
                    onKeyDown={event => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault(); onAsk(skill.name);
                        }
                    }}>
                    <span className='skill-art'><SkillPictogram name={skill.name} category={group.category} /></span>
                    <span className='skill-copy'>
                        <span className='skill-name-row'><strong className='skill-name' title={`/${skill.name}`}>/{skill.name}</strong>
                            <button type='button' className='skill-more' aria-label={`${skill.name} のメニュー`} aria-haspopup='menu'
                                aria-expanded={menu?.skill.name === skill.name} onClick={event => {
                                    event.stopPropagation(); hideTip(); menuButtonRef.current = event.currentTarget;
                                    setMenu(menu?.skill.name === skill.name ? undefined : { skill, rect: event.currentTarget.getBoundingClientRect() });
                                }}>⋯</button></span>
                        <span className='skill-description'>{skillDescriptionLead(skill.description)}</span>
                    </span>
                </div>
            </li>)}</ul>
        </section>)}
        {tip && ReactDOM.createPortal(<div ref={tipRef} className='akari-skill-tip' role='tooltip'
            style={{ left: Math.max(8, Math.min(tip.panelRight + 8, window.innerWidth - 288)), top: tipTop || tip.rect.top }}>
            <strong>{tip.skill.name}</strong><code>/{tip.skill.name}</code>
            <p>{tip.skill.description}</p>
            {projectName && <p className='project'>いま開いている『{projectName}』に使います</p>}
        </div>, document.body)}
        {menu && ReactDOM.createPortal(<div ref={menuRef} className='akari-skill-menu' role='menu'
            style={{ left: Math.max(8, Math.min(menu.rect.right - 168, window.innerWidth - 176)), top: Math.max(8, Math.min(menu.rect.bottom + 4, window.innerHeight - 112)) }}>
            <button type='button' role='menuitem' onClick={() => { setMenu(undefined); onAsk(menu.skill.name); }}>パートナーに頼む</button>
            <button type='button' role='menuitem' onClick={() => { setMenu(undefined); onCopy(menu.skill.name); }}>呼び名をコピー</button>
            <button type='button' role='menuitem' onClick={() => { setMenu(undefined); onOpen(menu.skill.name); }}>SKILL.md を開く</button>
        </div>, document.body)}
    </>;
}

@injectable()
export class AkariSkillsWidget extends ReactWidget {
    static readonly ID = RAIL_SKILLS_WIDGET_ID;

    @inject(AkariSkillCatalogService) protected readonly catalog!: AkariSkillCatalogService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(FileService) protected readonly files!: FileService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(CommandRegistry) protected readonly registry!: CommandRegistry;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;

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
            const intakeUri = this.workspace.tryGetRoots()[0]?.resource.resolve('.akari/intake.json');
            if (event.changes.some(change =>
                (skillsUri && (skillsUri.isEqualOrParent(change.resource) || change.resource.isEqualOrParent(skillsUri)))
                || intakeUri?.isEqual(change.resource))) {
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
        try {
            this.watcher.push(this.files.watch(root.resolve('.akari'), { recursive: false, excludes: [] }));
        } catch { /* intake がまだない場合はフォルダ名を使う。 */ }
    }

    protected async reload(): Promise<void> {
        const version = ++this.loadVersion;
        const root = (await this.workspace.roots)[0]?.resource;
        const [skills, projectName] = await Promise.all([
            this.catalog.loadSkills(root), root ? readProjectTitle(this.files, root) : Promise.resolve(undefined)
        ]);
        if (version !== this.loadVersion || this.isDisposed) return;
        this.skills = skills;
        this.projectName = projectName;
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

    protected async copySkillName(name: string): Promise<void> {
        try { await navigator.clipboard.writeText(`/${name}`); }
        catch { void this.messages.warn('呼び名をコピーできませんでした'); }
    }

    protected async openSkill(name: string): Promise<void> {
        const root = (await this.workspace.roots)[0]?.resource;
        if (!root) return;
        try { await open(this.openerService, root.resolve('.claude/skills').resolve(name).resolve('SKILL.md')); }
        catch { void this.messages.warn('SKILL.md を開けませんでした'); }
    }

    protected override render(): React.ReactNode {
        return <div className='akari-skills-panel'>
            <style>{panelCss}</style>
            <h2>{SKILLS_PANEL_TEXT.heading}</h2>
            <p className='subtitle'>{SKILLS_PANEL_TEXT.subtitle}</p>
            {this.skills.length ? <SkillsCards skills={this.skills} projectName={this.projectName}
                onAsk={name => void this.askSkill(name)} onCopy={name => void this.copySkillName(name)}
                onOpen={name => void this.openSkill(name)} /> : <p>{SKILLS_PANEL_TEXT.empty}</p>}
            <section className='add-section'>
                <h3>足す</h3>
                <button className='theia-button secondary' onClick={() => void this.messages.info(SKILLS_PANEL_TEXT.addHint)}>{SKILLS_PANEL_TEXT.add}</button>
            </section>
        </div>;
    }
}
