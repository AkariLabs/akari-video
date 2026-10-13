---
name: setup-remote
description: Set up remote access to approval reports and previews from another device such as a phone, and send footage to the workspace. Use doctor to assess Tailscale, guide installation and login (human actions), expose the preview server (default 4567) and approval report helper over tailnet-only HTTPS with tailscale serve, connect Taildrop reception to workspace inbox/, and verify access from another device. Use for requests to view reports on a phone, approve remotely, send footage from a phone, or set up remote access. Public internet exposure (funnel) is outside the default scope.
---

# FORBIDDEN-level hard rules

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Never proceed with remote setup in violation of any rule below. These always override detailed leaf documents.

1. **Do not run or propose `tailscale funnel` (public internet exposure).** Only if the user explicitly requests
   funnel, explain that anyone who knows the URL can reach it and obtain explicit approval before handling it.
   The default is always tailnet-only (within the private network).
2. **Only the 2 allowlisted services may be served**: (a) the preview server (default 4567)
   (b) the decision-cards report helper (`report-helper.mjs`, serving approval reports + `decisions.json`).
   **Do not serve the filesystem, other ports, or other apps.** Expanding the allowlist requires a contract revision;
   do not add entries at the skill's discretion.
3. **Do not perform installation, login, or phone app installation for the user.** Explicitly hand these actions
   to the human, then rerun doctor (`bin/doctor.mjs`) to confirm completion before proceeding.
4. **Before changing network settings (serve on/off or reception destination), present the exact command,
   its effect, and how to undo it, and obtain approval before execution.**
5. **Do not write secrets or credentials into the workspace or project.** The Tailscale app manages authentication.
   The skill may record only serve URLs and reception routes.
6. **Do not report “configured” without doctor.** Do not claim completion until both connectivity checks
   succeed: viewing from another device + receiving a Taildrop file.

# Leaf documents in execution order

1. [doctor-and-install.md](doctor-and-install.md) — Doctor assessment → installation/login guidance by state (macOS / Windows / phone)
2. [serve-preview.md](serve-preview.md) — Start preview server → configure `tailscale serve` → establish URL → serve the report helper if approvals will run on the phone
3. [taildrop-inbox.md](taildrop-inbox.md) — Fix Taildrop reception destination → connect to workspace `inbox/` → connectivity checks → completion report

Read only the file for the current stage, without reading ahead. Do not proceed until doctor confirms completion of the human action.

## Sources

- Contract: [`docs/contract-2026-08-02-setup-remote-v0.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-02-setup-remote-v0.md) (Japanese)
- Workspace, `inbox/`, and secret separation principles: [`docs/contract-2026-08-02-creator-root-v1.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-02-creator-root-v1.md) (Japanese)
- Approval report files (`.akari/reports/`): [`docs/contract-2026-07-25-project-structure-v0.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md) (Japanese)
