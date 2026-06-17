# Native Desktop App Migration

The main local GUI path is now a native Windows WinForms app, not a browser tab, Electron shell, or hosted webview UI.

## Current path

```text
choops-native-desktop.exe
  -> native WinForms controls
  -> directly spawns choops-extractor.exe
  -> streams stdout/stderr into the native job log
  -> parses structured progress events for long rip/build jobs
```

The CLI remains the source of truth for extraction, roster, CDF, SCNE, and rebuild commands. The native app is a local desktop shell around those commands.

## Build commands

Install dependencies:

```bat
npm install
```

Run desktop app in development:

```bat
npm run desktop
```

Build release executables:

```bat
npm run pack
```

Expected outputs:

```text
dist\choops-extractor.exe
dist-native\choops-native-desktop.exe
```

## Current native app coverage

The native UI includes:

- safe Build Copy workflow
- advanced in-place build for disposable copies
- dynamic full rip
- build-cache
- roster decode
- roster compare
- native CSV roster table view/edit/save
- IFF inspection
- smart scan
- reference scan
- asset candidate extraction
- CDF decompression research
- CDF texture extraction
- teamselectlogo DDS export
- teamselectlogo DDS import
- SCNE OBJ export
- floor.scne inspection
- compression probe

## Progress bar support

The native desktop app now shows one shared visual progress bar above the job log.

Long-running commands are automatically launched with:

```text
--progress
```

for:

```text
rip
build
build-copy
```

When `--progress` is enabled, the CLI emits hidden machine-readable lines prefixed with:

```text
__CHOOPS_PROGRESS__
```

The native app parses those lines and updates:

- progress percentage
- current phase
- current status message
- indeterminate/marquee state for work where exact totals are not known yet

Normal CLI logs are still shown in the job log. The progress event lines are consumed by the native UI instead of being displayed as noisy log text.

Current progress coverage:

```text
rip:
  preparing output/logs
  loading hash resolver
  reading archive table
  ripping containers
  enhanced standard-IFF preservation pass
  enhanced CDF-backed extraction pass
  NAME/AUDO metadata pass

build-copy:
  preparing safe output
  indexing/copying vanilla JB folder
  locating copied USRDIR
  applying mod overrides
  repacking archives
  writing manifest

build:
  preparing controller
  reading archive table
  scanning mod folder
  applying overrides
  repacking archives
```

## Backend routing

The native app locates `choops-extractor.exe` by checking:

1. `CHOOPS_EXTRACTOR_CLI`, if set.
2. `choops-extractor.exe` beside the native app.
3. `dist\choops-extractor.exe` in development layouts.

All jobs are spawned through `ProcessStartInfo.ArgumentList`, so paths with spaces are passed safely.

## What was removed or demoted

- Electron is no longer the default desktop release path.
- The default `npm run pack` script now builds the native WinForms app.
- Browser/server GUI code is no longer the release UI path.
- The CLI keeps all tool behavior centralized and testable.

## Important distinction

The native CSV roster editor can open and save decoded CSV exports. Binary write-back from edited CSV into ROST is still a future validation-gated feature and should not be presented as complete until the writer is implemented and tested.
