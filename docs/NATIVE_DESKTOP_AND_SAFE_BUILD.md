# Native Desktop App and Safe Build Copy Workflow

## Goal

The normal user-facing app should run locally as a native Windows executable, not as a browser tab, hosted browser page, Electron shell, or webview-first UI.

The backend remains the existing `choops-extractor.exe` CLI because that keeps every operation scriptable, logged, and testable.

## Executables

Default packaging now produces:

```text
dist/choops-extractor.exe
    Command-line backend used by the native desktop app and by power users.

dist-native/choops-native-desktop.exe
    Native WinForms desktop app.
```

Build command:

```bat
npm run pack
```

Development command:

```bat
npm run desktop
```

## Why WinForms

Electron is local, but it still embeds Chromium. The native app is a WinForms application so it is not browser/webview based. It uses native controls and spawns the CLI backend with redirected output.

## Included native app workflows

- Build Copy, recommended safe build path
- Advanced in-place build, for disposable copies only
- Dynamic full rip
- Build cache
- Roster decode
- Roster compare
- Native CSV roster table view/edit/save
- IFF inspection
- Smart scan
- Reference scan
- Asset candidate extraction
- CDF decompression research
- CDF texture extraction
- teamselectlogo export/import
- SCNE OBJ export
- floor.scne inspection
- compression probe

## Safe Build Copy

The old build behavior modifies the selected game folder. That is dangerous when the selected folder is the user's only vanilla extraction.

The new safe default is:

```bat
choops-extractor build-copy <vanilla-game-or-USRDIR> <mod-folder> <output-modded-copy> --game-name choops2k8
```

The command:

1. Rejects raw `.iso` input because ISO extraction/rebuild is not implemented directly.
2. Copies the vanilla extracted folder to the requested output folder.
3. Locates `USRDIR` inside the copied output.
4. Runs the existing builder only against the copied `USRDIR`.
5. Writes `choops_build_copy_manifest.json` into the copied output folder.

This means the vanilla source folder is never modified.

## Copy optimization

The copy layer uses a custom optimized copier:

```text
src/util/optimizedCopy.js
```

It provides:

- destination safety checks,
- refusal to copy into the source folder,
- concurrent file copying,
- best-effort copy-on-write/offloaded copy through `COPYFILE_FICLONE`,
- normal byte-for-byte fallback when clone/offloaded copy is not supported,
- mode/timestamp preservation where possible,
- progress logging every 100 files.

The default copy concurrency is 8 and can be changed:

```bat
choops-extractor build-copy <vanilla> <mod> <output> --copy-concurrency 12
```

## Important safety note

Do not use hardlinks for game archive copies. Hardlinks share the same underlying file bytes and can make modifications affect both the copy and vanilla source. This implementation intentionally avoids hardlinks and uses copy-on-write/offloaded copy only where the filesystem safely supports it, with normal copy fallback.

## Current limitation

The native app includes a CSV roster table editor for decoded roster exports. Binary write-back from edited CSV/workbook into ROST is still a separate future workflow and must remain validation-gated.

## Next optimization targets

1. Stream archive repack writes so huge archive parts are not fully buffered unless necessary.
2. Add incremental build detection so unchanged mod folders do not trigger unnecessary replacements.
3. Add manifest-based dirty-file tracking for ripped mod projects.
4. Add per-job timing and byte counters to the native app.
5. Add cancellation support for long-running CLI jobs.
6. Add worker-thread pools for CPU-heavy TXTR/SCNE research conversion paths.
