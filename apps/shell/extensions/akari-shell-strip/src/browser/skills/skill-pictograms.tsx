import * as React from '@theia/core/shared/react';
import { SkillCategory } from './skills-panel-model';

export function SkillPictogram({ category }: { category: SkillCategory }): React.ReactElement {
    const art: Record<SkillCategory, React.ReactNode> = {
        plan: <><path d='M8 9h18v22H8zM30 9h18v22H30zM12 14h10M12 19h7M34 14h10M34 19h7' stroke='currentColor' strokeWidth='2' fill='none' /><rect x='19' y='23' width='5' height='5' fill='#e8912d' /></>,
        material: <><path d='M7 12h42v22H7zM7 17h42M13 7h13l4 5M27 22h7v7h-7zM38 22h5v7h-5z' stroke='currentColor' strokeWidth='2' fill='none' /><rect x='14' y='22' width='9' height='7' fill='#e8912d' /></>,
        edit: <><path d='M7 9h42v22H7zM7 16h42M14 9v7M23 9v7M32 9v7M41 9v7M14 24h11M31 24h11' stroke='currentColor' strokeWidth='2' fill='none' /><path d='M28 18v15' stroke='#e8912d' strokeWidth='3' /></>,
        review: <><path d='M11 6h27l7 7v22H11zM37 6v8h8M17 17h13M17 22h13' stroke='currentColor' strokeWidth='2' fill='none' /><path d='m19 29 3 3 7-7' stroke='#e8912d' strokeWidth='3' fill='none' /></>,
        export: <><path d='M9 24v11h38V24M39 29h4' stroke='currentColor' strokeWidth='2' fill='none' /><path d='M28 6v19m-8-8 8 8 8-8' stroke='#e8912d' strokeWidth='3' fill='none' /></>,
        setup: <><path d='M23 5h10l2 5 5 2 5-2 5 9-4 4v5l4 4-5 8-6-2-4 2H21l-2-5-5-2-5 2-5-9 4-4v-5l-4-4 5-8 6 2 4-2z' transform='translate(3 -3) scale(.9)' stroke='currentColor' strokeWidth='2' fill='none' /><circle cx='28' cy='20' r='7' stroke='currentColor' strokeWidth='2' fill='none' /><circle cx='28' cy='20' r='3' fill='#e8912d' /></>,
        other: <><path d='M8 8h40v25H8zM13 15h30M13 21h24M13 27h16' stroke='currentColor' strokeWidth='2' fill='none' /><rect x='35' y='26' width='7' height='4' fill='#e8912d' /></>
    };
    return <svg width='56' height='40' viewBox='0 0 56 40' aria-hidden='true' fill='currentColor' xmlns='http://www.w3.org/2000/svg'>{art[category]}</svg>;
}
