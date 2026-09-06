import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("keeps the spatial point index aligned with the species catalog", async () => {
  const [catalogText, pointIndex] = await Promise.all([
    readFile(`${root}/public/data/species-index.json`, "utf8"),
    readFile(`${root}/public/data/spatial-points.bin`),
  ]);
  const catalog = JSON.parse(catalogText);

  assert.equal(pointIndex.subarray(0, 4).toString("ascii"), "HSP2");
  assert.equal(pointIndex.readUInt32LE(4), catalog.coordinateCount);
  assert.equal(pointIndex.readUInt32LE(8), catalog.speciesCount);
  assert.equal(pointIndex.length, 12 + catalog.coordinateCount * 24);
  assert.ok(
    catalog.species.every(
      (species) => typeof species.family === "string" && species.family.trim().length > 0,
    ),
    "every species must include its SALVE family",
  );
});

test("keeps one compressed occurrence-source file for every species", async () => {
  const [catalogText, manifestText, occurrenceFiles] = await Promise.all([
    readFile(`${root}/public/data/species-index.json`, "utf8"),
    readFile(`${root}/public/data/occurrence-details-index.json`, "utf8"),
    readdir(`${root}/public/data/occurrences`),
  ]);
  const catalog = JSON.parse(catalogText);
  const manifest = JSON.parse(manifestText);
  const expectedFiles = new Set(
    catalog.species.map((species) => `${species.id}.bin`),
  );

  assert.equal(manifest.speciesCount, catalog.speciesCount);
  assert.equal(manifest.recordCount, catalog.recordCount);
  assert.equal(manifest.compression, "gzip");
  assert.deepEqual(new Set(occurrenceFiles), expectedFiles);
  const sampledFiles = [occurrenceFiles[0], occurrenceFiles.at(-1)];
  for (const file of sampledFiles) {
    assert.ok((await stat(`${root}/public/data/occurrences/${file}`)).size > 2);
  }
});
