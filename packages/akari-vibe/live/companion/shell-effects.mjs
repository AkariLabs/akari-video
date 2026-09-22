export const FLY_TO_TARGET_KINDS = Object.freeze([
    'inspectorField', 'timelineItem', 'previewItem', 'daihonRow', 'catalogCard', 'menuSection',
]);

const command = (commandId, args) => ({
    kind:'command', command:{ commandId, ...(args === undefined ? {} : { args }) },
});
const flyTo = (kind, id) => ({ kind:'flyTo', flyTo:{ target:{ kind, id } } });

const firstSelection = selection => Array.isArray(selection) ? selection[0] : selection;

/**
 * One judge result becomes one ordered instruction list.  Callers resolve a
 * cut selection to its stable edit item id before entering this pure planner.
 * The single fly-to candidate with the highest priority wins, so one utterance
 * can never emit two light-dot animations.
 */
export function planShellEffects({ final = false, decision = {}, executed = false,
    navigateAt = null, selection = null, selectionItemId = null,
    previewSelection = true, inspectorOpenArgs = null, changedItemId = null,
    shellCommands = [], catalogOpen = null, zoneHint = null, flyAlreadySent = false } = {}) {
    const instructions=[];
    const commandKeys=new Set();
    let flyCandidate=null;
    const addCommand=(commandId,args)=>{
        const key=JSON.stringify([commandId,args]);
        if(commandKeys.has(key))return;
        commandKeys.add(key);instructions.push(command(commandId,args));
    };
    const considerFly=(priority,kind,id)=>{
        if(!FLY_TO_TARGET_KINDS.includes(kind)||typeof id!=='string'||!id)return;
        if(!flyCandidate||priority>flyCandidate.priority)flyCandidate={priority,kind,id};
    };

    if(Number.isFinite(navigateAt)){
        addCommand('akari.timeline.seek',{seconds:navigateAt});
        addCommand('akari.preview.seekOutput',{time:navigateAt});
        // previewItem uses the visible preview widget itself as its destination;
        // the public resolver deliberately does not inspect this id.
        considerFly(10,'previewItem','output-preview');
    }

    const selected=firstSelection(selection);
    if(typeof selected==='string'&&selected.startsWith('caption:')){
        const captionId=selected.slice(8);
        if(captionId){
            addCommand('akari.daihon.open',{captionId,pulse:true});
            considerFly(20,'daihonRow',captionId);
        }
    } else if(typeof selectionItemId==='string'&&selectionItemId){
        addCommand('akari.timeline.focusItem',{itemId:selectionItemId,seek:false,reveal:true,pulse:true});
        if(previewSelection){
            addCommand('akari.preview.ensureVisible',{});
            addCommand('akari.preview.pulseItem',{itemId:selectionItemId});
        }
        // 実物のタイムラインはカットの data-akari-item-id に edit.json の id ではなく並び順（0 始まり）を持つ
        // （実機の DOM で実測 2026-09-21）。cut:<n> のときだけ光の点の宛先を読み替える。
        const cutNumber=typeof selected==='string'&&/^cut:\d+$/.test(selected)?Number(selected.slice(4)):null;
        considerFly(20,'timelineItem',cutNumber?String(cutNumber-1):selectionItemId);
    }

    if(inspectorOpenArgs!==null){
        addCommand('akari.inspector.open',inspectorOpenArgs);
        if(typeof inspectorOpenArgs?.fieldName==='string')
            considerFly(40,'inspectorField',inspectorOpenArgs.fieldName);
    }

    if(catalogOpen&&typeof catalogOpen.assetId==='string'&&catalogOpen.assetId){
        addCommand('akari.catalog.open',catalogOpen);
        considerFly(35,'catalogCard',catalogOpen.assetId);
    }

    if(final&&executed&&decision.op==='shell_ui_open'){
        // The executor owns availability and compound-request guards. Only
        // replay command attempts captured from that path; never recalculate
        // a receiver from the catalog here.
        for(const row of shellCommands){
            if(typeof row?.commandId==='string')addCommand(row.commandId,row.args);
        }
        if(shellCommands.length===0){
            addCommand('akari.menu.focus',{section:'open',pulse:true});
            considerFly(30,'menuSection','open');
        }
    }

    if(final&&executed&&decision.op==='skill_dispatch'
        && typeof decision.skill_name==='string'&&decision.skill_name&&decision.skill_name!=='none'){
        addCommand('akari.menu.focus',{section:'skills',pulse:true,skill:decision.skill_name});
        considerFly(30,'menuSection','skills');
    }

    if(typeof changedItemId==='string'&&changedItemId){
        addCommand('akari.timeline.focusItem',{itemId:changedItemId,seek:false,reveal:true,pulse:true});
        addCommand('akari.preview.pulseItem',{itemId:changedItemId});
    }

    if(Array.isArray(zoneHint?.zones)&&zoneHint.zones.length){
        addCommand('akari.preview.showZoneHint',{zones:zoneHint.zones.slice(0,3),durationMs:zoneHint.durationMs});
    }

    if(flyCandidate&&!flyAlreadySent)instructions.push(flyTo(flyCandidate.kind,flyCandidate.id));
    return instructions;
}
