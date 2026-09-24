// fal TTS の追加点。価格の verified は fal の課金単位を確認できた場合だけ true にする。
const geminiVoices = Object.entries({
  Leda: 'Youthful', Achernar: 'Soft', Achird: 'Friendly', Algenib: 'Gravelly',
  Algieba: 'Smooth', Alnilam: 'Firm', Aoede: 'Breezy', Autonoe: 'Bright',
  Callirrhoe: 'Easy-going', Charon: 'Informative', Despina: 'Smooth',
  Enceladus: 'Breathy', Erinome: 'Clear', Fenrir: 'Excitable', Gacrux: 'Mature',
  Iapetus: 'Clear', Kore: 'Firm', Laomedeia: 'Upbeat', Orus: 'Firm',
  Pulcherrima: 'Forward', Puck: 'Upbeat', Rasalgethi: 'Informative',
  Sadachbia: 'Lively', Sadaltager: 'Knowledgeable', Schedar: 'Even',
  Sulafat: 'Warm', Umbriel: 'Easy-going', Vindemiatrix: 'Gentle',
  Zephyr: 'Bright', Zubenelgenubi: 'Casual',
}).map(([id, description]) => ({ id, label: `${id}（${description}）`, ...(id === 'Leda' ? { default: true } : {}) }));

const price = (unit, value, verified = false, as_of = '2026-09-24') => ({ unit, value, verified, as_of });
const audio = result => result?.audio?.url;
const fixture = endpoint => `${endpoint.replaceAll('/', '_')}.json`;
const row = (id, label, endpoint, details) => ({
  id, label, provider: 'fal', place: 'cloud', endpoint,
  openapi_fixture: fixture(endpoint), ...details, parseAudio: audio,
});

export const FAL_TTS_ENGINES = Object.freeze([
  row('gemini-tts', 'Gemini 2.5 Flash TTS', 'fal-ai/gemini-tts', {
    openapi_fixture: 'fal_gemini-tts.json',
    price: price('usd_per_1000_chars', 0.05, false, '2026-09-22'), voices: geminiVoices,
    default_voice: 'Leda', supports: { speed: false, style: true, clone: 'none' },
    buildPayload: ({ text, voice, style }) => ({ prompt: text, voice, model: 'gemini-2.5-flash-tts', output_format: 'mp3',
      language_code: 'Japanese (Japan)', ...(style ? { style_instructions: style } : {}) }),
  }),
  row('fal-qwen3', 'fal Qwen3-TTS', 'fal-ai/qwen-3-tts/text-to-speech/1.7b', {
    price: price('usd_per_1000_chars', 0.09), voices: null,
    default_voice: null, supports: { speed: false, style: false, clone: 'registered' },
    buildPayload: ({ text, profileMeta }) => ({ text, language: 'Japanese',
      speaker_voice_embedding_file_url: profileMeta.embedding_source_url,
      reference_text: profileMeta.reference_text, max_new_tokens: 2048 }),
  }),
  row('gemini-3.1-flash-tts', 'Gemini 3.1 Flash TTS（既製の声）', 'fal-ai/gemini-3.1-flash-tts', {
    price: price(null, null), voices: geminiVoices, default_voice: 'Leda',
    supports: { speed: false, style: true, clone: 'none' },
    buildPayload: ({ text, voice, style }) => ({ prompt: text, voice, output_format: 'mp3',
      language_code: 'Japanese (Japan)', ...(style ? { style_instructions: style } : {}) }),
  }),
  row('elevenlabs-v3', 'ElevenLabs v3（既製の声）', 'fal-ai/elevenlabs/tts/eleven-v3', {
    price: price('usd_per_1000_chars', 0.10),
    voices: ['Rachel', 'Aria', 'Sarah', 'Laura', 'Charlie', 'George', 'River', 'Liam', 'Charlotte', 'Alice']
      .map(id => ({ id, label: id, ...(id === 'Rachel' ? { default: true } : {}) })),
    default_voice: 'Rachel', supports: { speed: false, style: false, clone: 'none' },
    buildPayload: ({ text, voice }) => ({ text, voice, language_code: 'ja' }),
  }),
  row('minimax-2.6-hd', 'MiniMax Speech 2.6 HD（自分の声対応）', 'fal-ai/minimax/speech-2.6-hd', {
    price: price(null, null),
    voices: ['Wise_Woman', 'Friendly_Person', 'Inspirational_girl', 'Deep_Voice_Man',
      'Calm_Woman', 'Casual_Guy', 'Lively_Girl', 'Patient_Man', 'Lovely_Girl', 'Elegant_Man']
      .map(id => ({ id, label: id, ...(id === 'Wise_Woman' ? { default: true } : {}) })),
    default_voice: 'Wise_Woman', supports: { speed: true, style: false, clone: 'registered' },
    buildPayload: ({ text, voice, profileMeta, speed }) => ({ prompt: text, language_boost: 'Japanese',
      output_format: 'url', voice_setting: { voice_id: profileMeta?.engines?.['minimax-2.6-hd']?.custom_voice_id ?? voice,
        ...(speed != null ? { speed } : {}) } }),
  }),
  row('chatterbox', 'Chatterbox 多言語（参照音声対応）', 'fal-ai/chatterbox/text-to-speech/multilingual', {
    price: price('usd_per_1000_chars', 0.025), voices: [{ id: 'japanese', label: '日本語', default: true }], default_voice: 'japanese',
    supports: { speed: false, style: false, clone: 'per-request' },
    buildPayload: ({ text, audioUrl }) => ({ text, voice: audioUrl ?? 'japanese',
      ...(audioUrl ? { custom_audio_language: 'japanese' } : {}) }),
  }),
  row('index-tts-2', 'Index TTS 2（参照音声対応）', 'fal-ai/index-tts-2/text-to-speech', {
    price: price('usd_per_second', 0.002), voices: null, default_voice: null,
    supports: { speed: false, style: false, clone: 'per-request' },
    buildPayload: ({ text, audioUrl }) => ({ prompt: text, audio_url: audioUrl }),
  }),
]);

export const falTtsEngine = id => FAL_TTS_ENGINES.find(engine => engine.id === id);

export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;

export function referenceDataUri(bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error('参照音声のデータが不正です');
  if (bytes.length > MAX_REFERENCE_BYTES) throw new Error('20 MB 超の参照音声は送信できません');
  return `data:audio/wav;base64,${bytes.toString('base64')}`;
}

export function estimateTtsCost(engine, text) {
  const { unit, value } = engine.price;
  if (value == null) return null;
  if (unit === 'usd_per_1000_chars') return Number((text.length * value / 1000).toFixed(6));
  if (unit === 'usd_per_second') return Number((text.length / 5 * value).toFixed(6)); // 日本語約 5 字/秒の概算
  if (unit === 'usd_per_request') return value;
  return null;
}
