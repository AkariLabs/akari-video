**English** | [日本語](./README.ja.md)

# Preview group resize and rotate L1

Run `scripts/run-l1.sh` after building the shell. The script copies the project fixture into a disposable `/tmp` workspace, starts Electron with an isolated profile, connects through CDP, and sends real pointer and keyboard input. It checks eight gestures: group handles, group resize, group rotation and Shift snapping, bag resize and rotation, leaf rotation, resize inside a rotated group, Escape cancellation, and the existing group drag distance.

The run writes `run-log.json` and step screenshots in this evidence directory. It never edits the source fixture or product repository. `AKARI_CDP_PORT` and `ELECTRON_BIN` can override the default port and Electron executable. A busy CDP port fails before Electron starts. Electron execution is performed by the task wrapper outside the agent sandbox.
