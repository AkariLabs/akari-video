# Expose the preview server only within the tailnet

## 1. Check that the preview server is running

- If doctor's `preview.listening` is false, start it with `./akari.sh --preview`
  (or `npx akari-video --preview`). Default port: 4567.
- Rerun doctor and verify `preview.listening: true`.

## 2. Configure serve (approval required — hard rule 4)

Before execution, present all 3 items — command, effect, and how to undo it — and obtain approval:

```
tailscale serve --bg 4567
```

- Effect: `https://<マシン名>.<tailnet 名>.ts.net` → `localhost:4567` forwarding
  (the existing placeholders mean machine name and tailnet name).
  **Only devices within the tailnet can reach it**; it is not exposed to the public internet.
  This differs from funnel, which hard rule 1 excludes.
- Undo: `tailscale serve reset` (remove all serve settings).
- Older CLIs may use different `serve` syntax. If it errors, check `tailscale version` and use the syntax
  for that version in the official serve documentation. The target is still only the preview server — hard rule 2.

## 3. Establish the URL and check viewing

- Rerun doctor → verify `serve.configured: true` and `serveUrl`.
- Ask the user to open `serveUrl` on the phone (Tailscale on) and verify that the preview appears.
- If it cannot open, troubleshoot in this order:
  1. Is phone-side Tailscale on? (Most frequent cause.)
  2. **If it stalls at the TLS handshake, check certificates.** Verify HTTPS Certificates is enabled in the admin console.
     If enabled but still failing, run `tailscale cert <dnsName>` on its own and read the ACME error body.
     An invalid issuance is a tailnet issue, not a serve configuration mistake.
  3. Is the machine asleep? (Sleeping removes it from the tailnet.)

## 4. Serve approval reports (when needed)

If approval gates will run on the phone, also serve the decision-cards report helper.
**The allowlist contains only these 2 services: the preview server and this helper** (hard rule 2).

1. Start the helper (`<port>` is an available port; stdout prints `HELPER: http://localhost:<port>/`):
   ```
   node packages/decision-cards/report-helper.mjs <report.html のパス> --port <port>
   ```
2. Configure serve (approval required — hard rule 4). Present the command, effect, and undo method; obtain approval:
   ```
   tailscale serve --bg --https=8443 <port>
   ```
   - Effect: `https://<マシン名>.<tailnet 名>.ts.net:8443` → `localhost:<port>`, tailnet-only
     (the existing placeholders mean machine name and tailnet name).
   - Fixing the external port at 8443 means **the URL pasted in chat remains valid** even if the helper's internal
     port changes between launches.
   - Undo: `tailscale serve --https=8443 off` (leaves the preview service running).
3. Open it on the phone and operate 1 card → verify on the Mac that `<report.html>.decisions.json` actually updates.
   **Do not claim completion just because it displays** (hard rule 6).
