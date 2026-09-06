import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDirectory = path.join(root, "public", "data");
const index = JSON.parse(
  await readFile(path.join(dataDirectory, "species-index.json"), "utf8"),
);

const headerSize = 12;
const recordSize = 24;
const output = Buffer.allocUnsafe(
  headerSize + index.coordinateCount * recordSize,
);
output.write("HSP2", 0, 4, "ascii");
output.writeUInt32LE(index.coordinateCount, 4);
output.writeUInt32LE(index.species.length, 8);

let offset = headerSize;
let writtenCoordinates = 0;

for (const [speciesIndex, species] of index.species.entries()) {
  const points = JSON.parse(
    await readFile(
      path.join(dataDirectory, "species", `${species.id}.json`),
      "utf8",
    ),
  );

  if (points.length !== species.coordinateCount) {
    throw new Error(`Contagem divergente para ${species.name}.`);
  }

  for (const [longitude, latitude, records] of points) {
    output.writeUInt32LE(speciesIndex, offset);
    output.writeDoubleLE(longitude, offset + 4);
    output.writeDoubleLE(latitude, offset + 12);
    output.writeUInt32LE(records, offset + 20);
    offset += recordSize;
    writtenCoordinates += 1;
  }
}

if (writtenCoordinates !== index.coordinateCount || offset !== output.length) {
  throw new Error("O índice espacial ficou incompleto.");
}

const outputPath = path.join(dataDirectory, "spatial-points.bin");
await writeFile(outputPath, output);

console.log(
  JSON.stringify({
    species: index.species.length,
    coordinates: writtenCoordinates,
    bytes: output.length,
    output: path.relative(root, outputPath),
  }),
);
