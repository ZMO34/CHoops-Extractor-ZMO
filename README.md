## CHoops Modding Suite

This project is a College Hoops 2K8 PS3-focused archive, roster, texture, CDF/IFF, SCNE, and rebuild research suite.

The repo now builds two main Windows executables:

```bat
npm install
npm run pack
```

Outputs:

```text
dist\choops-extractor.exe      command-line backend
dist-desktop\choops-desktop.exe desktop app
```

The desktop app replaces the old packaged browser GUI. It opens a local application window, while tool jobs still route through the CLI backend so every workflow remains scriptable, logged, and debuggable.

### Desktop app

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
dist-desktop\choops-desktop.exe
```

The app includes:

- dynamic full rip
- build-cache
- build modded game
- roster editor / Roster Studio
- roster decode / compare
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

### Preservation rules

- College Hoops 2K8 PS3 standard archive IFFs use magic `0xFF3BEF94`.
- CDF-backed metadata IFFs use magic `0xF0985030` and must be handled as paired `.iff/.cdf` banks.
- Uniforms such as `ua###.iff`, `uh###.iff`, and `ux###.iff` are standalone standard IFFs, not CDF-backed pairs.
- Raw containers and unknown fields should be preserved before conversion/import attempts.
- Rebuild changes should be tested with same-size or preservation-safe edits before broader size-changing work.

### Legacy browser launcher

The old browser launcher is still available for debugging only:

```bat
npm run gui:browser
```

Release builds should use the desktop app instead.
