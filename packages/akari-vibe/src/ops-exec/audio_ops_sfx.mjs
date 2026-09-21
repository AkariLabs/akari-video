import { insertAudio } from '../exec-support/audio_ops_sfx.mjs';
export default { id: 'audio_sfx', apply(env,d) { insertAudio(env,d,'sfx'); } };
