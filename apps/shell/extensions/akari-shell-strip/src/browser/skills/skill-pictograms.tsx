import * as React from '@theia/core/shared/react';
import { SkillCategory } from './skills-panel-model';

const accent = 'var(--akari-accent, #f97316)';
const shade = 'var(--theia-descriptionForeground)';

// 各行は輪郭、仕事を示す二つ目の形、細部、強調の順。
const SKILL_PATHS: Record<string, readonly [string, string, string, string]> = {
    'address-review': [
        'M8 8h27l8 8v18H8zM35 8v8h8', 'M14 17h14M14 22h10M14 27h8',
        'm29 35 4-10 13-12 4 4-13 13z', 'm43 15 5 5'],
    akari: [
        'm8 20 21-14 21 14M13 18v18h32V18', 'M17 30h8M33 30h8',
        'M20 35h18', 'm26 18 13 7-13 7z'],
    'analyze-footage': [
        'M7 8h35v22H7zM7 13h35M7 25h35', 'M12 8v5M22 8v5M32 8v5M13 17h13v5H13z',
        'M40 27a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm46 25 9 10'],
    'analyze-project': [
        'M8 33V12h29M11 33h31', 'M14 28v-8h5v8M23 28V15h5v13M32 28v-5h5v5',
        'M44 25a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm50 23 8 9'],
    'bake-3d': [
        'm10 14 12-6 12 6-12 7zM10 14v14l12 7 12-7V14M22 21v14',
        'M39 32h16M41 35h12M40 26h14', 'M48 22c0-2 2-3 2-5',
        'M45 24c-4-5 2-8 1-14 7 7 10 11 6 15-3 3-8 2-7-1z'],
    'beat-sync-edit': [
        'M13 8v18a5 5 0 1 1-4-5V12l22-5v18a5 5 0 1 1-4-5V8',
        'M8 35h47M18 31v8M29 31v8M40 31v8M51 31v8', 'M14 15 29 11',
        'M36 14h18M39 10v8M46 10v8M53 10v8'],
    'compile-review-session': [
        'M9 13h25v22H9zM14 18h14M14 29h13',
        'M46 30a11 11 0 1 0 0-22 11 11 0 0 0 0 22z',
        'M46 12v8l5 3M39 34h14',
        'M20 25a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
    'create-project': [
        'M7 14h19l4 4h25v18H7zM7 14V9h17l4 5', 'M12 31h13',
        'M31 27h17', 'M39.5 19v16'],
    'critique-cut': [
        'M10 11 39 31M11 31 39 11',
        'M10 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM10 25a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
        'M37 13h13M37 29h13',
        'M47 13a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'],
    'declare-audio': [
        'M9 18h8l10-8v25l-10-8H9z', 'M32 15c5 3 5 10 0 13M36 10c9 6 9 17 0 23',
        'M45 35h1M52 35h1M59 35h1', 'M45 15v16M52 11v20M59 18v13'],
    'design-world': [
        'M27 36a15 15 0 1 0 0-30 15 15 0 0 0 0 30z',
        'M12 21h30M27 6c-9 9-9 21 0 30M27 6c9 9 9 21 0 30',
        'm34 34 9-12 6 7 5-8 7 13z', 'm40 27 3-5 3 4'],
    'edit-lint': [
        'M12 7h35v30H12zM18 15h5M18 24h5M18 33h5',
        'M27 15h13M27 24h13M27 33h10', 'M9 12v26h35',
        'm17 14 2 2 4-5m-6 12 2 2 4-5m-6 12 2 2 4-5'],
    'edit-plan': [
        'M10 5h29l7 7v20H10zM39 5v7h7', 'M16 14h15M16 19h23M16 24h17',
        'M11 37h43M18 34v6M31 34v6M45 34v6', 'M30 37h13'],
    'export-nle': [
        'M8 16h28v20H8zM8 21h28M13 16v5M23 16v5M32 16v5',
        'm18 26 8 4-8 4z', 'M39 11h15v25H39',
        'M38 26h16m-6-6 6 6-6 6'],
    'generate-media': [
        'M8 10h37v26H8zM13 30l10-10 7 7 5-5 6 8',
        'M18 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
        'm49 28 3 2 3-2-3 5z', 'M52 7v13M46 13h12'],
    'generate-narration': [
        'M21 7a6 6 0 0 0-6 6v10a6 6 0 0 0 12 0V13a6 6 0 0 0-6-6z',
        'M10 21a11 11 0 0 0 22 0M21 32v6M15 38h12',
        'M36 35h21', 'M37 22h3l2-7 4 15 3-12 3 5h5'],
    'harvest-asset': [
        'M9 21h45l-5 16H14zM15 21l7-12M48 21 41 9',
        'M19 26v7M31 26v7M43 26v7', 'M29 12h2',
        'M25 9h18v13H25zM28 19l5-5 4 4 3-3'],
    'manage-connections': [
        'M8 13h18v15H8zM12 8v5M22 8v5M17 28v8h10',
        'M40 11v4l4 2 4-2 4 5-3 4 2 4-3 5-5-2-3 2-4-2-4 2-3-5 2-4-3-4 4-5 4 2z',
        'M28 35h8', 'M40 19a5 5 0 1 0 0 10 5 5 0 0 0 0-10z'],
    'overlay-authoring': [
        'M6 8h44v27H6zM11 30h15', 'M17 14h39v25H17z',
        'M28 33h17', 'M27 20h18M36 20v13'],
    'render-cut': [
        'M17 23a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM17 9v3M23 14h-3M17 19v-3M11 14h3',
        'M17 23v12h14', 'M32 18h25v19H32zM37 23h15M37 32h15',
        'm42 26 7 3-7 3z'],
    'research-plan': [
        'm7 10 15-4 16 5 18-4v28l-18 4-16-5-15 4zM22 6v28M38 11v28',
        'm11 24 6-5M26 17l7 5', 'M47 18h1',
        'M47 13a6 6 0 0 0-6 6c0 5 6 11 6 11s6-6 6-11a6 6 0 0 0-6-6z'],
    'setup-audio-library': [
        'M24 7a8 8 0 0 0-9 10L7 29l8 8 12-13a8 8 0 0 0 10-9l-6 5-8-7z',
        'M11 29l5 5', 'M39 35h18',
        'M47 8v20a5 5 0 1 1-4-5V12l13-4v17a5 5 0 1 1-4-5V9'],
    'setup-chat-approval': [
        'M8 8h47v25H29l-10 7v-7H8z', 'M15 16h14M15 22h10',
        'M33 13h16', 'm35 23 5 5 9-11'],
    'setup-library': [
        'M7 35h48M11 12v23M24 12v23M37 12v23M50 12v23M11 12h39',
        'M16 17v12M29 17v12M42 17v12', 'M17 35v4',
        'M46 5a6 6 0 0 0-8 8L27 24l5 5 11-11a6 6 0 0 0 8-8l-4 4-5-5z'],
    'setup-remote': [
        'M13 6h25v33H13zM17 10h17M21 35h9',
        'M44 13c5 1 8 5 8 10M43 19c2 1 3 2 3 4',
        'M26 18v10m-4-5h8', 'M52 7c6 3 9 8 9 16'],
    verify: [
        'M13 7v31M36 7v31M13 12h23M13 22h23M13 32h23',
        'M8 38h33M8 7h33', 'M46 11h10',
        'm41 25 6 6 10-14']
};

export const DEDICATED_PICTOGRAM_NAMES: readonly string[] = Object.keys(SKILL_PATHS);

const SKILL_ART: Record<string, React.ReactNode> = Object.fromEntries(
    Object.entries(SKILL_PATHS).map(([name, paths]) => [name, <>
        {paths.map((d, index) => <path key={index} d={d} stroke={index === 3 ? accent : 'currentColor'}
            fill={name === 'overlay-authoring' && index === 1 ? shade : 'none'}
            fillOpacity={name === 'overlay-authoring' && index === 1 ? 0.3 : undefined} />)}
    </>])
);

const CATEGORY_ART: Record<SkillCategory, React.ReactNode> = {
    plan: <><path d='M9 8h19v27H9zM31 8h19v27H31z' /><path d='M15 16h8M36 16h8' stroke={accent} /></>,
    analysis: <><path d='M10 12h27v21H10zM15 27v-6M22 27v-10M29 27v-4' /><path d='M45 25a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM51 23l7 8' stroke={accent} /></>,
    material: <><path d='M9 14h45v22H9zM9 19h45M17 24h9v7h-9z' /><path d='M36 24h10v7H36z' stroke={accent} /></>,
    edit: <><path d='M8 10h47v25H8zM8 16h47M17 10v6M29 10v6M41 10v6' /><path d='M32 18v19' stroke={accent} /></>,
    review: <><path d='M11 7h33l7 7v23H11zM44 7v7h7M17 19h17' /><path d='m19 29 4 4 9-10' stroke={accent} /></>,
    export: <><path d='M10 24v12h44V24M16 30h9' /><path d='M32 7v22m-8-8 8 8 8-8' stroke={accent} /></>,
    setup: <><path d='M20 9h24v7l5 5-5 5v8H20v-8l-5-5 5-5z' /><path d='M32 15a7 7 0 1 0 0 14 7 7 0 0 0 0-14z' stroke={accent} /></>,
    other: <><path d='M10 8h44v29H10zM17 16h30M17 23h20' /><path d='M40 30h8' stroke={accent} /></>
};

export function skillPictogramFor(name: string, category: SkillCategory): { dedicated: boolean; art: React.ReactNode } {
    if (Object.prototype.hasOwnProperty.call(SKILL_ART, name)) {
        return { dedicated: true, art: SKILL_ART[name] };
    }
    return { dedicated: false, art: CATEGORY_ART[category] };
}

export function SkillPictogram({ name, category }: { name: string; category: SkillCategory }): React.ReactElement {
    return <svg width='64' height='44' viewBox='0 0 64 44' aria-hidden='true' xmlns='http://www.w3.org/2000/svg'
        fill='none' stroke='currentColor' strokeWidth={1.6} strokeLinecap='round' strokeLinejoin='round'>
        {skillPictogramFor(name, category).art}
    </svg>;
}
