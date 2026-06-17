# Desktop App Migration

This repo now uses an Electron desktop shell for the main local GUI experience.

## Why this exists

The previous packaged GUI was a `pkg` executable that started `src/guiServer.js` and opened the user's default browser. That worked, but it caused confusion because the app felt like a browser page, and it also made it easier for packaged jobs to accidentally spawn the GUI executable instead of the CLI executable.

The new path is:

```text
choops-desktop.exe
  -> Electron desktop window
  -> internal localhost backend from src/guiServer.js
  -> real choops-extractor.exe CLI backend for jobs
```

The GUI backend is intentionally still HTTP/HTML internally. This keeps the migration small, keeps all prior workflow code working, and lets the CLI remain the source of truth for extraction, roster, CDF, SCNE, and rebuild commands.

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
dist-desktop\choops-desktop.exe
```

## Current desktop app coverage

The desktop UI includes:

- dynamic full rip
- build-cache
- build modded game
- Roster Studio
- roster decode
- roster compare
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
- targeted single archive/file rip

## Backend routing

In development, Electron asks the GUI backend to spawn:

```text
node index.js <command...>
```

In a packaged build, `desktop.js` sets:

```text
CHOOPS_EXTRACTOR_CLI=<resources>/choops-extractor.exe
```

Then `src/guiServer.js` uses that executable for all job commands.

This fixes the old packaged-GUI class of bugs where GUI jobs could route through the GUI executable instead of the real CLI.

## What was removed or demoted

- The old `choops-gui` package binary entry was removed.
- The old `pkg` browser GUI packaging path was removed from the main `npm run pack` script.
- `gui.js` remains only as a legacy browser launcher for debugging through `npm run gui:browser`.
- The obsolete hidden `__roster` route in `gui.js` was removed because roster commands are now first-class CLI commands: `roster-decode` and `roster-compare`.

## Notes

This is a first desktop migration, not a rewrite into native Windows controls. The interface is still HTML rendered inside Electron. That is intentional: it gets the suite away from the user's external browser while preserving every current workflow and keeping the backend testable.

Future improvements can move client code into separate static files/components once the desktop wrapper and packaging are stable.
