# entitlements visibility evidence

This directory contains the reproduction harness for a production-build Electron run driven through
`webContents.debugger` (CDP).
The harness serves a paid resolver catalog and switches the entitlements response with the final
scenario argument:

- `revoked`: saved credentials + HTTP 401 `{"error":"token_revoked"}`
- `no-credentials`: no credentials file; the entitlements endpoint must not be requested
- `network-error`: saved credentials + HTTP 500

The revoked run scrolls the home Store card into the viewport, asserts its rectangle is fully inside
the viewport, and then captures the reconnect-required guidance and reconnect button. The other runs
assert that missing credentials show neither reconnect guidance nor a catalog notice, and that a
network failure keeps the catalog fetch-failed row and retry button. All runs confirm the paid item
remains `locked`.

## Reproduction

From the repository root, after the production shell build and with Electron 39.8.7 expanded:

```sh
AKARI_L1_ROOT="$(mktemp -d)"
AKARI_L1_APP="$PWD/apps/shell"
AKARI_L1_EVIDENCE="$PWD/apps/shell/extensions/akari-project/evidence/entitlements-visibility"
AKARI_L1_WORKSPACE="$AKARI_L1_ROOT/workspace"
mkdir -p "$AKARI_L1_WORKSPACE" \
  "$AKARI_L1_ROOT/profile-revoked" \
  "$AKARI_L1_ROOT/profile-no-credentials" \
  "$AKARI_L1_ROOT/profile-network-error"
cp -R "$PWD/templates/project-default/." "$AKARI_L1_WORKSPACE/"

# 1. Revoked credentials: home reconnect card + catalog reconnect guidance
node "$AKARI_L1_EVIDENCE/run-l1.mjs" \
  "$AKARI_L1_APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$AKARI_L1_APP" \
  "$AKARI_L1_WORKSPACE" \
  "$AKARI_L1_ROOT/profile-revoked" \
  "$AKARI_L1_EVIDENCE" \
  revoked

# 2. No credentials: normal disconnected home card + no catalog notice
node "$AKARI_L1_EVIDENCE/run-l1.mjs" \
  "$AKARI_L1_APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$AKARI_L1_APP" \
  "$AKARI_L1_WORKSPACE" \
  "$AKARI_L1_ROOT/profile-no-credentials" \
  "$AKARI_L1_EVIDENCE" \
  no-credentials

# 3. Network error: catalog fetch-failed row + retry button
node "$AKARI_L1_EVIDENCE/run-l1.mjs" \
  "$AKARI_L1_APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$AKARI_L1_APP" \
  "$AKARI_L1_WORKSPACE" \
  "$AKARI_L1_ROOT/profile-network-error" \
  "$AKARI_L1_EVIDENCE" \
  network-error
```

`run-log-<scenario>.json` contains the asserted DOM values and viewport geometry.
`server-log-<scenario>.json` records the mock request counts, exact entitlements response, and whether
the request-count expectation passed. The PNGs are:

- `01-home-reconnect-required.png`
- `02-catalog-reconnect-guidance.png`
- `03-no-credentials-home.png`
- `03-no-credentials-catalog.png`
- `04-network-error-catalog.png`

If the execution sandbox rejects loopback `listen` with `EPERM`/`EACCES`, the same harness falls back
to a Node `--import` fetch preload that returns the scenario's identical HTTP response to the resolver
child process. `server-log-<scenario>.json.transport` records which path was actually used.
