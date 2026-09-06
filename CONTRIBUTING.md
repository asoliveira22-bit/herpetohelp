# Contributing to HerpetoHelp

Thank you for helping improve HerpetoHelp.

## Before opening a contribution

- Search existing issues to avoid duplicates.
- Describe the biological or technical need and its expected users.
- Do not attach restricted occurrence data, precise sensitive-species coordinates,
  credentials, or unpublished third-party datasets.
- Use synthetic or openly licensed examples for reproducible bug reports.

## Development workflow

1. Create a focused branch.
2. Install locked dependencies with `npm ci`.
3. Add or update tests for behavioral changes.
4. Run `npm test` when the required local data are available.
5. Explain user-visible and data-model changes in the pull request.

## Scientific changes

Changes to coordinate handling, taxonomic names, spatial selection, data provenance,
or export fields must state the source, effective date, assumptions, and validation
performed. When sources conflict, preserve the conflict explicitly rather than
silently choosing a value.

## AI-assisted contributions

Contributors remain responsible for reviewing and validating any AI-assisted code or
text. Do not submit confidential data or restricted occurrence records to external AI
services.

