# Settings layout L1

After building the shell extensions, run:

```sh
node apps/shell/extensions/akari-surfaces/evidence/akari-settings-layout/run-l1.mjs /tmp/akari-settings-layout-l1
```

The script starts Electron with a temporary home and CDP port 9449. It checks all six pillars, the vertical contents, one scrolling page, anchor jumps, scroll tracking, legacy commands, a connector detail, settings controls, and the narrow layout. It writes `measurements.json` and screenshots to the chosen output directory, then stops the Electron process group and removes the temporary profile. Only a fake credential is used.
