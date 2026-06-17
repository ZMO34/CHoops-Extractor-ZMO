## CHoops Modding Suite

This project is a College Hoops 2K8 PS3-focused archive, roster, texture, CDF/IFF, SCNE, and rebuild research suite.

The current release path builds a command-line backend and a **native Windows desktop app**. The desktop app is WinForms-based and does not use a browser, hosted browser tab, or Electron/WebView shell.

```bat
npm install
npm run pack
```

Outputs:

```text
dist\choops-extractor.exe          command-line backend
dist-native\choops-native-desktop.exe native desktop app
```

The native app keeps the heavy work in `choops-extractor.exe`, so every workflow remains scriptable, logged, and debuggable while the user-facing app stays local/native.

### Native desktop app

For development:

```bat
npm run desktop
```

For release packaging:

```bat
npm run pack
```

Then run:

```bat
dist-native\choops-native-desktop.exe
```

The native app includes:

- safe Build Copy workflow
- advanced in-place build for disposable copies
- dynamic full rip
- build-cache
- roster decode / compare
- simple native CSV roster table editing
- IFF inspection
- smart scan
- reference scan
- asset candidate extraction
- CDF texture extraction
- teamselectlogo DDS export/import
- CDF decompression research
- SCNE OBJ export
- floor.scne inspection
- compression probing

### Safe modded-copy workflow

The recommended build path no longer modifies your vanilla extracted game folder.

```bat
dist\choops-extractor.exe build-copy <vanilla-game-or-USRDIR> <mod-folder> <output-modded-copy> --game-name choops2k8
```

Examples:

```bat
dist\choops-extractor.exe build-copy "D:\Games\CH2K8\PS3_GAME" "D:\Mods\MyRip" "D:\Games\CH2K8_MODDED\PS3_GAME" --game-name choops2k8
```

```bat
dist\choops-extractor.exe build-copy "D:\Games\CH2K8\PS3_GAME\USRDIR" "D:\Mods\MyRip" "D:\Games\CH2K8_MODDED\USRDIR" --game-name choops2k8
```

`build-copy` copies the vanilla folder to a new output folder first, then applies the mod only to the copied game. It writes:

```text
choops_build_copy_manifest.json
```

inside the copied output folder.

If the output folder already exists:

```bat
dist\choops-extractor.exe build-copy <vanilla> <mod> <output> --overwrite
```

### CLI usage

The CLI remains the safest automation/debug path:

```bat
dist\choops-extractor.exe rip <path-to-PS3_GAME\USRDIR> <output-folder> --build-cache --game-name choops2k8
```

List supported game profiles:

```bat
dist\choops-extractor.exe profiles
```

Build only the dynamic cache:

```bat
dist\choops-extractor.exe build-cache <path-to-PS3_GAME\USRDIR> --game-name choops2k8
```

Decode a roster source:

```bat
dist\choops-extractor.exe roster-decode <roster_english.iff-or-USERDATA-or-save.zip> <output-folder>
```

Compare two roster sources:

```bat
dist\choops-extractor.exe roster-compare <base-roster> <custom-roster> <output-folder>
```

Advanced in-place build still exists, but use it only on a disposable copy:

```bat
dist\choops-extractor.exe build <path-to-copied-PS3_GAME\USRDIR> <mod-folder> --game-name choops2k8
```

### Preservation rules

- College Hoops 2K8 PS3 standard archive IFFs use magic `0xFF3BEF94`.
- CDF-backed metadata IFFs use magic `0xF0985030` and must be handled as paired `.iff/.cdf` banks.
- Uniforms such as `ua###.iff`, `uh###.iff`, and `ux###.iff` are standalone standard IFFs, not CDF-backed pairs.
- Raw containers and unknown fields should be preserved before conversion/import attempts.
- Rebuild changes should be tested with same-size or preservation-safe edits before broader size-changing work.

### Requirements

- Node.js/npm for CLI packaging.
- .NET 8 SDK for building the native WinForms desktop app.
- Windows x64 for the native desktop release target.
