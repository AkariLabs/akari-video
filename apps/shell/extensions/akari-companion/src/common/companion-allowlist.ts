export const ALLOWED_COMMAND_IDS = [
    'akari.preview.ensureVisible', 'akari.preview.seekOutput', 'akari.preview.togglePlayback',
    'akari.preview.play', 'akari.preview.pause',
    'akari.preview.setFullscreen', 'akari.preview.setViewZoom', 'akari.preview.setPlaybackRate',
    'akari.preview.setLoopRange', 'akari.preview.enterCropMode', 'akari.preview.openPerspectivePanel',
    'akari.preview.pulseItem', 'akari.preview.showZoneHint',
    'akari.timeline.focusItem', 'akari.timeline.seek', 'akari.timeline.setView',
    'akari.timeline.setTool', 'akari.timeline.setSnap', 'akari.timeline.reveal',
    'akari.inspector.open', 'akari.daihon.open', 'akari.cuts.open', 'akari.transcribe.openDialog',
    'akari.catalog.open', 'akari.catalog.importAsset', 'akari.catalog.listCategories',
    'akari.menu.focus', 'akari.menu.listSkills', 'akari.menu.listOpenTargets',
    'akari.review.open', 'akari.review.board.open', 'akari.partner.open'
] as const;

export type AllowedCommandId = typeof ALLOWED_COMMAND_IDS[number];
export type ArgValidation = { ok: true; args: Record<string, unknown> | undefined } | { ok: false };

export function isAllowedCommandId(value: unknown): value is AllowedCommandId {
    return typeof value === 'string' && (ALLOWED_COMMAND_IDS as readonly string[]).includes(value);
}

export function isBoundedString(value: unknown, max = 512): value is string {
    return typeof value === 'string' && value.length <= max;
}

export function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

export function isBoundedArray(value: unknown, max = 32): value is unknown[] {
    return Array.isArray(value) && value.length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalObject(value: unknown): Record<string, unknown> | undefined | false {
    return value === undefined ? undefined : isRecord(value) ? value : false;
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return Object.keys(value).every(key => keys.includes(key));
}

function optional(value: Record<string, unknown>, key: string, predicate: (candidate: unknown) => boolean): boolean {
    return !(key in value) || predicate(value[key]);
}

function required(value: Record<string, unknown>, key: string, predicate: (candidate: unknown) => boolean): boolean {
    return key in value && predicate(value[key]);
}

function objectResult(value: unknown, keys: readonly string[], validate: (args: Record<string, unknown>) => boolean,
    allowUndefined = false): ArgValidation {
    const args = optionalObject(value);
    if (args === false || (args === undefined && !allowUndefined)) return { ok: false };
    if (args === undefined) return { ok: true, args: undefined };
    return hasOnly(args, keys) && validate(args) ? { ok: true, args } : { ok: false };
}

function noArgs(value: unknown): ArgValidation {
    if (value === undefined) return { ok: true, args: undefined };
    return isRecord(value) && Object.keys(value).length === 0 ? { ok: true, args: value } : { ok: false };
}

const bounded = (value: unknown): boolean => isBoundedString(value);
const finite = (value: unknown): boolean => isFiniteNumber(value);
const boolean = (value: unknown): boolean => typeof value === 'boolean';
const positive = (value: unknown): boolean => isFiniteNumber(value) && value > 0;

export function validateCommandArgs(id: AllowedCommandId, value: unknown): ArgValidation {
    switch (id) {
        case 'akari.preview.ensureVisible':
        case 'akari.preview.togglePlayback':
            return objectResult(value, ['editUri'], args => optional(args, 'editUri', bounded), true);
        case 'akari.preview.seekOutput':
            return objectResult(value, ['editUri', 'time'], args =>
                optional(args, 'editUri', bounded) && optional(args, 'time', finite), true);
        case 'akari.preview.play':
        case 'akari.preview.pause':
            return objectResult(value, ['editUri'], args => required(args, 'editUri', bounded));
        case 'akari.preview.setFullscreen':
            return objectResult(value, ['editUri', 'on'], args =>
                required(args, 'editUri', bounded) && optional(args, 'on', boolean));
        case 'akari.preview.setViewZoom':
            return objectResult(value, ['editUri', 'scale', 'fit'], args =>
                required(args, 'editUri', bounded) && optional(args, 'scale', positive) && optional(args, 'fit', boolean));
        case 'akari.preview.setPlaybackRate':
            return objectResult(value, ['editUri', 'rate'], args =>
                required(args, 'editUri', bounded) && required(args, 'rate', positive));
        case 'akari.preview.setLoopRange':
            return objectResult(value, ['editUri', 'startSeconds', 'endSeconds', 'clear'], args => {
                if (!required(args, 'editUri', bounded)) return false;
                if (args.clear === true) return Object.keys(args).every(key => ['editUri', 'clear'].includes(key));
                return !('clear' in args)
                    && required(args, 'startSeconds', finite)
                    && required(args, 'endSeconds', finite);
            });
        case 'akari.preview.enterCropMode':
        case 'akari.preview.openPerspectivePanel':
            return objectResult(value, ['editUri', 'itemId', 'on'], args =>
                required(args, 'editUri', bounded) && optional(args, 'itemId', bounded) && optional(args, 'on', boolean));
        case 'akari.preview.pulseItem':
            return objectResult(value, ['editUri', 'itemId'], args =>
                required(args, 'editUri', bounded) && required(args, 'itemId', bounded));
        case 'akari.preview.showZoneHint':
            return objectResult(value, ['editUri', 'zones', 'durationMs'], args =>
                required(args, 'editUri', bounded)
                && required(args, 'zones', zones => isBoundedArray(zones) && zones.every(bounded))
                && optional(args, 'durationMs', finite));
        case 'akari.timeline.focusItem':
            return objectResult(value, ['itemId', 'seek', 'reveal', 'pulse'], args =>
                required(args, 'itemId', bounded) && ['seek', 'reveal', 'pulse'].every(key => optional(args, key, boolean)));
        case 'akari.timeline.seek':
            return objectResult(value, ['seconds'], args => required(args, 'seconds', finite));
        case 'akari.timeline.setView':
            return objectResult(value, ['startSeconds', 'durationSeconds', 'fit'], args =>
                optional(args, 'startSeconds', finite) && optional(args, 'durationSeconds', finite)
                && optional(args, 'fit', boolean), true);
        case 'akari.timeline.setTool':
            return objectResult(value, ['tool'], args => args.tool === 'select' || args.tool === 'razor');
        case 'akari.timeline.setSnap':
            return objectResult(value, ['enabled'], args => required(args, 'enabled', boolean));
        case 'akari.timeline.reveal':
            return noArgs(value);
        case 'akari.inspector.open':
            return objectResult(value, ['attachOnly', 'tabId', 'sectionId', 'fieldName', 'solo'], args =>
                optional(args, 'attachOnly', boolean)
                && ['tabId', 'sectionId', 'fieldName'].every(key => optional(args, key, bounded))
                && optional(args, 'solo', boolean), true);
        case 'akari.daihon.open':
            return objectResult(value,
                ['captionId', 'wordRange', 'atSeconds', 'open', 'speaker', 'pulse'], args => {
                    const range = args.wordRange;
                    const rangeOk = range === undefined || (isRecord(range) && hasOnly(range, ['from', 'to'])
                        && Number.isInteger(range.from) && Number(range.from) >= 0
                        && Number.isInteger(range.to) && Number(range.to) >= Number(range.from));
                    const openValues = ['display', 'template', 'history', 'silenceBatch', 'gear', 'cutRange', 'qc'];
                    return optional(args, 'captionId', bounded) && rangeOk
                        && optional(args, 'atSeconds', finite)
                        && optional(args, 'open', candidate => typeof candidate === 'string' && openValues.includes(candidate))
                        && optional(args, 'speaker', bounded) && optional(args, 'pulse', boolean);
                }, true);
        case 'akari.cuts.open':
            return objectResult(value, ['candidateId'], args => optional(args, 'candidateId', bounded), true);
        case 'akari.transcribe.openDialog':
            return objectResult(value, ['projectRoot', 'relativePath'], args =>
                required(args, 'projectRoot', bounded) && required(args, 'relativePath', bounded));
        case 'akari.catalog.open':
            return objectResult(value, ['tab', 'category', 'query', 'assetId', 'pulse'], args =>
                optional(args, 'tab', candidate => candidate === 'project' || candidate === 'library')
                && ['category', 'query', 'assetId'].every(key => optional(args, key, bounded))
                && optional(args, 'pulse', boolean), true);
        case 'akari.catalog.importAsset':
            return objectResult(value, ['assetId'], args => required(args, 'assetId', bounded));
        case 'akari.menu.focus':
            return objectResult(value, ['section', 'pulse', 'skill'], args =>
                optional(args, 'section', candidate => candidate === 'open' || candidate === 'skills')
                && optional(args, 'pulse', boolean) && optional(args, 'skill', bounded), true);
        case 'akari.catalog.listCategories':
        case 'akari.menu.listSkills':
        case 'akari.menu.listOpenTargets':
        case 'akari.review.open':
        case 'akari.review.board.open':
        case 'akari.partner.open':
            return noArgs(value);
    }
}
