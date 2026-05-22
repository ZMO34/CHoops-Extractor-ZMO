# CHoops Extractor ZMO Extensions

This document describes the extra commands, modules, and reverse-engineering workflows added on top of the original `CHoops-Extractor` tool. It intentionally does **not** replace the original README.

The new work focuses on three areas:

1. SCNE model extraction/debugging.
2. CDF/IFF texture-container research.
3. Experimental `teamselectlogo.cdf` DDS export/import workflows.

The tool still builds through the normal package script:

```bat
cd /d E:\CHoops-Extractor-ZMO
npm install
npm run pack
```

The packaged executable is written to:

```bat
dist\choops-extractor.exe
```

---

## Added Dependencies and Build Assets

The package has been extended with several dependencies required by the original 2K parsing utilities and the new extraction/debugging workflows:

- `env-paths`
- `uuid`
- `long`
- `stream-chunker`
- `stream-parser`

The `pkg` build also embeds these external conversion tools as assets:

- `2k-tools/lib/gtf2dds.exe`
- `2k-tools/lib/dds2gtf.exe`

These are needed for PS3/GTF texture conversion experiments.

---

# New CLI Commands

## `extract-assets`

Scans IFF/CDF containers for likely model, database, roster, and animation payloads.

```bat
dist\choops-extractor.exe extract-assets "E:\path\to\USRDIR" "E:\asset_out" --game-name choops2k8
```

Useful options:

```bat
--category <categories...>
--scan-all
--dump-top-level-raw
--include-all-unknown
--max-probe-hits <number>
--game-name <gameName>
```

Purpose:

- Helps identify unknown container payloads.
- Separates likely models, rosters, databases, and animations.
- Provides raw evidence for further reverse engineering.

Implementation entry:

```js
src/assetExtractor.js
```

---

## `decompress-cdf`

Heuristically scans a CDF file for compressed chunks and offset-table-like structures.

```bat
dist\choops-extractor.exe decompress-cdf "E:\somefile.cdf" "E:\cdf_decompressed"
```

Useful options:

```bat
--max-hits <number>
--dump-table-chunks
```

Purpose:

- Helps probe unknown CDF variants.
- Dumps possible decompressed database/roster chunks.
- Useful for research, not final extraction.

Implementation entry:

```js
src/cdfDecompressor.js
```

---

## `extract-cdf-textures`

Sequentially parses 2K-style CDF texture records and optionally attempts GTF/DDS conversion.

```bat
dist\choops-extractor.exe extract-cdf-textures "E:\teamselectlogo.cdf" "E:\cdf_texture_dump" --iff "E:\teamselectlogo.iff" --dump-full-records --dump-headers
```

Useful options:

```bat
--iff <iff file>
--dds
--limit <number>
--gtf2dds-path <path>
--keep-gtf-candidates
--dump-full-records
--dump-headers
--no-dump-payloads
--scan-all
--verbose
```

Purpose:

- Parses actual sequential CDF texture records.
- Avoids the old incorrect fallback behavior that split on every nested `0x0e4837c3` magic.
- Exports record headers, full records, payloads, per-record JSON, and a manifest.
- Links CDF records to matching IFF metadata when possible.

Important format notes discovered for `teamselectlogo.cdf`:

- The CDF is the large payload carrier.
- The IFF is a smaller metadata/linkage companion.
- `teamselectlogo.cdf` contains 520 logical records.
- Each record starts with magic `0x0e4837c3`.
- Each record also contains a nested `0x0e4837c3` subheader; this nested magic is **not** a new top-level record.
- Correct record boundary:

```text
nextOffset = recordOffset + headerASize + nestedRecordTailSize
```

- Correct legacy payload window:

```text
payloadOffset = recordOffset + recordHeaderSize
payloadSize   = nextOffset - payloadOffset
```

Implementation entry:

```js
src/cdfTextureExtractor.js
```

Important exported functions:

```js
parseCdfTextureRecords(buffer, options)
parseIffMetadataRecords(buffer, expectedCount)
extractCdfTextureRecords(cdfPath, outputPath, options)
```

---

## `export-teamselectlogo-dds`

Experimental command for exporting `teamselectlogo.cdf` records to editable DDS files.

Current default workflow:

```text
CDF record -> synthesized GTF candidate -> gtf2dds.exe -z -> DDS
```

Basic command:

```bat
dist\choops-extractor.exe export-teamselectlogo-dds "E:\teamselectlogo.cdf" "E:\teamselectlogo.iff" "E:\teamselectlogo_export"
```

Debug command with generated GTF candidates kept:

```bat
dist\choops-extractor.exe export-teamselectlogo-dds "E:\teamselectlogo.cdf" "E:\teamselectlogo.iff" "E:\teamselectlogo_export" --keep-gtf
```

Useful options:

```bat
--verbose
--export-mode <gtf|manual>
--gtf2dds-path <path>
--keep-gtf
--swizzle-mode <mode>
--image-data-offset <number>
--dump-variants
```

Additional GTF probing options supported by the implementation:

```bat
--gtf-descriptor-offsets 0x21,0x2f,0x34,0x38,0x40,0x48,0x50,0x58
--gtf-data-offsets 0x70,0x78,0x80,0x88,0x90,0xa0,0xb0
```

These are used to test possible GTF descriptor and texture-data windows within each CDF record.

Current status:

- Export is the active focus.
- Manual DDS wrapping was proven insufficient because the images remain swizzled/tiled.
- The current path probes synthesized GTF candidates so `gtf2dds.exe -z` can handle console swizzle when the correct descriptor/data window is found.
- If no GTF candidate converts, the exporter writes an attempt log such as:

```text
E:\teamselectlogo_export\gtf\0000_0x0004574d.gtf_attempts.json
```

Implementation entry:

```js
src/teamselectlogoTool.js
```

Important exported functions:

```js
makeGtfFromCdfRecord(recordBuffer, descriptorOffset, dataOffset)
exportTeamselectlogo(cdfPath, iffPath, outputPath, options)
importTeamselectlogo(originalCdfPath, manifestPath, editedDdsDir, outputCdfPath)
```

---

## `import-teamselectlogo-dds`

Experimental command for writing edited DDS data back into a `teamselectlogo.cdf` copy.

```bat
dist\choops-extractor.exe import-teamselectlogo-dds "E:\teamselectlogo.cdf" "E:\teamselectlogo_export\teamselectlogo_manifest.json" "E:\teamselectlogo_export\editable_dds" "E:\teamselectlogo_modded.cdf"
```

Current status:

- Manual-mode reimport exists for fixed-size payload experiments.
- GTF-converted reimport is intentionally disabled until `dds2gtf`-backed import is wired correctly.
- The current priority is reliable export to readable DDS.

Implementation entry:

```js
src/teamselectlogoTool.js
```

---

## `export-scne-obj`

Exports SCNE stadium/court geometry to OBJ/MTL files.

Basic command:

```bat
dist\choops-extractor.exe export-scne-obj "E:\floor.scne" "E:\floor_obj" --flip-v --position-mode declared --uv-mode declared
```

Split-parts command:

```bat
dist\choops-extractor.exe export-scne-obj "E:\arena.scne" "E:\arena_parts" --split-parts --flip-v --position-mode declared --uv-mode declared --dump-raw-buffers
```

Useful options:

```bat
--primitive-mode <strip|list>
--position-mode <mode>
--uv-mode <mode>
--experimental-auto-decode
--split-parts
--part <numbers>
--part-variants
--variant-vertex-limit <number>
--flip-v
--dump-raw-buffers
```

Purpose:

- Extracts court/stadium geometry from `.scne` files.
- Supports stable declared vertex decoding for known-good exports.
- Supports split-part debugging for isolating bad arena pieces.
- Supports experimental descriptor/topology variants for hard cases.

Implementation entries:

```js
src/scneModelExtractor.js
src/scneObjExporter.js
src/scneObjExporterStable.js
src/scneSplitPartExporter.js
```

Important functions/modules:

```js
exportScneObj(scneFile, outputPath, options)
exportScneSplitParts(scneFile, outputPath, options)
```

Known SCNE notes:

- `floor.scne` works best with declared decode modes.
- `arena.scne` has many coherent parts, but some parts may represent helpers, occluders, collision-like meshes, or alternate non-render geometry.
- `.scne` is static geometry; placement/actors/fans/bench-style data appears more likely to live in `.cdan` files.

---

## `probe`

Scans IFF/CDF files for possible embedded compression streams.

```bat
dist\choops-extractor.exe probe "E:\somefile.iff"
```

Purpose:

- Quick low-level compression probe.
- Useful for unknown IFF/CDF research.

Implementation entry:

```js
2k-tools/src/util/iffCompressionProbe.js
```

---

# New Utility Module: `src/ddsUtil.js`

This module contains DDS and block-compression helpers used by the experimental texture workflows.

Important functions:

```js
makeDdsHeader({ width, height, fourCC, dataSize, mipMapCount })
wrapDds(payload, options)
parseDds(buffer)
payloadSizeFor(width, height, fourCC, mipMapCount)
topMipSizeFor(width, height, fourCC)
blockBytesFor(fourCC)
deswizzleBcTopMip(swizzledPayload, width, height, fourCC, mode)
swizzleBcTopMip(linearPayload, width, height, fourCC, mode)
```

Supported manual swizzle/debug modes:

```text
none
linear
morton
morton-yx
block-rect
byte-rect
```

Important status note:

Manual swizzle modes are retained for research, but the current evidence suggests `teamselectlogo` should be solved through correct GTF reconstruction/conversion rather than manual DDS wrapping.

---

# Current `teamselectlogo.cdf` Findings

The current reverse-engineering evidence suggests:

- `teamselectlogo.cdf` is not encrypted.
- The CDF parser is stable and sequential.
- The paired IFF contains metadata records matching CDF record IDs.
- The visible logo size is believed to be `256x128`.
- Direct DDS wrapping creates valid DDS containers but not readable logos because the source data is still in a PS3/GTF-style tiled or swizzled layout.
- The correct solution is likely to reconstruct the correct GTF container/descriptor and allow `gtf2dds.exe -z` to perform the PS3 texture conversion.

Useful current debug command:

```bat
dist\choops-extractor.exe export-teamselectlogo-dds "E:\teamselectlogo.cdf" "E:\teamselectlogo.iff" "E:\teamselectlogo_export" --keep-gtf
```

If no GTF candidate converts, inspect:

```text
E:\teamselectlogo_export\gtf\0000_0x0004574d.gtf_attempts.json
```

---

# Recommended Working Commands

## Rebuild the EXE

```bat
cd /d E:\CHoops-Extractor-ZMO
git pull
npm install
npm run pack
```

## Test teamselectlogo export

```bat
rmdir /s /q E:\teamselectlogo_export

dist\choops-extractor.exe export-teamselectlogo-dds "E:\teamselectlogo.cdf" "E:\teamselectlogo.iff" "E:\teamselectlogo_export" --keep-gtf
```

## Test manual DDS variants only

```bat
rmdir /s /q E:\teamselectlogo_export_manual

dist\choops-extractor.exe export-teamselectlogo-dds "E:\teamselectlogo.cdf" "E:\teamselectlogo.iff" "E:\teamselectlogo_export_manual" --export-mode manual --dump-variants
```

## Export floor SCNE OBJ

```bat
dist\choops-extractor.exe export-scne-obj "E:\floor.scne" "E:\floor_obj" --flip-v --position-mode declared --uv-mode declared
```

## Export arena SCNE split parts

```bat
dist\choops-extractor.exe export-scne-obj "E:\arena.scne" "E:\arena_parts" --split-parts --flip-v --position-mode declared --uv-mode declared --dump-raw-buffers
```

---

# File/Format Role Summary

```text
.iff   metadata/index/wrapper companion in this workflow
.cdf   large payload/container carrier
.scne  static scene/model geometry
.cdan  placement/animation/actor-style data candidates
.gtf   PS3 texture container format used by gtf2dds/dds2gtf
.dds   editable PC texture interchange format
```

---

# Important Development Notes

- Do not assume EA/NCAA Basketball file formats. This project targets Visual Concepts/2K College Hoops 2K8 PS3.
- The CDF texture records contain nested magic values; do not split records by blind magic scanning.
- Keep raw record dumps and JSON manifests when testing new format assumptions.
- For `teamselectlogo`, export is currently prioritized over reimport.
- Once readable DDS export is solved, reimport should use the reverse GTF path through `dds2gtf.exe` rather than manual fixed-size payload insertion.
