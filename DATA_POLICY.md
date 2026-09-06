# Data policy

## Scope

This repository licenses the HerpetoHelp source code under the MIT License. That
license does not apply to third-party biodiversity records, bibliographic content,
specimen information, spatial boundaries, or other source datasets processed by
the application.

## SALVE/ICMBio records

The production deployment uses records obtained from SALVE/ICMBio. Generated files
containing or derived from those occurrence records are excluded from the public
source distribution until their reuse and redistribution conditions have been
documented for the relevant release.

Users rebuilding the dataset are responsible for obtaining source files through an
authorized channel, respecting embargoes and restrictions on sensitive species, and
crediting SALVE/ICMBio and the underlying data providers.

## Sensitive coordinates

Records classified as sensitive, restricted, or under an embargo must not be
included in a public build. Dataset preparation should include a documented review
of release status before coordinates are exported.

## Biome boundaries

Biome files are treated as third-party data and retain the terms and attribution of
their official source. The production interface identifies the source as IBGE,
*Biomas do Brasil 2025*.

## Generated files excluded from the public repository

- `public/data/species/`
- `public/data/occurrences/`
- `public/data/species-index.json`
- `public/data/occurrence-details-index.json`
- `public/data/spatial-points.bin`
- generated biome geometries, binary indexes, and spreadsheets

