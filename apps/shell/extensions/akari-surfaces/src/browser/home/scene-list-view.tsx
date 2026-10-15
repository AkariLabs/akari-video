import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { QuickInputService } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { formatDate, t } from '@akari-video/i18n';
import { readSceneList, SceneRow } from './scene-list';

export interface SceneListViewProps {
    root: URI;
    files: Pick<FileService, 'resolve' | 'readFile'>;
    input: Pick<QuickInputService, 'input'>;
    projectService: { addScene(rootUri: string, id: string): Promise<unknown> };
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
`;

export function SceneListView({ root, files, input, projectService, onOpen, onError }: SceneListViewProps): React.ReactElement {
    const [rows, setRows] = React.useState<SceneRow[]>([]);
    React.useEffect(() => {
        let active = true;
        void readSceneList(files, root).then(value => { if (active) setRows(value); });
        return () => { active = false; };
    }, [root.toString(), files]);

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
        <h1>{t('surfaces.home.sceneList.heading')}</h1>
        <div className='akari-os-scene-grid'>{rows.map(row => <article key={row.id} className='akari-os-card akari-os-scene-card' data-akari-scene-card={row.id}>
            <b>{row.title}</b><small>{row.duration ?? '—'} · {t('surfaces.home.sceneAssets.label', { count: row.assets, n: row.assets })}</small>
            <small>{t('surfaces.home.projectLastUpdated.label', { date: row.updatedAt
                ? formatDate(new Date(row.updatedAt)) : t('surfaces.projects.projectCardUpdateDateUnavailable.label') })}</small>
            <button type='button' data-akari-open-scene={row.id} onClick={() => onOpen(row.uri)}>{t('surfaces.home.sceneOpen.button')}</button>
        </article>)}</div>
        <button type='button' className='akari-os-scene-add' data-akari-add-scene='true' onClick={() => void add()}>{t('surfaces.home.sceneAdd.button')}</button>
    </section>;
}
