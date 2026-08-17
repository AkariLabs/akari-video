**English** | [日本語](./faq.ja.md)

# FAQ & troubleshooting

## General

**Q. Do I need the app to use this?**
No. It's headless-first, so opencode or Claude Code alone takes you from planning
through export. The app (the Theia shell) is "a place to review and fix," and it's
currently mid-migration.

**Q. Can I run it fully automatically, start to finish?**
Setting `autonomy: full-auto` in `intake.json` automates approval at milestones.
That said, the `connections.json` cost approval policy still takes priority for
**billing and external sends** alone.

**Q. How far can I get without any external API?**
You can go a full loop for free, locally — proxy generation, transcription
(whisper.cpp / macOS SpeechAnalyzer), editing, captions, VOICEVOX narration, lint,
and export.

**Q. What about Windows?**
Windows is supported (including WSL2). See [dev/windows-build.md](../dev/windows-build.md)
for build details (Japanese).

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
setup-library).

**Q. I set an API key but it's still not working**
Ask to "run doctor" for a connectivity diagnosis. The key itself should live at
`~/.config/akari-video/credentials.env`, with only a reference inside the
project — that's the correct layout.

**Q. After building `apps/shell` from source, `npm start` exits silently with no window (Apple Silicon)**
Building `apps/shell` can break Electron.app's code signature while it swaps in Electron's bundled
ffmpeg library. `npm run build` re-signs it automatically afterward (`postbuild`), so this normally
doesn't surface, but if it recurs, run this by hand:
`codesign --force --deep --sign - node_modules/electron/dist/Electron.app`.

## Still stuck?

Open a [GitHub Issue](https://github.com/AkariLabs/akari-video/issues) with
reproduction steps. Attaching the report HTML from `.akari/reports/` speeds up
root-causing.
