import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
});

function makePointIndex(points, speciesCount) {
  const buffer = new ArrayBuffer(12 + points.length * 24);
  const view = new DataView(buffer);
  for (const [index, character] of Array.from("HSP2").entries()) {
    view.setUint8(index, character.charCodeAt(0));
  }
  view.setUint32(4, points.length, true);
  view.setUint32(8, speciesCount, true);
  points.forEach(([speciesIndex, longitude, latitude, records], index) => {
    const offset = 12 + index * 24;
    view.setUint32(offset, speciesIndex, true);
    view.setFloat64(offset + 4, longitude, true);
    view.setFloat64(offset + 12, latitude, true);
    view.setUint32(offset + 20, records, true);
  });
  return buffer;
}

function makeArea(ring) {
  return {
    featureCollection: { type: "FeatureCollection", features: [] },
    polygons: [[ring]],
    bounds: [
      Math.min(...ring.map(([longitude]) => longitude)),
      Math.min(...ring.map(([, latitude]) => latitude)),
      Math.max(...ring.map(([longitude]) => longitude)),
      Math.max(...ring.map(([, latitude]) => latitude)),
    ],
    geometryCount: 1,
    vertexCount: ring.length,
  };
}

test("returns only species with records inside a polygon and includes its boundary", async () => {
  const { findSpeciesInsideArea } = await vite.ssrLoadModule("/lib/kmz-analysis.ts");
  const area = makeArea([
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ]);
  const pointIndex = makePointIndex(
    [
      [0, 0.5, 0.5, 2],
      [0, 0.75, 0.75, 1],
      [0, 5, 5, 7],
      [1, 2, 0.5, 4],
      [2, 1, 0.5, 5],
    ],
    3,
  );

  const results = findSpeciesInsideArea(pointIndex, area, 3);

  assert.deepEqual(results.map((result) => result.speciesIndex), [0, 2]);
  assert.deepEqual(results[0], {
    speciesIndex: 0,
    coordinateCount: 2,
    recordCount: 3,
    points: [
      [0.5, 0.5, 2],
      [0.75, 0.75, 1],
    ],
  });
  assert.equal(results[1].coordinateCount, 1);
  assert.equal(results[1].recordCount, 5);
});

test("excludes occurrences inside polygon holes while keeping boundary points", async () => {
  const { findSpeciesInsideArea } = await vite.ssrLoadModule("/lib/kmz-analysis.ts");
  const outerRing = [
    [0, 0],
    [3, 0],
    [3, 3],
    [0, 3],
    [0, 0],
  ];
  const hole = [
    [1, 1],
    [2, 1],
    [2, 2],
    [1, 2],
    [1, 1],
  ];
  const area = {
    ...makeArea(outerRing),
    polygons: [[outerRing, hole]],
  };
  const pointIndex = makePointIndex(
    [
      [0, 0.5, 0.5, 1],
      [1, 1.5, 1.5, 2],
      [2, 1, 1.5, 3],
    ],
    3,
  );

  const results = findSpeciesInsideArea(pointIndex, area, 3);

  assert.deepEqual(results.map((result) => result.speciesIndex), [0, 2]);
});

test("groups every point in a precomputed geographic subset by species", async () => {
  const { groupSpeciesFromPointIndex } = await vite.ssrLoadModule(
    "/lib/kmz-analysis.ts",
  );
  const pointIndex = makePointIndex(
    [
      [2, -55, -12, 4],
      [0, -48, -15, 2],
      [2, -54, -13, 3],
    ],
    3,
  );

  const results = groupSpeciesFromPointIndex(pointIndex, 3);

  assert.deepEqual(results, [
    {
      speciesIndex: 0,
      coordinateCount: 1,
      recordCount: 2,
      points: [[-48, -15, 2]],
    },
    {
      speciesIndex: 2,
      coordinateCount: 2,
      recordCount: 7,
      points: [
        [-55, -12, 4],
        [-54, -13, 3],
      ],
    },
  ]);
});

test("returns distinct species with points inside a real SALVE area", async () => {
  const { findSpeciesInsideArea } = await vite.ssrLoadModule("/lib/kmz-analysis.ts");
  const [pointIndexFile, catalogText] = await Promise.all([
    readFile(`${root}/public/data/spatial-points.bin`),
    readFile(`${root}/public/data/species-index.json`, "utf8"),
  ]);
  const catalog = JSON.parse(catalogText);
  const area = makeArea([
    [-52.5, -32.5],
    [-52.3, -32.5],
    [-52.3, -32.35],
    [-52.5, -32.35],
    [-52.5, -32.5],
  ]);
  const pointIndex = pointIndexFile.buffer.slice(
    pointIndexFile.byteOffset,
    pointIndexFile.byteOffset + pointIndexFile.byteLength,
  );

  const results = findSpeciesInsideArea(pointIndex, area, catalog.speciesCount);

  assert.ok(results.length > 0);
  assert.equal(new Set(results.map((result) => result.speciesIndex)).size, results.length);
  assert.ok(results.every((result) => result.coordinateCount > 0 && result.recordCount > 0));
  assert.ok(
    results.every((result, index) => index === 0 || result.speciesIndex > results[index - 1].speciesIndex),
  );
  assert.ok(
    results.every((result) =>
      result.points.every(
        ([longitude, latitude]) =>
          longitude >= -52.5 &&
          longitude <= -52.3 &&
          latitude >= -32.5 &&
          latitude <= -32.35,
      ),
    ),
  );
});

test("keeps every precomputed biome subset consistent with its catalog totals", async () => {
  const { groupSpeciesFromPointIndex } = await vite.ssrLoadModule(
    "/lib/kmz-analysis.ts",
  );
  const [biomeCatalogText, speciesCatalogText] = await Promise.all([
    readFile(`${root}/public/data/biomes/index.json`, "utf8"),
    readFile(`${root}/public/data/species-index.json`, "utf8"),
  ]);
  const biomeCatalog = JSON.parse(biomeCatalogText);
  const speciesCatalog = JSON.parse(speciesCatalogText);

  for (const biome of biomeCatalog.biomes) {
    const pointIndexFile = await readFile(`${root}/public${biome.pointsPath}`);
    const pointIndex = pointIndexFile.buffer.slice(
      pointIndexFile.byteOffset,
      pointIndexFile.byteOffset + pointIndexFile.byteLength,
    );
    const results = groupSpeciesFromPointIndex(
      pointIndex,
      speciesCatalog.speciesCount,
    );

    assert.equal(results.length, biome.speciesCount, biome.name);
    assert.equal(
      results.reduce((total, result) => total + result.coordinateCount, 0),
      biome.coordinateCount,
      biome.name,
    );
    assert.equal(
      results.reduce((total, result) => total + result.recordCount, 0),
      biome.recordCount,
      biome.name,
    );
  }
});
