# College Hoops 2K8 PS3 `floor.scne` Format Notes

This note documents the current reverse-engineered structure of the `floor.scne` subfile used inside `s###.iff` arena files. It focuses on the court/floor package, model parts, draw runs, vertex buffers, UVs, and the implications for full-court texture mods.

## Container overview

A ripped `floor.scne` is normally wrapped as a two-block `2kTl` tool file:

- Block 0: SCNE/package header, texture headers, model-part records, material records, draw-run records, vertex-buffer descriptors, vertex declarations, names, and other header-side metadata.
- Block 1: texture payloads followed by model geometry payloads. Geometry payloads include index buffers and vertex buffers.

The package header starts at the beginning of block 0 and is `0x54` bytes.

Important package header fields:

| Offset | Meaning |
| ---: | --- |
| `0x00` | package name offset + 1 |
| `0x20` | texture count |
| `0x24` | relative texture table pointer; actual offset = value + `0x23` |
| `0x44` | model-part count |
| `0x48` | relative model-part table pointer; actual offset = value + `0x47` |

Texture headers and model parts are separate systems. Texture headers decide what texture payload exists and where it lives. Model parts decide which geometry, material, UVs, and draw pass render surfaces.

## Texture table

Each texture header is `0xB0` bytes.

Common fields:

| Offset | Meaning |
| ---: | --- |
| `0x58` | GTF/texture format word copied during DDS→GTF import |
| `0x5C` | remap/control word; differs between diffuse and normal/gloss textures |
| `0x60` | packed dimensions, usually width in high 16 bits and height in low 16 bits |
| `0x64` | usually mip/count or related texture parameter |
| `0x68` | pitch/linear-size-like field |
| `0x6C` | additional GTF parameter |
| `0x90` | repeated packed dimension word used by SCNE package textures |
| `0xA4` | texture data offset + 1 into block 1 |

For many floor packages:

- `texture_0`: base wood/floor diffuse texture. It is normally tiled through UVs.
- `texture_1`: apron texture. On some modded floors it has been expanded to full-court coverage.
- `texture_2`: normal/gloss/greenmap-style partner for `texture_0`.
- Later texture slots: paint, line, center logo, overlays, and school-color-controlled layers.

## Model parts

Known court model parts are usually:

| Part index | Name | Role |
| ---: | --- | --- |
| 0 | `floor` | base floor and apron geometry/material route |
| 1 | `paint` | key/paint colorized court regions |
| 2 | `centerlogo` | center logo and center-circle regions |
| 3 | `lines` | line overlays and colorized line regions |

Each model-part record is `0xB0` bytes / 44 big-endian `u32` fields.

Important model-part fields:

| Offset | Field | Meaning |
| ---: | --- | --- |
| `0x00` | relative pointer | UTF-16BE part name pointer, relative to this field |
| `0x04` | hash/id | part identity hash/id |
| `0x08` | flag | usually visibility/enabled flag |
| `0x10` | float | bounding radius/scale-like value |
| `0x30..0x38` | floats | bounds center X/Y/Z |
| `0x4C..0x54` | floats | scale X/Y/Z |
| `0x60` | Section A count | material record count |
| `0x64` | Section A pointer | material records; target = field offset + value - 1 |
| `0x7C` | Section B count | draw-run count |
| `0x80` | Section B pointer | draw-run records; target = field offset + value - 1 |
| `0x84` | Section C count | vertex-buffer descriptor count |
| `0x88` | Section C pointer | vertex-buffer descriptors; target = field offset + value - 1 |
| `0x94` | Section D count | vertex attribute declaration count |
| `0x9C` | Section D pointer | vertex declarations; target = field offset + value - 1 |
| `0xA4` | index flags | primitive/index flags, commonly `0x20000010` |
| `0xA8` | index count | number of 16-bit BE indices in block 1 |
| `0xAC` | index offset + 1 | index-buffer byte offset + 1 into block 1 |

Important correction: the index count is at `0xA8`, not `0xA4`. The `0xA4` word is a flags/primitive word.

## Section A: material records

Section A records are `0x30` bytes each.

| Offset | Meaning |
| ---: | --- |
| `0x00..0x1F` | material/color parameters |
| `0x20` | material name pointer, relative to this field |
| `0x24` | material hash/id |
| `0x28` | material/color-routing flag |
| `0x2C` | material/layer-routing flag |

Observed material names include:

- `floor`
- `apron`
- `apron2`
- `paint`
- `centerlogo`
- `lines`
- `key_hash_3`
- `outer_lines`
- `lane_line1`
- `lane_line2`

## Section B: draw-run records

Section B records are `0x30` bytes each. These are the draw batches/submeshes for a model part.

| Offset | Meaning |
| ---: | --- |
| `0x00` | constant, usually `6` |
| `0x04` | index start within this part's index buffer |
| `0x08` | index count for this draw run |
| `0x0C` | triangle-strip span, normally index count - 2 |
| `0x10` | zero |
| `0x14` | vertex start |
| `0x18` | vertex count |
| `0x1C` | zero |
| `0x20` | draw/pass id |
| `0x24` | zero |
| `0x28` | zero |
| `0x2C` | render/pass flag |

The draw/pass id is important. Known one-run floors use part 0 draw/pass id `0` for the base floor path. A modded full-court texture using draw/pass id `1` can render with correct coverage but remain linked to Edit School colorization, depending on the material/pass route.

## Section C: vertex-buffer descriptor

Section C records are `0x30` bytes each. The useful descriptor starts at `+0x10` within the record.

| Offset | Meaning |
| ---: | --- |
| `0x00..0x0F` | reserved/zero in known floor files |
| `0x10` | vertex count |
| `0x14` | stream/buffer count, usually `1` |
| `0x18` | attribute/declaration count, usually `5` |
| `0x1C` | primitive/vertex-buffer flags, commonly `0x40000003` |
| `0x20` | vertex stride, commonly `0x24` / 36 bytes |
| `0x24` | vertex buffer byte length |
| `0x28` | vertex buffer data offset + 1 into block 1 |
| `0x2C` | reserved/zero |

## Section D: vertex attribute declarations

Section D records are `0x40` bytes each. The first `0x10` bytes are meaningful in known floor files; the remaining `0x30` bytes are padding/reserved.

| Offset | Meaning |
| ---: | --- |
| `0x00` | semantic hash A |
| `0x04` | semantic hash B |
| `0x08` | packed declaration word: declaration code / byte offset / reserved |
| `0x0C` | packed format word: format / component count / usage / usage index |

Stable floor declarations observed:

| Declaration | Byte offset | Format | Components | Usage | Meaning |
| ---: | ---: | ---: | ---: | ---: | --- |
| 0 | `0x00` | `0x02` | 3 | `0x00` | POSITION, float32 BE X/Y/Z |
| 1 | `0x0C` | `0x02` | 4 | `0x03` | auxiliary float4, likely lighting/tangent/material data |
| 2 | `0x1C` | `0x03` | 2 | `0x08` | UV0, half-float BE U/V |
| 3 | `0x20` | `0x07` | 4 | `0x07` | packed 4-byte auxiliary/color/render attribute |

Important correction: the high byte of the `0x08` packed declaration word is not the true vertex stride. The authoritative stride comes from Section C at `+0x20`. In known floor files it is `0x24` / 36 bytes.

## Vertex layout

Known floor vertices use 36-byte stride:

| Offset | Type | Meaning |
| ---: | --- | --- |
| `0x00` | float32 BE x 3 | position X/Y/Z |
| `0x0C` | float32 BE x 4 | auxiliary lighting/tangent/material data |
| `0x1C` | half-float BE x 2 | UV0 U/V |
| `0x20` | 4 bytes | packed auxiliary/color/render data |

UV edit point:

```text
vertexBufferDataOffset + vertexIndex * 0x24 + 0x1C
```

## Known floor layouts

Two major floor part layouts have been observed.

### Split floor/apron layout

The `floor` part has two draw runs:

- Draw 0: base tiled floor, draw/pass id 0.
- Draw 1: apron, draw/pass id 1.

This layout preserves gloss/shadows on the base floor, but `texture_0` UVs tile far outside 0..1.

### One-run floor/apron layout

The `floor` part has one draw run:

- Draw 0: combined floor/apron geometry, usually 292 vertices and 686 indices.
- Some native examples use draw/pass id 0.
- A modded file can use the same one-run coverage but draw/pass id 1, which may make the surface color-linked.

## Full-court texture instructions

The safest full-court texture route should be:

1. Use the `floor` model part, not `paint` or `lines`.
2. Use the glossy/non-colorized floor draw/pass route, preferably draw/pass id `0`.
3. Put the full-court diffuse art into `texture_0`.
4. Preserve or regenerate a matching normal/gloss/greenmap partner in `texture_2`.
5. Remap part 0 UV0 values to 0..1 based on the vertex positions:

```text
U = (X - minX) / (maxX - minX)
V = (Z - minZ) / (maxZ - minZ)
```

Known full court bounds from multiple files:

```text
X ≈ -1132.8995 .. 1132.8994
Z ≈ -1829.0146 .. 1829.0150
```

6. Write U/V as big-endian half floats at:

```text
vertexBufferDataOffset + vertexIndex * 0x24 + 0x1C
```

7. Avoid using the `paint`, `key_hash_*`, or line material routes for the full-court diffuse art. Those paths are tied to Edit School color controls.

## Current experimental full-court SCNE

An experimental file was generated with this strategy:

- Base: original `floor.scne` with split glossy floor/apron material layout.
- Copied modded `texture_1` full-court art into original `texture_0` payload.
- Remapped all part 0 UV0 coordinates to 0..1 based on X/Z position bounds.
- Changed the second floor draw run's draw/pass id from 1 to 0 so both base floor and apron run through the same non-colorized floor route.

This file should be tested in game as a first real parser-informed attempt, not a blind texture-slot swap.
