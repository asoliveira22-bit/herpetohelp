import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
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

function visitRings(geometry, visitor) {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) visitor(ring);
  }
}

function boundsForGeometry(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  visitRings(geometry, (ring) => {
    for (const [longitude, latitude] of ring) {
      bounds[0] = Math.min(bounds[0], longitude);
      bounds[1] = Math.min(bounds[1], latitude);
      bounds[2] = Math.max(bounds[2], longitude);
      bounds[3] = Math.max(bounds[3], latitude);
    }
  });
  return bounds;
}

test("decodes every biome from a compact overview without dropping vertices", async () => {
  const { decodeBiomeOverview } = await vite.ssrLoadModule(
    "/lib/biome-overview.ts",
  );
  const [overviewFile, catalogText] = await Promise.all([
    readFile(`${root}/public/data/biomes/overview.bin`),
    readFile(`${root}/public/data/biomes/index.json`, "utf8"),
  ]);
  const overview = decodeBiomeOverview(
    overviewFile.buffer.slice(
      overviewFile.byteOffset,
      overviewFile.byteOffset + overviewFile.byteLength,
    ),
  );
  const catalog = JSON.parse(catalogText);
  const expectedIds = catalog.biomes.map((biome) => biome.id).sort();

  assert.equal(overview.type, "FeatureCollection");
  assert.deepEqual(
    overview.features.map((feature) => feature.properties.id).sort(),
    expectedIds,
  );
  assert.ok((await stat(`${root}/public/data/biomes/overview.bin`)).size < 500_000);

  for (const feature of overview.features) {
    const biome = catalog.biomes.find(
      (candidate) => candidate.id === feature.properties.id,
    );
    const source = JSON.parse(
      await readFile(`${root}/public${biome.geometryPath}`, "utf8"),
    ).features[0];
    let decodedVertices = 0;
    let sourceVertices = 0;
    visitRings(feature.geometry, (ring) => {
      decodedVertices += ring.length;
      assert.ok(ring.length >= 4);
      assert.deepEqual(ring[0], ring[ring.length - 1]);
    });
    visitRings(source.geometry, (ring) => {
      sourceVertices += ring.length;
    });
    assert.equal(decodedVertices, sourceVertices);

    const expectedBounds = boundsForGeometry(source.geometry);
    const actualBounds = boundsForGeometry(feature.geometry);
    for (let index = 0; index < expectedBounds.length; index += 1) {
      assert.ok(Math.abs(actualBounds[index] - expectedBounds[index]) <= 0.000006);
    }
  }
});
