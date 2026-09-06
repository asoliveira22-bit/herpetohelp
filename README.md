# HerpetoHelp

[HerpetoHelp](https://www.herpetohelp.com.br) is an interactive web application for
exploring georeferenced occurrence records of Brazilian amphibians and reptiles.
It supports multi-species comparison, spatial filtering with user-supplied KMZ
polygons, biome-based exploration, and spreadsheet export with occurrence provenance.

> **Resumo em português:** o HerpetoHelp é uma plataforma web para consulta e
> comparação de registros georreferenciados da herpetofauna brasileira. O código,
> os testes e os procedimentos de transformação são disponibilizados neste
> repositório; os dados compilados do SALVE/ICMBio não são redistribuídos aqui.

## Version

This repository documents **HerpetoHelp 1.0.0**, released on 5 September 2026.
See [CHANGELOG.md](CHANGELOG.md) for the release history.

## Main features

- Search and simultaneous visualization of amphibian and reptile species.
- Independent visibility and display controls by species and taxonomic group.
- Local processing of KMZ polygons in the user's browser.
- Identification of species and occurrence records inside a selected area.
- Spreadsheet export with taxon, coordinates, source fields, and record provenance.
- Exploration by Brazilian biome with separate display and analysis controls.
- Conversion of SAD69 coordinates to SIRGAS 2000 during data preparation.
- Consolidation of identical species-coordinate pairs for map display while
  preserving row-level occurrence details for export.

## Data provenance and availability

The production website uses public records obtained from the Brazilian
**Sistema de Avaliação do Risco de Extinção da Biodiversidade (SALVE/ICMBio)**.
The data snapshot currently identified by the application is dated 13 August 2026.

The production dataset is not part of this public source distribution. Code under
the MIT License does not grant rights over third-party biodiversity records,
bibliographic references, collection data, or biome boundaries. See
[DATA_POLICY.md](DATA_POLICY.md) before preparing or redistributing any dataset.

## Architecture

HerpetoHelp is a TypeScript/React application built with Next.js-compatible
[Vinext](https://github.com/cloudflare/vinext) tooling and deployed as a Cloudflare
Worker. Map rendering uses MapLibre GL JS. Spatial analysis runs in the browser,
so uploaded KMZ files are not sent to or retained by the application.

The application loads a compact species catalog at startup and fetches occurrence
coordinates only for selected taxa. A binary spatial index supports area and biome
queries without loading every species file into memory.

Further details are available in [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Local development

Requirements:

- Node.js 22.13 or newer
- npm
- Python 3 when rebuilding the SALVE-derived browser dataset

Install dependencies and start the development server:

```bash
npm ci
npm run dev
```

The interface requires browser-ready files under `public/data/`. Those generated
files are intentionally excluded from the public repository. To create them from
an authorized local SALVE export, use one of the following forms:

```bash
python3 scripts/export-salve-site-data.py \
  --database /path/to/occurrences.sqlite \
  --output public/data
```

```bash
python3 scripts/export-salve-site-data.py \
  --occurrences-directory /path/to/csv-parts \
  --output public/data
```

## Validation

The automated tests cover KMZ geometry analysis, polygon boundaries and holes,
binary spatial-index consistency, biome summaries, occurrence provenance, and
spreadsheet generation. Run:

```bash
npm test
```

Tests that validate the complete production catalog require an authorized local
dataset under `public/data/`.

## Citation

In text, use **HerpetoHelp (Oliveira 2026)** or **(Oliveira 2026)**.

> Oliveira, A. S. 2026. *HerpetoHelp: mapa interativo de distribuição da
> herpetofauna brasileira. Version 1.0*. Available at:
> https://www.herpetohelp.com.br. Accessed on: [day month year].

Machine-readable citation metadata are provided in [CITATION.cff](CITATION.cff).
When using occurrence records, also cite SALVE/ICMBio and the underlying sources
as appropriate for the intended analysis.

## Contributing

Bug reports, validation cases, documentation improvements, and reproducible feature
proposals are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

## AI assistance disclosure

Generative AI tools, including ChatGPT, assisted with software implementation,
documentation, and review. Scientific decisions, validation, authorship, and
responsibility for the released content remain with the human author.

## License

The software source code is licensed under the [MIT License](LICENSE).
Third-party data and brand assets are not relicensed by that license; see
[DATA_POLICY.md](DATA_POLICY.md).
