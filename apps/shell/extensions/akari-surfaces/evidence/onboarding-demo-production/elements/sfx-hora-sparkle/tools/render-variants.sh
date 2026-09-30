export PATH="$HOME/.local/node:$PATH"; WT="C:/Users/kyach/akari-wt/onboarding-demo-rich"
cd C:/t/hora-r2/cwd
for v in sfxonly mix; do
env -u ELECTRON_RUN_AS_NODE AKARI_HOME=C:/t/hora-r2/akhome AKARI_EXPORT_ALLOW_DESKTOP=0 AKARI_OSR_VERIFY=off AKARI_FFMPEG_BIN="$WT/packages/media-bin/vendor/win32-x64/ffmpeg.exe" AKARI_FFPROBE_BIN="$WT/packages/media-bin/vendor/win32-x64/ffprobe.exe" TMP=C:/t/hora-r2/tmp TEMP=C:/t/hora-r2/tmp node "$WT/packages/render-cut/bin/render-cut.mjs" C:/t/hora-r2/$v --engine auto --force > C:/t/hora-r2/render-$v.log 2>&1; echo "$v exit $?" >> C:/t/hora-r2/done.txt
done
echo ALLDONE >> C:/t/hora-r2/done.txt
