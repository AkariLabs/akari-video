import op_add_text from './add_text.mjs';
import op_answer_questions from './answer_questions.mjs';
import op_audio_ops_bgm_pick from './audio_ops_bgm_pick.mjs';
import op_audio_ops_duck from './audio_ops_duck.mjs';
import op_audio_ops_fade from './audio_ops_fade.mjs';
import op_audio_ops_mute from './audio_ops_mute.mjs';
import op_audio_ops_sfx from './audio_ops_sfx.mjs';
import op_audio_ops_sfx_volume from './audio_ops_sfx_volume.mjs';
import op_caption_shift_emphasis_shift from './caption_shift_emphasis_shift.mjs';
import op_caption_shift_emphasis_word from './caption_shift_emphasis_word.mjs';
import op_captions from './captions.mjs';
import op_color from './color.mjs';
import op_cut_look_freeze from './cut_look_freeze.mjs';
import op_cut_look_opacity from './cut_look_opacity.mjs';
import op_cut_look_transition from './cut_look_transition.mjs';
import op_cut_look_transition_remove from './cut_look_transition_remove.mjs';
import op_declared_knobs from './declared_knobs.mjs';
import op_delete from './delete.mjs';
import op_edit_text from './edit_text.mjs';
import op_emphasize from './emphasize.mjs';
import op_followup_replies_answer from './followup_replies_answer.mjs';
import op_followup_replies_cancel from './followup_replies_cancel.mjs';
import op_followup_replies_listen from './followup_replies_listen.mjs';
import op_framing_person from './framing_person.mjs';
import op_insert_from_library_add from './insert_from_library_add.mjs';
import op_insert_from_library_search from './insert_from_library_search.mjs';
import op_item_duration_rotate_blend from './item_duration_rotate_blend.mjs';
import op_item_duration_rotate_duration from './item_duration_rotate_duration.mjs';
import op_item_duration_rotate_opacity from './item_duration_rotate_opacity.mjs';
import op_item_duration_rotate_rotate from './item_duration_rotate_rotate.mjs';
import op_look_fx_brightness_brightness from './look_fx_brightness_brightness.mjs';
import op_look_fx_brightness_fx from './look_fx_brightness_fx.mjs';
import op_look_fx_brightness_look from './look_fx_brightness_look.mjs';
import op_motion_keyframes from './motion_keyframes.mjs';
import op_move_pos from './move_pos.mjs';
import op_move_time from './move_time.mjs';
import op_multi_select from './multi_select.mjs';
import op_none from './none.mjs';
import op_other from './other.mjs';
import op_playback_relative_fit from './playback_relative_fit.mjs';
import op_playback_relative_loop from './playback_relative_loop.mjs';
import op_playback_relative_pause from './playback_relative_pause.mjs';
import op_playback_relative_play from './playback_relative_play.mjs';
import op_playback_relative_seek from './playback_relative_seek.mjs';
import op_playback_relative_zoom_in from './playback_relative_zoom_in.mjs';
import op_playback_relative_zoom_out from './playback_relative_zoom_out.mjs';
import op_redo from './redo.mjs';
import op_reorder_cuts from './reorder_cuts.mjs';
import op_reorder_cuts_swap from './reorder_cuts_swap.mjs';
import op_repeat from './repeat.mjs';
import op_review_note from './review_note.mjs';
import op_scale from './scale.mjs';
import op_select from './select.mjs';
import op_selective_undo_checkpoint_restore from './selective_undo_checkpoint_restore.mjs';
import op_selective_undo_checkpoint_save from './selective_undo_checkpoint_save.mjs';
import op_selective_undo_checkpoint_undo from './selective_undo_checkpoint_undo.mjs';
import op_shell_ui_external from './shell_ui_external.mjs';
import op_shell_ui_open from './shell_ui_open.mjs';
import op_silence_cut from './silence_cut.mjs';
import op_skill_dispatch from './skill_dispatch.mjs';
import op_slip_speed_slip from './slip_speed_slip.mjs';
import op_slip_speed_speed from './slip_speed_speed.mjs';
import op_split from './split.mjs';
import op_split_at_word from './split_at_word.mjs';
import op_text_style_preset from './text_style_preset.mjs';
import op_trim_cut from './trim_cut.mjs';
import op_undo from './undo.mjs';
import op_volume from './volume.mjs';
import op_z_order_duplicate_copy from './z_order_duplicate_copy.mjs';
import op_z_order_duplicate_zorder from './z_order_duplicate_zorder.mjs';
import { byId } from '../exec-support/followup_replies_answer.mjs';
import { invokeExecutor } from '../exec-support/invoke.mjs';

const executors = [
    op_add_text,
    op_answer_questions,
    op_audio_ops_bgm_pick,
    op_audio_ops_duck,
    op_audio_ops_fade,
    op_audio_ops_mute,
    op_audio_ops_sfx,
    op_audio_ops_sfx_volume,
    op_caption_shift_emphasis_shift,
    op_caption_shift_emphasis_word,
    op_captions,
    op_color,
    op_cut_look_freeze,
    op_cut_look_opacity,
    op_cut_look_transition,
    op_cut_look_transition_remove,
    op_declared_knobs,
    op_delete,
    op_edit_text,
    op_emphasize,
    op_followup_replies_answer,
    op_followup_replies_cancel,
    op_followup_replies_listen,
    op_framing_person,
    op_insert_from_library_add,
    op_insert_from_library_search,
    op_item_duration_rotate_blend,
    op_item_duration_rotate_duration,
    op_item_duration_rotate_opacity,
    op_item_duration_rotate_rotate,
    op_look_fx_brightness_brightness,
    op_look_fx_brightness_fx,
    op_look_fx_brightness_look,
    op_motion_keyframes,
    op_move_pos,
    op_move_time,
    op_multi_select,
    op_none,
    op_other,
    op_playback_relative_fit,
    op_playback_relative_loop,
    op_playback_relative_pause,
    op_playback_relative_play,
    op_playback_relative_seek,
    op_playback_relative_zoom_in,
    op_playback_relative_zoom_out,
    op_redo,
    op_reorder_cuts,
    op_reorder_cuts_swap,
    op_repeat,
    op_review_note,
    op_scale,
    op_select,
    op_selective_undo_checkpoint_restore,
    op_selective_undo_checkpoint_save,
    op_selective_undo_checkpoint_undo,
    op_shell_ui_external,
    op_shell_ui_open,
    op_silence_cut,
    op_skill_dispatch,
    op_slip_speed_slip,
    op_slip_speed_speed,
    op_split,
    op_split_at_word,
    op_text_style_preset,
    op_trim_cut,
    op_undo,
    op_volume,
    op_z_order_duplicate_copy,
    op_z_order_duplicate_zorder,
];
if (executors.length !== 70) throw new Error(`Expected 70 executors, got ${executors.length}`);
export const execById = new Map();
for (const op of executors) {
    if (JSON.stringify(Object.keys(op).sort()) !== '["apply","id"]' || typeof op.apply !== 'function'
        || !op.id || execById.has(op.id)) throw new Error(`Invalid executor: ${op.id}`);
    execById.set(op.id, op);
    byId.set(op.id, { apply:(env,d)=>invokeExecutor(op,env,d) });
}
