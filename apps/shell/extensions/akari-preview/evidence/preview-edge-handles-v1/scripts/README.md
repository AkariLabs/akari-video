**English** | [日本語](./README.ja.md)

# Preview edge handles L1

Run on a machine with a built AKARI Electron shell and Node with global `fetch` and `WebSocket`:

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-edge-handles-v1/scripts/run-l1.sh
```

`AKARI_CDP_PORT` defaults to **9771**. `ELECTRON_BIN` may override the Electron executable. The launcher refuses an occupied port, creates an isolated project and user data directory, waits for Theia, then cleans up its process and temporary files. It does not build the shell. `run-log.json` records each of the nine instruction 8 checks with observed values and `ok` or `ng`; any failure exits 1. The fixture is copied from `object-tree-html-bag`, wraps `g1` in `outer`, and rotates `g1.second` by 30°. The product repository is not committed by the runner.

Syntax checks without Electron:

```sh
node --check apps/shell/extensions/akari-preview/evidence/preview-edge-handles-v1/scripts/prepare-fixture.mjs
node --check apps/shell/extensions/akari-preview/evidence/preview-edge-handles-v1/scripts/run-l1.mjs
bash -n apps/shell/extensions/akari-preview/evidence/preview-edge-handles-v1/scripts/run-l1.sh
```

The runner uses CDP pointer input for handles and the inspector scrub handle. Its `Runtime.evaluate` calls open the existing UI, seek, install a transparent write observer, and read DOM or disk state. It records the nine checks separately: handle count; X only with opposite edge fixed and one write; Y only; rotated right angles; Shift/free and plain/proportional corners; group edge absence; live HTML CSS and saved width; inspector update after preview drag; and overall scale from 50% to 100% with the axis ratio retained.

For edge drags, “X only” / “Y only” means only that axis’s **effective scale** changes; edit-store deliberately writes both axis keys whenever either is present. After inspector commits, the runner reconnects to the replaced preview iframe and reselects the leaf before the next gesture.
