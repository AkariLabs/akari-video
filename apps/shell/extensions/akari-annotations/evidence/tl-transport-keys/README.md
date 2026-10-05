# Timeline transport L1

After building the shell, run `node run-all.mjs` from this directory. It creates an isolated fixture, checks port 9464, starts Electron, runs the CDP checks, and stops only its own Electron PID. The printed path contains `run.log` and `electron.log`.

To run the steps separately, use `node prepare-fixture.mjs` and its JSON output for the paths below, then start the built app from the repository root:

```sh
env -u ELECTRON_RUN_AS_NODE THEIA_CONFIG_DIR="$config" AKARI_HOME="$akariHome" \
  apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  "$PWD/apps/shell" "$workspace" --remote-debugging-port=9464 \
  --user-data-dir="$userData" --no-sandbox > "$base/electron.log" 2>&1 &
electron_pid=$!
node apps/shell/extensions/akari-annotations/evidence/tl-transport-keys/run-l1.mjs 9464 > "$base/run.log" 2>&1
kill "$electron_pid"
```

The runner prints measured rates and times. Keep its output and any screenshots in the temporary fixture directory. Stop only the Electron PID started for this run.

At the 24 second endpoint, the preview intentionally seeks to two frames before the end so playback can still advance. The runner checks the timeline head against 24 seconds and the preview against `24 − 2/30` seconds, each within one frame.
