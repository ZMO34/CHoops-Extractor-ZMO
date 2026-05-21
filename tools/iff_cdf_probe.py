#!/usr/bin/env python3
"""
Probe College Hoops / NBA2K-style PS3 IFF/CDF bundles for per-asset compression.

This does NOT assume whole-file compression or encryption. It parses the 32-byte
IFF header, 32-byte IFF_HEADER_DATA-style records, and tries several payload
hypotheses seen in 2K Sports IFF containers:

- PS3/big-endian and little-endian header interpretations
- Hades/NBA2K9-style IFF_MAINDATA blocks with a 20-byte pre-compression header
- Normal and byte-reversed compressed/uncompressed size fields
- Direct zlib streams and zlib streams preceded by small per-asset headers

Usage:
    python3 tools/iff_cdf_probe.py path/to/file.iff --dump-dir dumped
    python3 tools/iff_cdf_probe.py path/to/file.cdf --dump-dir dumped
"""
from __future__ import annotations

import argparse
import binascii
import math
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

MAGICS = {0xFF3BEF94, 0xF0985030, 0x94EF3BFF, 0x305098F0}
ZLIB_MAGICS = (b"\x78\x01", b"\x78\x5e", b"\x78\x9c", b"\x78\xda")


def entropy(buf: bytes) -> float:
    if not buf:
        return 0.0
    counts = [0] * 256
    for b in buf:
        counts[b] += 1
    n = len(buf)
    return -sum((c / n) * math.log2(c / n) for c in counts if c)


@dataclass(frozen=True)
class Header:
    endian: str
    magic: int
    toc_size: int
    file_len_field: int
    reserve: int
    data_file_count: int
    unk1: int
    sub_file_count: int
    unk2: int


@dataclass(frozen=True)
class HeaderDataRecord:
    index: int
    offset: int
    endian: str
    name: int
    type_id: int
    unk1: int
    uncompressed_len: int
    unk2: int
    start_offset: int
    compressed_len: int
    reserve: int


def reversed_u32(v: int) -> int:
    return int.from_bytes(v.to_bytes(4, "big")[::-1], "big")


def parse_header(data: bytes) -> Header:
    if len(data) < 0x20:
        raise ValueError("File is too small to contain a 32-byte IFF header")

    candidates: list[tuple[int, Header]] = []
    for endian in (">", "<"):
        vals = struct.unpack_from(endian + "8I", data, 0)
        magic, toc, flen, reserve, dfc, unk1, sfc, unk2 = vals
        score = 0
        if magic in MAGICS:
            score += 4
        if 0x20 <= toc <= len(data):
            score += 2
        if 0 <= dfc < 100000:
            score += 1
        if 0 <= sfc < 100000:
            score += 1
        if flen <= max(len(data) * 4, len(data) + 0x100000):
            score += 1
        candidates.append((score, Header(endian, magic, toc, flen, reserve, dfc, unk1, sfc, unk2)))

    best_score, best = max(candidates, key=lambda x: x[0])
    if best_score <= 0:
        raise ValueError("Could not identify an IFF/CDF-like header")
    return best


def parse_header_data(data: bytes, h: Header) -> list[HeaderDataRecord]:
    records: list[HeaderDataRecord] = []
    off = 0x20
    max_records_by_toc = max(0, (min(h.toc_size, len(data)) - 0x20) // 32)
    count = min(h.data_file_count, max_records_by_toc if max_records_by_toc else h.data_file_count)

    for i in range(count):
        if off + 32 > len(data):
            break
        vals = struct.unpack_from(h.endian + "8I", data, off)
        records.append(
            HeaderDataRecord(
                index=i,
                offset=off,
                endian=h.endian,
                name=vals[0],
                type_id=vals[1],
                unk1=vals[2],
                uncompressed_len=vals[3],
                unk2=vals[4],
                start_offset=vals[5],
                compressed_len=vals[6],
                reserve=vals[7],
            )
        )
        off += 32
    return records


def try_decompress(blob: bytes) -> tuple[Optional[bytes], Optional[str]]:
    for wbits in (15, -15):
        try:
            out = zlib.decompress(blob, wbits)
            return out, f"zlib wbits={wbits}"
        except zlib.error:
            pass
    return None, None


def candidate_payloads_for_record(data: bytes, rec: HeaderDataRecord) -> Iterable[tuple[str, int, int, bytes]]:
    """Yield (label, start, size, bytes) for plausible compressed data regions."""
    starts = [rec.start_offset, rec.unk2]
    sizes = [
        rec.compressed_len,
        reversed_u32(rec.compressed_len),
        rec.uncompressed_len,
        reversed_u32(rec.uncompressed_len),
    ]

    for start in starts:
        if not (0 <= start < len(data)):
            continue

        # Hades/NBA2K9-style IFF_MAINDATA:
        #   u32 flag
        #   u32 uncompressed_len   sometimes byte-reversed in docs/tools
        #   u32 compressed_len     sometimes byte-reversed in docs/tools
        #   u32 unknown
        #   u32 marker/hades/check
        #   bytes compressed_data[compressed_len - 20]
        for endian in (rec.endian, "<", ">"):
            if start + 20 > len(data):
                continue
            try:
                flag, ulen, clen, unk1, marker = struct.unpack_from(endian + "5I", data, start)
            except struct.error:
                continue
            for clen2 in (clen, reversed_u32(clen)):
                if 20 <= clen2 <= len(data) - start:
                    blob_start = start + 20
                    blob_size = clen2 - 20
                    yield (
                        f"maindata {endian} flag=0x{flag:08X} ulen=0x{ulen:08X} clen=0x{clen2:X} marker=0x{marker:08X}",
                        blob_start,
                        blob_size,
                        data[blob_start : blob_start + blob_size],
                    )

        for size in sizes:
            if 0 < size <= len(data) - start:
                yield (f"direct start=0x{start:X} size=0x{size:X}", start, size, data[start : start + size])


def scan_zlib_offsets(data: bytes) -> list[int]:
    hits: list[int] = []
    for magic in ZLIB_MAGICS:
        pos = data.find(magic)
        while pos != -1:
            hits.append(pos)
            pos = data.find(magic, pos + 1)
    return sorted(set(hits))


def dump_bytes(dump_dir: Optional[Path], name: str, payload: bytes) -> None:
    if dump_dir is None:
        return
    dump_dir.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    (dump_dir / safe_name).write_bytes(payload)


def main() -> int:
    ap = argparse.ArgumentParser(description="Probe CHoops/NBA2K-style IFF/CDF compression layouts")
    ap.add_argument("file", type=Path)
    ap.add_argument("--dump-dir", type=Path, help="Directory for successfully decompressed payloads")
    ap.add_argument("--max-records", type=int, default=128, help="Maximum header records to print/probe")
    ap.add_argument("--max-zlib-hits", type=int, default=500, help="Maximum zlib-looking offsets to test")
    args = ap.parse_args()

    data = args.file.read_bytes()
    h = parse_header(data)

    print(f"file={args.file} size=0x{len(data):X} entropy={entropy(data):.3f}")
    print(
        "header "
        f"endian={'BE' if h.endian == '>' else 'LE'} "
        f"magic=0x{h.magic:08X} toc=0x{h.toc_size:X} "
        f"file_len_field=0x{h.file_len_field:X} "
        f"data_count={h.data_file_count} sub_count={h.sub_file_count}"
    )

    records = parse_header_data(data, h)
    for rec in records[: args.max_records]:
        print(
            f"rec[{rec.index:03}] @0x{rec.offset:X} "
            f"name=0x{rec.name:08X} type=0x{rec.type_id:08X} "
            f"start=0x{rec.start_offset:X} clen=0x{rec.compressed_len:X} "
            f"ulen=0x{rec.uncompressed_len:X} unk2=0x{rec.unk2:X}"
        )
        for label, start, size, blob in candidate_payloads_for_record(data, rec):
            out, how = try_decompress(blob)
            if out is None:
                continue
            crc = binascii.crc32(out) & 0xFFFFFFFF
            print(f"  OK {how}: {label} @0x{start:X}+0x{size:X} -> 0x{len(out):X} crc32=0x{crc:08X}")
            dump_bytes(args.dump_dir, f"rec_{rec.index:03}_0x{rec.name:08X}_0x{start:X}.bin", out)

    print("\nzlib offset probe:")
    found = 0
    for zoff in scan_zlib_offsets(data)[: args.max_zlib_hits]:
        for back in (0, 2, 4, 8, 12, 16, 20, 24, 32):
            start = zoff - back
            if start < 0:
                continue
            out, how = try_decompress(data[start:])
            if out is None:
                continue
            found += 1
            crc = binascii.crc32(out) & 0xFFFFFFFF
            print(
                f"  OK {how}: zmagic=0x{zoff:X}, start=0x{start:X}, "
                f"back={back}, out=0x{len(out):X}, crc32=0x{crc:08X}"
            )
            dump_bytes(args.dump_dir, f"zlib_0x{zoff:X}_start_0x{start:X}.bin", out)
            break
    if found == 0:
        print("  no standalone zlib streams decompressed from tested offsets")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
