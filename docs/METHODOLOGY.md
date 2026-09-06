# HerpetoHelp methodology

## Purpose

HerpetoHelp provides a browser-based workflow for locating, comparing, spatially
filtering, and exporting occurrence records of Brazilian amphibians and reptiles.
The application is designed as an exploratory and decision-support interface; it is
not a substitute for checking the official source or evaluating sampling effort.

## Data preparation

The export pipeline accepts either a local SQLite database or a directory containing
occurrence-table parts. It groups records by scientific name, validates required
family information, and writes a compact catalog and one coordinate file per taxon.

Coordinates reported as SAD69 are transformed to SIRGAS 2000 with an explicit
three-parameter geocentric translation. Output coordinates are rounded to eight
decimal places. Other reported datums are retained numerically and represented in
the SIRGAS 2000 map workflow according to the preparation rules of the release.

## Map representation

For map display, equal scientific-name and coordinate pairs are consolidated and
retain a count of their contributing records. This reduces transfer and rendering
cost without discarding the multiplicity of occurrences.

Row-level occurrence details are stored separately in compressed files. When a user
exports the result of an area query, the application reconciles the selected display
coordinates with those details so that source, bibliographic, collection, and datum
fields can be included in the spreadsheet.

## Spatial queries

KMZ files are parsed in the browser. The spatial routine supports polygon and
multi-polygon geometries, includes records on polygon boundaries, and excludes
records located inside polygon holes. A binary point index groups hits by species.

Biome queries use precomputed geographic subsets derived from the same point index.
Display geometries may be simplified for map performance, while analytical subsets
are prepared from the designated source boundaries.

## Privacy

User-supplied KMZ files are processed locally in the browser. HerpetoHelp does not
upload or retain those files.

## Validation

Automated tests cover:

- points inside, outside, and on polygon boundaries;
- exclusion of polygon holes;
- grouping and ordering of species-level results;
- consistency between the species catalog and the binary point index;
- reconciliation of area hits with occurrence-source rows;
- spreadsheet structure and field labels; and
- biome catalog totals when the production dataset is available.

## Limitations

Absence of a record does not demonstrate biological absence. Results depend on the
coverage, date, taxonomic interpretation, spatial precision, and release status of
the source records. Users should confirm critical information in SALVE/ICMBio and in
the cited primary sources before making scientific or management decisions.

