# Taildrop reception → inbox/ connection and connectivity checks

Taildrop is Tailscale's direct device-to-device file transfer (phone share sheet → choose device).
It bypasses the cloud, has no practical size limit, and preserves image quality. Use it to hand off footage.

## 1. Check the reception destination

- The destination varies by environment (macOS / Windows GUI versions often use Downloads;
  some app settings allow changing it). **Do not assert a guessed path; establish the actual path with the §3 test transfer.**
- For CLI operation (Linux, etc.), retrieve files with `tailscale file get <受信先ディレクトリ>`
  (the existing placeholder means reception directory).
- **Observed (2026-08-12 / macOS standalone `io.tailscale.ipn.macsys` 1.98.10)**: destination was
  `~/Downloads`; `defaults read io.tailscale.ipn.macsys` had no key specifying the reception destination.
  For this distribution, you may proceed to §2's transfer workflow assuming reception cannot point directly to `inbox/`
  (same treatment when the settings UI has no such option).

## 2. Connect to the workspace inbox/

- If reception can point directly to workspace `inbox/` (creator-root v1's drop area), ask the user to change
  the app setting (human action; present the change in advance under hard rule 4).
- Otherwise incorporate “reception folder → `inbox/` transfer” into the workflow. Establish the actual destination
  through a test transfer, then move each arrival (example: `mv <受信先>/<ファイル> <作業場>/inbox/`,
  whose existing placeholders mean reception folder, file, and workspace).
  Avoid overwriting; ask the user about same-name collisions.
- If no workspace exists (trial mode), use the confirmed reception destination as the asset location.
  Do not force creation of `inbox/`.

## 3. Connectivity checks (complete only when both pass — hard rule 6)

1. **Viewing**: The serve URL opened from the phone ([serve-preview.md](serve-preview.md) §3).
2. **Transfer**: Phone share sheet → Tailscale → select this PC → send 1 photo →
   the file appears in `inbox/` (or the confirmed reception destination).

## 4. Completion report

- Present serve URL / reception route (actual path and whether transfer is required) / results of the 2 connectivity checks.
- Propose appending persistent records to workspace `akari.md` **only if the user wants this**
  (no secrets — hard rule 5).
- Automatic asset-selection rules (such as “edit the latest N files”) are outside this skill's scope (contract §4).
  Leave how to use files arriving in `inbox/` to user instructions or the individual stage skills.
