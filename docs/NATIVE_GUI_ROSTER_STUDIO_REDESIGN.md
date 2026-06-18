# Native GUI and Roster Studio Redesign

This note documents the June 2026 native desktop redesign of the CHoops Modding Suite.

## Goals

The native `.exe` GUI should be at least as usable as the previous browser GUI while remaining fully local and browser-free. The current design targets an icy blue / white visual identity with larger controls, readable grouping, and a workflow-oriented layout.

## Main UI changes

- Replaced the cramped tab-only prototype with a real shell layout:
  - top branded header,
  - left navigation sidebar,
  - central workspace,
  - right job log / progress panel.
- Commands are grouped by workflow rather than dumped into one form.
- The dashboard exposes common actions directly:
  - Safe Build Copy,
  - Dynamic Full Rip,
  - Roster Studio,
  - Research Tools.
- The right-side status panel keeps the structured rip/build progress bar and log visible at all times.
- The UI theme uses dark navy panels, icy blue accents, white text, and high-contrast input controls.

## Command category layout

| Section | Purpose |
| --- | --- |
| Dashboard | Project overview and quick actions |
| Safe Build | Build Copy and advanced in-place build |
| Rip / Cache | Full rip and cache tools |
| Roster Studio | Roster source decode, players, teams, slots, arenas, coaches, palette lab |
| Assets | IFF/CDF texture and teamselectlogo tools |
| Courts / SCNE | SCNE export and floor.scne inspection |
| Research Tools | Profiles, IFF inspection, smart scan, reference scan, compression probe |
| About / Help | Safety notes and workflow guidance |

## Roster Studio fix

The old prototype exposed a CSV grid directly. That caused users to accidentally open raw `USERDATA` or save files as text, producing corrupted-looking rows.

The redesigned flow is:

```text
Roster source file
  -> roster-decode CLI command
  -> decoded CSV output folder
  -> native tables loaded from players.csv / teams.csv / roster_slots.csv / arenas.csv / coaches.csv
```

Supported source inputs are whatever `roster-decode` supports:

- `roster_english.iff`,
- decrypted save ZIP containing `USERDATA`,
- raw decrypted `USERDATA`,
- raw ROST payload.

The UI now labels this clearly as a decode-first workflow.

## Roster table features

- Separate tabs for Players, Teams, Roster Slots, Arenas, and Coaches.
- Search box filters the active table.
- Active table can be saved back to its decoded CSV.
- Team selection updates the color/palette context label.
- Double-clicking a hex-like color cell opens a native `ColorDialog`.

## Color picker / palette lab

The Roster Studio includes an experimental color picker strip for the known team palette research region. It does not yet claim binary write-back to ROST. It is designed to support the ongoing controlled-diff research around team/school/court colors.

Default visible palette candidates:

| Offset | Label |
| --- | --- |
| `+0x1A4` | Primary |
| `+0x1B4` | Secondary |
| `+0x1C4` | Trim |
| `+0x1D8` | Line A |
| `+0x1E0` | Line B |
| `+0x200` | Court |
| `+0x210` | Accent |

The palette strip can export `palette_research.json` into the active decoded roster output folder.

## Important limitation

This redesign fixes the native UI and table workflow, but it does not yet implement full binary ROST write-back from edited CSV tables. Current editing is CSV-level and research-level. Safe write-back should be implemented only after roster writer validation is added.
