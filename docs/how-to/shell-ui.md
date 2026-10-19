**English** | [日本語](./shell-ui.ja.md)

# Shell UI

The desktop app (the shell) is a place to review and fix, not to build from scratch.
You look at what the AI partner made and fix it with drags and right-clicks.
This page walks through the v1.5.0 screens in order: Home, the left panel, the Library,
the preview, the right panel, the timeline, the Script panel, and Settings.

The far-left rail reads Project / Library / Skills / Connect / Export / Channel / Settings.
The right rail holds panels such as Partner, Inspector, Script, and Annotations.
The top bar shows where you are (Channel › Project), the five-step progress, and whether the project is saved.

## Home

- **Home** lists your "Recent projects", newest first. When you open one you can choose "Open in this window" or "Open in new window". If the partner is working, you can also wait until it finishes
- **<!-- F ui.home.startButton -->+ Start a new video<!-- /F -->** opens a single "<!-- F ui.home.newProjectHeading -->New project<!-- /F -->" popup. Choose a name and a channel, then "Start blank" or "Start from a playbook". You can also create a project without a channel
- "Start from a playbook" lists playbooks from your own, your channel, and Lab, filtered by category and source. Picking one opens a confirmation sheet that shows what will be added and whether the tools it needs are available. "Import and start" creates a project with its placeholders in place
- The home of a freshly created project shows "Where would you like to start?" with three choices: "Start from a type", "Start with Assets", and "Talk to Partner"
- On a project's home you can rename it in place. "History" and "Activity" let you review and roll back what agents did. Only irreversible actions, such as publishing, submitting, paid generation, sending data out, or deleting source assets, make the agent stop and ask you to approve or decline
- First-time users get the "first video" guide. You can run it again from "Replay the first guide"

## Left project panel

At the top of the left panel you switch between Project and Library. The Project view has three bands.

- **Assets** holds what you have put into this project. Switch between thumbnail cards and a list with film strips and waveforms. The funnel at the top left filters by type: All / Video / Images / Audio / 3D settings / Placeholders / Other (3D, HTML, fonts…), with a count on each row. Pressing Placeholders selects that slot in the timeline. There is also sorting and search, and the + at the bottom right imports files from your computer
- **Records** lists planning, edit data, and reports
- **Exports** shows what you have exported. It is a slim band that shows up to three items, newest first. Drag its top edge to change its height. "Open" and "Show in Finder" work in place

Right-click an asset card (including unsorted items) or a records row to get:

- **Open** / **Show in Finder** / **Copy file** (macOS only) / **Copy path**
- **Add to timeline** (video and audio assets) — inserts at the playhead
- **Show asset info** (items under `assets/`)
- **Transcribe** (video and audio assets) — a step popup shows progress and lets you cancel midway
- **Rename** / **Delete** — both run a reference check against `edit.json` and `captions.json` first, and delete moves the file to the Trash
- **Ask the agent** — hands the file to the connected partner
- **Save to library** (a project's physical asset) — copies it into the library. The project's file and `edit.json` stay unchanged
- **Move to assets** (unsorted items only)

Rename, delete, and "Ask the agent" are limited to assets, unsorted items, and exports. Edit data, planning, and report rows get only the open-style items.

In the asset panel and in the central asset preview you can set the range to use (in / out, I / O keys). Placing the asset on the timeline brings in only that range.

## Library

The Library is one shelf of everything you can drop onto the timeline. Categories say what a thing is, and the filter picks the kind.

- **Asset categories**: BGM, SFX, B-roll, images, motion parts, 3D and avatars, fonts, and shapes. Press a tile (or card) to open its list, then drag onto the timeline or right-click to place
- **Styles**: caption styles, text animations, LUTs, and transitions. You apply them to selected text or a cut boundary, and hover plays a sample
- **<!-- F ui.library.myStyles -->My styles<!-- /F -->**: save the current look of text or captions with "Save to my styles" and apply it later. You can rename and delete them
- **<!-- F ui.library.motionParts -->Motion parts<!-- /F -->**: moving HTML assets (formerly called overlays)
- **The "Templates" shelf** sits below the categories. Templates from this computer, your channel, and Lab appear with a "Template" badge. Until you have one, the shelf shows how to export one
- **Import together from a kit** is in the Assets group under "Details". It imports the assets inside a kit in one go
- **<!-- F ui.library.channelSettings -->Channel settings<!-- /F -->** is under "Details" in "My assets"

The **filter** button to the right of the search field is a single button. It filters by source (All / Mine / Asset site / Lab), tier (Free / Pro), license (commercial use allowed / attribution required / no commercial use), and status (downloaded / not downloaded / ★). Pro assets are shown locked. Categories with no matches appear dimmed and can still be opened.

**Recently added and frequently used** on the home view shows your own assets and asset-site assets. Assets from the same folder share one chip, and pressing it filters to that folder.

### Bringing things in

- **From your computer**: use **+ → Import from device** at the bottom right, or **drop files onto the library view**. A sheet before import lets you check types and counts and choose SFX or BGM for ambiguous audio. Unsupported and duplicate files appear separately with their reasons. Audio, images, video, and fonts can be dropped together
- **Fonts**: they are usable right after import and are listed by typeface name under Text › Fonts. A font card offers "Show location" and "Remove from library"
- **Find on asset sites**: + → Find on asset sites opens a listed site in a central tab. Search and preview on the site's own page; you press the download link yourself. When the download finishes, choose "Add to library" or "Discard". AKARI's recommendations open the page and outline the download link but never press it. Subscription imports carry a "Subscription" badge
- **From Lab**: open Lab from the + menu. The app connects to Lab with `akari store connect`. You can also install a playbook with `akari store install <id>`
- **Source badges**: cards carry a source badge: Mine, Lab, or Bundled

## Center preview

The output preview plays your timeline for real.

- **Select and move**: click to select an element, then drag or use the arrow keys to move it. Edge and corner handles resize it, and the rotation handle turns it. The selection box fits the visible content. Elements inside an HTML asset can be selected too (the original file is not rewritten; only your changes are kept in the project). Click a styled on-screen text (telop) to select it as a whole, and double-click the text to edit it
- **Keyframes**: after changing position, size, or rotation, "◆ Add keyframe" above the selection sets a key at that time
- **3D**: selecting a 3D part adds a "3D" section to the Inspector, where you can set rotation numerically. In the preview, press the body to move it and use the colored rings to rotate. Drop a video or image onto a 3D part to show it on that screen
- **Mark it up and hand it to AI**: the second row of the playback bar holds **Pen, Pin, Range, and Attach**. Mark a spot and write a note, and the captions and footage there are recorded with it. Once confirmed, it becomes an **annotation** in the right panel. You can drag a placed pin. The note field and attachment list are a small window you can keep open while you play and seek
- The sound played while seeking (scrub audio) can be turned on in Settings under Preview quality. It is off by default

## Right panel

- **Inspector**: the settings of what you selected, such as text (font, size, color), color, motion, and 3D. When you select a transition you can change its type, direction, length, and position, or set it to none. Keyframes are handled here too
- **Annotations**: the marks and recordings you made in the preview, in an order you can read from the top. You can **<!-- F ui.annotation.handToAi -->Hand to AI<!-- /F -->** one at a time or all together. It stops once the request is in the partner's input field. For a pen stroke, "from where to where" is written into the request. Annotations and recordings can be deleted
- **Partner**: where the AI partner (Claude Code, Codex, opencode, Cursor Agent, Muse Code, and others) runs. The open project becomes the working project, and the partner you used last opens automatically

## Timeline

- **The Script row** is the top row. Plans from a playbook appear as bands and memos as dots. Press one to jump to that time
- **The left column** holds track names and controls. Drag its edge to change its width, and the width is remembered next time. Hover a cut-off name to see the full text. Every row has an icon for its type
- **Right-click a clip** for **Copy / Paste / Split / Delete**, the same operations as the keyboard
- **Drag and drop assets**: drag an asset card onto the timeline to see a duration ghost of the span it will take, and choose the target track. Video and images land in `layers[]` (stacked visuals) or `cuts` (the main cut track) depending on the row you drop onto, and audio lands in `audio.sfx[]`. If an asset overlaps an existing clip, it goes onto a new track just above that row for video or images, or just below it for audio. Placement is checked again with the actual duration, and one Undo removes both the new track and the added asset
- **Drop from Finder**: video files are imported into `assets/` first and then placed where you dropped them. Dropping outside the timeline (panels, home) only imports them
- **Snapping**: snapping works the same way between any two kinds of objects
- **Transitions**: a "+" appears at the seam between clips. Press it to open a picker with previews. You can also drag a Library card onto the seam. Seams that cannot take one show a faint "+", and pressing it tells you why. When the source media is short, the transition moves to the side that has spare footage. If that is still not enough, you can **fill with held frames** (a check appears before you confirm, and the held span is hatched on the band)
- **Place a template**: drag one from the "Templates" shelf onto the timeline and it lands as one grouped block. The assets it uses come along, and one Undo removes everything
- **Drop onto an empty slot to swap**: drop an asset onto an empty slot (placeholder) and it fills the slot at the slot's length. If the type does not fit you see "This asset type does not fit the slot."
- **Undo**: undo and redo cover edits you make in the app. If an agent changed the same edit while you were editing, the app does not overwrite it silently; it reloads and tells you

## Script panel

The Script panel lists transcript lines grouped by source file (press a heading to open it; "Open all" is available).

- **Plans and memos**: plans from a playbook (a span such as "0:00–0:03 Hook: …") and memos appear together in time order. Tick a plan off when it is done, and use "+ Memo" to add a memo at the current playhead. Turn off "Show plans and memos" under "Display" to get a captions-only script. Press a row to jump to that time
- **<!-- F ui.library.captionStyleSingular -->Caption style<!-- /F -->**: select words and apply a caption style. Applying it to the **whole caption** does not change the caption's size. You can also apply it to **selected words only**, and the preview outlines them with a dotted frame. "Restore whole-caption appearance" undoes that
- **Speakers**: captions with split speakers get a speaker tag. You can connect it to a person or give it a name, and "Filter by speaker" shows one speaker's lines
- The 🎙 on a row records a voice-over while showing the text read from the start of that row

## Projects with scenes

A long piece can be divided into scenes inside one project.

- Opening a project with scenes shows the scene list. "+ Add scene" adds one
- Inside a scene the top bar reads "Channel › Project › Scene ▾", and the ▾ moves you to another scene
- The list page has **Scenes / Structure / Relations** tabs. Structure is a tree of project → scene → cut and shows durations, placeholder counts, and whether captions and exports exist. Relations is a diagram of how assets, styles, people, and documents connect, with missing or stale items drawn dotted
- When something is missing or not downloaded, a band at the top of the screen reads like "1 missing · 1 not downloaded"
- Assets shared across the whole project appear in a scene's asset list with a "Shared" mark. You cannot rename or delete them from inside a scene

## Settings

Open Settings from the far-left rail to see six pillars on the left. Choosing one shows its items as a single page on the right, and the table of contents in the middle jumps to an item.

- **General**: your AKARI account, the first-time guide, help, and About. "Release channel" is in About (the default is "<!-- F ui.settings.stableOnly -->Stable only<!-- /F -->"; choose "<!-- F ui.settings.prereleaseToo -->Include prereleases<!-- /F -->" to receive beta versions too)
- **Partner**: the AI that works with you. Each shows "current version · latest version", and "Update" appears when a newer version exists. "Show AKARI Chat (preview)" is here too (hidden by default)
- **Connect**: connections to outside services and their keys, AI models, narration, transcription, and export defaults. Enter keys card by card; the status reads "Available" or "Key required", and only the last 4 characters of a key are shown
- **Workflow and limits**: preview quality (including the scrub-audio on/off), notifications, and tools
- **Display**: appearance (color and display language: Automatic / 日本語 / English) and shortcuts
- **Data locations**: storage (how much disk AKARI uses) and privacy and access permissions

## Everything lands in the save file

All of these operations write to the same file contracts that agents read and write.
Edits go to `edit.json`, preview annotations to `review.json`, captions to `captions.json`,
and the project's inventory to `.akari/manifest.json`. There is no UI-only state.
Anything you do by mouse can be continued conversationally, and vice versa.

## Related

- What each file under `.akari/` means → [Project structure](./project-structure.md)
- How screen words are decided → [contract-2026-10-16-vocabulary-v0.md](../contract-2026-10-16-vocabulary-v0.md) (Japanese)
- The preview behavior spec → [contract-2026-08-02-preview-parity.md](../contract-2026-08-02-preview-parity.md) (Japanese)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
