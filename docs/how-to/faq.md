**English** | [日本語](./faq.ja.md)

# FAQ & troubleshooting

## General

**Q. Do I need the app to use this?**
No. It's headless-first, so opencode or Claude Code alone takes you from planning
through export. The app (the Theia shell) is the main entrance and "a place to review and
fix" — you can also run your agent in its partner pane.

**Q. Can I run it fully automatically, start to finish?**
The default, **With suggestions** (`checkpoint`), has no intermediate approvals; export is the
only stamp. `full-auto` (Fully automatic) exports without preview review, while
`collaborative` (Create together) confirms three stages: direction → asset plan → execution.
Approval for **billing and external sends** is independent of this, and the `connections.json`
cost approval policy takes priority.

**Q. How far can I get without any external API?**
You can go a full loop for free, locally — proxy generation, transcription
(whisper.cpp / macOS SpeechAnalyzer), editing, captions, VOICEVOX narration, lint,
and export.

**Q. What about Windows?**
Windows is supported: there is a desktop app (installer `.exe` or `.zip`) and the `akari`
CLI. See [dev/windows-build.md](../dev/windows-build.md) for build details (Japanese).

**Q. Windows shows a SmartScreen warning when I start the installer**
The Windows installer is not code-signed yet, so SmartScreen may warn on first launch.
Choose "More info" and then "Run anyway" if you downloaded it from the official release
page. The macOS app is signed with a Developer ID and notarized by Apple.

**Q. How do I switch between the stable and beta versions?**
Open Settings → About this app → **Release channel**. **<!-- F ui.settings.stableOnly -->Stable only<!-- /F -->** is the default;
**<!-- F ui.settings.prereleaseToo -->Include prereleases<!-- /F -->** also offers beta builds so you can try new features sooner.
Switch back to <!-- F ui.settings.stableOnly -->Stable only<!-- /F --> when you want to stay on stable releases.

**Q. The docs use screen names or commands that differ from my app**
<!-- BEGIN GENERATED facts:shipped-note -->
The shipped v1.5.0 build displays “My Styles” → “My styles”, “Overlay” → “Motion parts”, “Template” → “Caption style”, “Brand kit” → “Channel settings”. The next release uses the names on the right. Use `--template` in the shipped v1.5.0 build. `--scaffold` arrives in the next release. Use `akari playbook template` in the shipped v1.5.0 build. `akari template export` and `akari template list` arrive in the next release. The older CLI names remain aliases.
<!-- END GENERATED facts:shipped-note -->

| Docs (new) | v1.5.0 app (older name) |
|---|---|
| <!-- F ui.library.motionParts -->Motion parts<!-- /F --> | Overlays |
| <!-- F ui.library.myStyles -->My styles<!-- /F --> | My styles / saved presets |
| <!-- F ui.library.captionStyleSingular -->Caption style<!-- /F --> | Caption template |
| <!-- F ui.library.channelSettings -->Channel settings<!-- /F --> | Brand kit |
| 3D settings | 3D recipes |
| Templates shelf in the Library | "Scaffold" and "Set" tiles |
| `akari new --scaffold` | `akari new --template` |
| `akari template export` | `akari playbook template` |

**Q. Can I change the language of the app?**
Yes. Settings → Display → **Language** → Display language: Automatic (OS language), 日本語, or
English. The window reloads when you switch.

**Q. I can't find AKARI Chat**
AKARI Chat (preview) is hidden by default. Turn on **Show AKARI Chat (preview)** in
Settings → Partner. For regular work, connect a partner such as Claude Code or Codex
(see [Connections and API keys](./connections.md)).

## Playbooks, templates, and Lab

**Q. What is the difference between a playbook and a template?**
A **playbook** is something you read: the steps, check points, settings, and placeholder
slots for one video. It holds no footage. Start one from Home → "<!-- F ui.home.startButton -->+ Start a new video<!-- /F -->" → "Start from a
playbook" or with `akari new <dir> --from <playbook>`. A **template** is a finished chunk
you place on the timeline: length, text, frames, and sound are already decided, and you
only swap the footage into its placeholder slots. A template is a playbook one level deeper.

**Q. The Templates shelf in the Library is empty**
No templates are bundled. You will see "No templates yet" until you add one. Export a group
from your own video with
`akari template export <project> --item <group item id> --id <template id>`, and it
appears on the shelf. `akari template list` shows what you have.

**Q. What is free in Lab, and what is Pro?**
Lab has two tiers: free and Pro. Free assets are CC0 and are available once you link your
account; Pro assets are unlocked by your entitlement and carry the AKARI assets license
(each pack includes its `LICENSE.md`). Link your account with `akari store connect`
([details](./connections.md)).

**Q. How do I apply a caption look to the whole caption or only some words?**
In the script panel, apply a caption style to the **whole caption**, or select words and
choose **Selected words** to apply it only to them. Applying to the whole caption does not
change the caption size. To undo a per-word look, choose "Restore whole-caption appearance".
For a project with older captions, AKARI suggests locking the caption appearance once;
`akari captions migrate-look <project> [--dry-run]` does the same from a terminal.

## Transcription & export

**Q. Which transcription engine is used?**
The default is automatic. On macOS the local engine is SpeechAnalyzer, with whisper.cpp as
the fallback (and the local engine on other platforms). If whisper.cpp has no model yet,
run `akari tools install whisper` (or Settings → Tools → Whisper). Cloud engines
(ElevenLabs Scribe, Groq) are used only if you set their keys, and the cost and destination
are shown first. Pick one explicitly with
`--backend <speech-analyzer|whisper-cpp|cloud:<id>>`.

**Q. Which export engine is used?**
`--engine auto` (the default) uses the fast GPU engine when your footage and effects qualify
and your GPU has a hardware encoder; otherwise it uses OSR (Electron off-screen rendering).
The export dialog says when it chose OSR and why. `--engine gpu` fails with the reason when
the project does not qualify, and `--engine osr` always works.

## Editing & data

**Q. Can I edit edit.json by hand?**
Sure. It's plain text, so direct edits and git tracking both work. After editing,
run [edit-lint](../guides/review-and-fix.md).

**Q. If I reorder cuts, do captions and annotations drift out of sync?**
No. Timestamps are always persisted as (asset, seconds within the source asset),
by convention — never dependent on timeline position.

**Q. I want to revert to a previous state**
If the project is tracked in git, all save data is text, so `git diff` and revert
are your "edit history," directly.

## Error handling

**Q. My chat cuts off partway through**
If you run a partner in its "extension" form (the Claude Code / Codex extensions),
the conversation is cut off whenever the extension host restarts. For long sessions we
recommend the CLI form (`Claude Code CLI`, the entry marked as recommended in the partner
pane, runs in a PTY tab and is not affected).
After a cutoff, type `/akari` in the partner pane to continue from the current state; from
a terminal, use `akari --continue`. See
[Resume where you left off](./resume-session.md) for details.

**Q. edit-lint FAILs**
`.akari/reports/edit-lint-report.html` shows the count and reasons. You can ask
"fix the lint FAILs" to have it handled for you. You can't proceed to export while
it's FAILing.

**Q. render-cut's verify FAILs**
Check the stderr summary in `.akari/reports/render-report.html`. You can ask
"investigate the render failure" to start from diagnosis.

**Q. It says ffmpeg / whisper / Blender is missing**
Each skill walks you through installation when it detects this. To check
everything at once, say "check my setup status" (the tool check in
setup-library), or run `akari doctor`. The whisper model is fetched with
`akari tools install whisper`.

**Q. I set an API key but it's still not working**
Ask to "run doctor" for a connectivity diagnosis. The key itself should live at
<!-- F paths.credentials -->`~/.akari/credentials.env`<!-- /F --> (keys in the older location,
<!-- F paths.credentials.legacy -->`~/.config/akari-video/credentials.env`<!-- /F -->, are still read), with only a reference inside the
project — that's the correct layout. Settings → Connect shows which services are usable.

**Q. A project opens slowly, or Home feels heavy**
Update to v1.4.1 or later. Earlier versions re-read every project each time you saved,
which made Home and the project list slow when you had many projects; now only changed
projects are read, and only while the list is visible. If a project was made with an older
`edit.json` format, `akari migrate [dir]` converts it to v2 and keeps a backup. If it still
will not open, run `akari doctor`, then open a GitHub Issue with the report from
`.akari/reports/`.

**Q. After building `apps/shell` from source, `npm start` exits silently with no window (Apple Silicon)**
Building `apps/shell` can break Electron.app's code signature while it swaps in Electron's bundled
ffmpeg library. `npm run build` re-signs it automatically afterward (`postbuild`), so this normally
doesn't surface, but if it recurs, run this by hand:
`codesign --force --deep --sign - node_modules/electron/dist/Electron.app`.

## Still stuck?

Open a [GitHub Issue](https://github.com/AkariLabs/akari-video/issues) with
reproduction steps, or ask in the Discord community (https://akari.video/discord). Attaching the report HTML from `.akari/reports/` speeds up
root-causing.

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.0 (released 2026-10-17).
<!-- END GENERATED facts:stamp -->
