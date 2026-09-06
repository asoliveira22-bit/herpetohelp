#!/usr/bin/env python3
"""Export the SALVE corpus as compact, browser-ready data.

The source keeps all original occurrence rows. This exporter converts SAD69
coordinates to SIRGAS 2000, consolidates equal species/coordinate pairs, and
writes one small data file per taxon so the map only loads selected species.
It can also export compressed, row-level occurrence details used by the Excel
download without adding those details to the map's initial payload.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import re
import sqlite3
import struct
import tempfile
from collections import Counter, OrderedDict, defaultdict
from pathlib import Path


SAD69_A = 6_378_160.0
SAD69_INV_F = 298.25
SIRGAS_A = 6_378_137.0
SIRGAS_INV_F = 298.257222101
DX, DY, DZ = -67.35, 3.88, -38.22
DETAIL_FIELDS = [
    "longitude_sirgas_2000",
    "latitude_sirgas_2000",
    "latitude_original",
    "longitude_original",
    "datum_original",
    "precisao_da_coordenada",
    "referencia_bibliografica",
    "base_dados",
    "id_origem",
    "tombamento",
    "instituicao_tombamento",
]


def geodetic_to_ecef(lat: float, lon: float, a: float, inv_f: float) -> tuple[float, float, float]:
    phi = math.radians(lat)
    lam = math.radians(lon)
    f = 1.0 / inv_f
    e2 = f * (2.0 - f)
    sin_phi = math.sin(phi)
    cos_phi = math.cos(phi)
    n = a / math.sqrt(1.0 - e2 * sin_phi * sin_phi)
    return (
        n * cos_phi * math.cos(lam),
        n * cos_phi * math.sin(lam),
        n * (1.0 - e2) * sin_phi,
    )


def ecef_to_geodetic(x: float, y: float, z: float, a: float, inv_f: float) -> tuple[float, float]:
    f = 1.0 / inv_f
    b = a * (1.0 - f)
    e2 = f * (2.0 - f)
    ep2 = (a * a - b * b) / (b * b)
    p = math.hypot(x, y)
    theta = math.atan2(z * a, p * b)
    sin_t = math.sin(theta)
    cos_t = math.cos(theta)
    lat = math.atan2(
        z + ep2 * b * sin_t * sin_t * sin_t,
        p - e2 * a * cos_t * cos_t * cos_t,
    )
    lon = math.atan2(y, x)
    return math.degrees(lat), math.degrees(lon)


def normalize_coordinate(lat: float, lon: float, datum: str | None) -> tuple[float, float]:
    if (datum or "").strip().casefold().replace("_", " ") in {"sad 69", "sad69"}:
        x, y, z = geodetic_to_ecef(lat, lon, SAD69_A, SAD69_INV_F)
        lat, lon = ecef_to_geodetic(x + DX, y + DY, z + DZ, SIRGAS_A, SIRGAS_INV_F)
    return round(lat, 8), round(lon, 8)


def species_id(name: str) -> str:
    return hashlib.sha1(name.encode("utf-8")).hexdigest()[:14]


def write_species(
    output_dir: Path,
    name: str,
    taxon_class: str,
    family: str,
    point_counts: dict[tuple[float, float], int],
) -> dict[str, object]:
    ident = species_id(name)
    points = [[lon, lat, count] for (lat, lon), count in sorted(point_counts.items())]
    with (output_dir / f"{ident}.json").open("w", encoding="utf-8") as handle:
        json.dump(points, handle, ensure_ascii=False, separators=(",", ":"))

    lats = [point[1] for point in points]
    lons = [point[0] for point in points]
    return {
        "id": ident,
        "name": name,
        "className": taxon_class,
        "group": "Anfíbios" if taxon_class == "Amphibia" else "Répteis",
        "family": family,
        "coordinateCount": len(points),
        "recordCount": sum(point[2] for point in points),
        "bounds": [min(lons), min(lats), max(lons), max(lats)],
    }


def write_spatial_point_index(
    public_data: Path,
    species_index: list[dict[str, object]],
    total_coordinates: int,
) -> None:
    output = public_data / "spatial-points.bin"
    with output.open("wb") as handle:
        handle.write(struct.pack("<4sII", b"HSP2", total_coordinates, len(species_index)))
        written_coordinates = 0
        for index, species in enumerate(species_index):
            species_file = public_data / "species" / f"{species['id']}.json"
            with species_file.open(encoding="utf-8") as source:
                points = json.load(source)
            for longitude, latitude, records in points:
                handle.write(struct.pack("<IddI", index, longitude, latitude, records))
                written_coordinates += 1
    if written_coordinates != total_coordinates:
        raise RuntimeError("The spatial record index is incomplete.")


def export_database(database: Path, public_data: Path) -> None:
    species_dir = public_data / "species"
    species_dir.mkdir(parents=True, exist_ok=True)
    for old_file in species_dir.glob("*.json"):
        old_file.unlink()

    connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True)
    connection.execute("PRAGMA query_only = ON")

    index: list[dict[str, object]] = []
    current_name: str | None = None
    current_class = ""
    current_family = ""
    point_counts: dict[tuple[float, float], int] = defaultdict(int)

    query = """
        SELECT scientific_name, classe, familia, latitude, longitude, datum
        FROM occurrences
        ORDER BY scientific_name COLLATE NOCASE, occurrence_id
    """
    for name, taxon_class, family, latitude, longitude, datum in connection.execute(query):
        family = (family or "").strip()
        if not family:
            raise RuntimeError(f"Missing family for {name}.")
        if current_name is not None and name != current_name:
            index.append(
                write_species(
                    species_dir,
                    current_name,
                    current_class,
                    current_family,
                    point_counts,
                )
            )
            point_counts = defaultdict(int)
        if current_name == name and current_family != family:
            raise RuntimeError(f"Conflicting families for {name}: {current_family} and {family}.")
        current_name = name
        current_class = taxon_class
        current_family = family
        lat, lon = normalize_coordinate(float(latitude), float(longitude), datum)
        point_counts[(lat, lon)] += 1

    if current_name is not None:
        index.append(
            write_species(
                species_dir,
                current_name,
                current_class,
                current_family,
                point_counts,
            )
        )
    connection.close()

    index.sort(key=lambda item: str(item["name"]).casefold())
    total_coordinates = sum(int(item["coordinateCount"]) for item in index)
    total_records = sum(int(item["recordCount"]) for item in index)
    payload = {
        "source": "SALVE/ICMBio",
        "sourceDate": "2026-08-13",
        "crs": "SIRGAS 2000 (EPSG:4674)",
        "speciesCount": len(index),
        "coordinateCount": total_coordinates,
        "recordCount": total_records,
        "species": index,
    }
    public_data.mkdir(parents=True, exist_ok=True)
    with (public_data / "species-index.json").open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    write_spatial_point_index(public_data, index, total_coordinates)
    print(json.dumps({key: payload[key] for key in ("speciesCount", "coordinateCount", "recordCount")}, ensure_ascii=False))


def natural_part_order(path: Path) -> tuple[int, str]:
    match = re.search(r"parte-(\d+)", path.name, flags=re.IGNORECASE)
    return (int(match.group(1)) if match else 0, path.name.casefold())


def source_value(row: dict[str, str], field: str) -> str:
    return (row.get(field) or "").strip()


class SpeciesSpool:
    """Bounded file-handle cache for grouping a large CSV export by species."""

    def __init__(self, directory: Path, max_open_files: int = 64) -> None:
        self.directory = directory
        self.max_open_files = max_open_files
        self.handles: OrderedDict[int, object] = OrderedDict()

    def write(self, species_index: int, payload: list[object]) -> None:
        handle = self.handles.pop(species_index, None)
        if handle is None:
            path = self.directory / f"{species_index}.ndjson"
            handle = path.open("ab")
        self.handles[species_index] = handle
        encoded = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        handle.write(encoded + b"\n")
        if len(self.handles) > self.max_open_files:
            _, oldest = self.handles.popitem(last=False)
            oldest.close()

    def close(self) -> None:
        for handle in self.handles.values():
            handle.close()
        self.handles.clear()


def write_compressed_json_array(source: Path, destination: Path) -> None:
    with destination.open("wb") as output:
        with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=9, mtime=0) as archive:
            archive.write(b"[")
            first = True
            with source.open("rb") as rows:
                for line in rows:
                    if not first:
                        archive.write(b",")
                    archive.write(line.rstrip(b"\r\n"))
                    first = False
            archive.write(b"]")


def validate_occurrence_coordinates(
    source: Path,
    species_file: Path,
    species_name: str,
) -> None:
    with species_file.open(encoding="utf-8") as points_source:
        expected = Counter(
            {
                (float(longitude), float(latitude)): int(records)
                for longitude, latitude, records in json.load(points_source)
            }
        )
    actual: Counter[tuple[float, float]] = Counter()
    with source.open(encoding="utf-8") as rows:
        for line in rows:
            longitude, latitude, *_ = json.loads(line)
            actual[(float(longitude), float(latitude))] += 1
    if actual != expected:
        raise RuntimeError(
            f"Occurrence coordinates do not match the map points for {species_name}."
        )


def export_occurrence_details(
    occurrences_directory: Path,
    public_data: Path,
) -> None:
    index_path = public_data / "species-index.json"
    with index_path.open(encoding="utf-8") as source:
        species_payload = json.load(source)
    species = species_payload["species"]
    species_by_name = {
        item["name"]: (position, item)
        for position, item in enumerate(species)
    }

    input_files = sorted(
        occurrences_directory.glob("*.csv"),
        key=natural_part_order,
    )
    if not input_files:
        raise RuntimeError("No occurrence CSV files were found.")

    output_directory = public_data / "occurrences"
    output_directory.mkdir(parents=True, exist_ok=True)
    for old_file in output_directory.glob("*.bin"):
        old_file.unlink()

    record_counts = [0] * len(species)
    with tempfile.TemporaryDirectory(prefix="salve-occurrences-") as temporary:
        spool_directory = Path(temporary)
        spool = SpeciesSpool(spool_directory)
        try:
            for input_file in input_files:
                with input_file.open(encoding="utf-8-sig", newline="") as source:
                    for row in csv.DictReader(source):
                        name = source_value(row, "subespecie") or source_value(row, "especie")
                        match = species_by_name.get(name)
                        if match is None:
                            raise RuntimeError(f"Species not found in the site index: {name}")
                        position, _ = match
                        latitude_original = float(source_value(row, "latitude"))
                        longitude_original = float(source_value(row, "longitude"))
                        datum = source_value(row, "datum")
                        latitude, longitude = normalize_coordinate(
                            latitude_original,
                            longitude_original,
                            datum,
                        )
                        spool.write(
                            position,
                            [
                                longitude,
                                latitude,
                                latitude_original,
                                longitude_original,
                                datum,
                                source_value(row, "precisao_da_coordenada"),
                                source_value(row, "referencia_bibliografica"),
                                source_value(row, "base_dados"),
                                source_value(row, "id_origem"),
                                source_value(row, "tombamento"),
                                source_value(row, "instituicao_tombamento"),
                            ],
                        )
                        record_counts[position] += 1
        finally:
            spool.close()

        for position, item in enumerate(species):
            expected = int(item["recordCount"])
            actual = record_counts[position]
            if actual != expected:
                raise RuntimeError(
                    f"Occurrence count mismatch for {item['name']}: {actual} != {expected}."
                )
            source = spool_directory / f"{position}.ndjson"
            destination = output_directory / f"{item['id']}.bin"
            validate_occurrence_coordinates(
                source,
                public_data / "species" / f"{item['id']}.json",
                str(item["name"]),
            )
            write_compressed_json_array(source, destination)

    manifest = {
        "version": 1,
        "compression": "gzip",
        "source": species_payload["source"],
        "sourceDate": species_payload["sourceDate"],
        "mapCrs": species_payload["crs"],
        "recordCount": sum(record_counts),
        "speciesCount": len(species),
        "fields": DETAIL_FIELDS,
    }
    with (public_data / "occurrence-details-index.json").open(
        "w",
        encoding="utf-8",
    ) as handle:
        json.dump(manifest, handle, ensure_ascii=False, separators=(",", ":"))
    print(
        json.dumps(
            {
                "speciesCount": manifest["speciesCount"],
                "recordCount": manifest["recordCount"],
                "files": len(list(output_directory.glob("*.bin"))),
            },
            ensure_ascii=False,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--database", type=Path)
    source.add_argument("--occurrences-directory", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.database:
        export_database(args.database.resolve(), args.output.resolve())
    else:
        export_occurrence_details(
            args.occurrences_directory.resolve(),
            args.output.resolve(),
        )


if __name__ == "__main__":
    main()
