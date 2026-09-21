// Mirror of akari-project/src/common/generation-pick.ts. Keep the command contract
// here so annotations does not acquire a runtime dependency on another extension.
export const GENERATION_PICK_INTO_COMMAND_ID = 'akari.generation.pickInto';

export interface GenerationPickRequest {
    slot: 'first_frame' | 'last_frame' | 'reference_images' | 'reference_videos' | 'reference_audios';
    label: string;
    accepts: Array<'image' | 'video' | 'audio'>;
    multi: boolean;
    selected?: string[];
    max?: number | null;
}

export type GenerationPickResult = { status: 'picked'; paths: string[] } | { status: 'cancelled' };
