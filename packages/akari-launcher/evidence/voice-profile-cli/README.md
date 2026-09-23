# voice CLI の隔離証跡

`node packages/akari-launcher/evidence/voice-profile-cli/regenerate.mjs` で `evidence.json` を再生成する。ffmpeg が必要。合成 sine と低振幅ノイズ、隔離した HOME / AKARI_HOME、ローカルの偽彩サーバーだけを使う。この Mac の SpeechAnalyzer では合成音の一致率が 0 となり、作成が止まる。聞き取りが unavailable の場合は正本を保存できるが、fal の写しは照合不足で作れない。彩の写し、試し読み、削除は偽サーバーで確かめる。生成物の一時パスは `<tmp>` に置換する。
