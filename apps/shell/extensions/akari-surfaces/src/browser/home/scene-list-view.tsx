import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { QuickInputService } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { formatDate, t } from '@akari-video/i18n';
import { readSceneList, SceneRow } from './scene-list';
import { AkariProjectStructureService } from '../../common/project-structure-protocol';
import { buildStructureTree, StructureTree } from '../../common/project-structure-model';
import { InspectionBand } from './inspection-band';
import { StructureTreeView } from './structure-tree-view';
import { RelationsView } from './relations-view';
import { consumeStructureTab } from './structure-navigation';

export interface SceneListViewProps {
    root: URI;
    files: Pick<FileService, 'resolve' | 'readFile'>;
    input: Pick<QuickInputService, 'input'>;
    projectService: { addScene(rootUri: string, id: string): Promise<unknown> };
    structureService: AkariProjectStructureService;
    onOpen: (uri: URI) => void;
    onError: (message: string) => void;
}

export const sceneListCss = `
.akari-os-scene-list{display:flex;flex-direction:column;gap:20px;width:100%;max-width:1100px;margin:0 auto;padding:10px 4px 32px;box-sizing:border-box}
.akari-os-scene-list h1{margin:0;font-size:20px;line-height:1.4;font-weight:800}
.akari-os-scene-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:14px}
.akari-os-scene-list .akari-os-scene-card{display:flex;flex-direction:column;align-items:flex-start;gap:9px;min-width:0;min-height:150px;padding:16px 18px;border:1px solid var(--theia-widget-border);border-radius:11px;background:var(--theia-editorWidget-background);color:var(--theia-foreground);box-sizing:border-box;cursor:default}
.akari-os-scene-list .akari-os-scene-card:hover{outline:none;border-color:var(--theia-focusBorder)}
.akari-os-scene-card b{font-size:15px;line-height:1.4;overflow-wrap:anywhere}
.akari-os-scene-card small{display:block;color:var(--theia-descriptionForeground);font-size:11.5px;line-height:1.55}
.akari-os-scene-card button{align-self:flex-start;min-height:32px;margin-top:auto;padding:6px 15px;border:1px solid var(--theia-widget-border);border-radius:7px;background:var(--theia-button-secondaryBackground);color:var(--theia-button-secondaryForeground);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.akari-os-scene-card button:hover{border-color:var(--theia-focusBorder);filter:brightness(1.08)}
.akari-os-scene-add{align-self:flex-start;min-height:36px;padding:8px 15px;border:1px solid var(--theia-widget-border);border-radius:8px;background:var(--theia-button-background);color:var(--theia-button-foreground);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.akari-os-scene-add:hover{filter:brightness(1.08)}
.akari-os-scene-tabs{display:flex;gap:4px;border-bottom:1px solid var(--theia-widget-border)}
.akari-os-scene-tabs button{padding:9px 16px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--theia-foreground);cursor:pointer;font:inherit}
.akari-os-scene-tabs button[aria-selected=true]{border-bottom-color:var(--theia-focusBorder);font-weight:700}
`;

export function SceneListView({ root, files, input, projectService, structureService, onOpen, onError }: SceneListViewProps): React.ReactElement {
    const [rows, setRows] = React.useState<SceneRow[]>([]);
    const [tab, setTab] = React.useState<'scenes' | 'structure' | 'relations'>(() => consumeStructureTab(root) ?? 'scenes');
    const [tree, setTree] = React.useState<StructureTree>();
    const [checkRevision, setCheckRevision] = React.useState(0);
    React.useEffect(() => {
        let active = true;
        void readSceneList(files, root).then(value => { if (active) setRows(value); });
        return () => { active = false; };
    }, [root.toString(), files]);
    React.useEffect(() => {
        if (tab !== 'structure') return;
        let active = true;
        void structureService.readScenes(root.toString()).then(scenes => {
            if (active) setTree(buildStructureTree(root.path.base, scenes));
        }).catch(error => { if (active) onError(String(error)); });
        return () => { active = false; };
    }, [root.toString(), tab, structureService]);

    const add = async (): Promise<void> => {
        const id = (await input.input({ placeHolder: t('surfaces.home.sceneId.placeholder') }))?.trim();
        if (!id) return;
        try {
            await projectService.addScene(root.toString(), id);
            setRows(await readSceneList(files, root));
        } catch (error) { onError(String(error)); }
    };

    return <section className='akari-os-scene-list' data-akari-scene-list='true'>
        <style>{sceneListCss}</style>
        <InspectionBand key={checkRevision} root={root} service={structureService} onRelations={() => setTab('relations')} />
        <div className='akari-os-scene-tabs' role='tablist'>
            {(['scenes', 'structure', 'relations'] as const).map(id => <button key={id} type='button' role='tab' aria-selected={tab === id}
                data-akari-scene-tab={id} onClick={() => setTab(id)}>{t(`surfaces.structure.tab.${id}.label`)}</button>)}
        </div>
        {tab === 'scenes' && <><h1>{t('surfaces.home.sceneList.heading')}</h1>
        <div className='akari-os-scene-grid'>{rows.map(row => <article key={row.id} className='akari-os-card akari-os-scene-card' data-akari-scene-card={row.id}>
            <b>{row.title}</b><small>{row.duration ?? '—'} · {t('surfaces.home.sceneAssets.label', { count: row.assets, n: row.assets })}</small>
            <small>{t('surfaces.home.projectLastUpdated.label', { date: row.updatedAt
                ? formatDate(new Date(row.updatedAt)) : t('surfaces.projects.projectCardUpdateDateUnavailable.label') })}</small>
            <button type='button' data-akari-open-scene={row.id} onClick={() => onOpen(row.uri)}>{t('surfaces.home.sceneOpen.button')}</button>
        </article>)}</div>
        <button type='button' className='akari-os-scene-add' data-akari-add-scene='true' onClick={() => void add()}>{t('surfaces.home.sceneAdd.button')}</button>
        </>}
        {tab === 'structure' && tree && <StructureTreeView root={root} tree={tree} onOpen={onOpen} />}
        {tab === 'relations' && <RelationsView root={root} service={structureService} onOpenScene={onOpen} onError={onError}
            onSync={() => setCheckRevision(revision => revision + 1)} />}
    </section>;
}
