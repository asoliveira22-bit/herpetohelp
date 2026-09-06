import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gzipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDirectory = path.join(root, "public", "data", "biomes");
const catalog = JSON.parse(
  await readFile(path.join(dataDirectory, "index.json"), "utf8"),
);
// Five decimal places preserve the already-simplified display geometry to ~1 m.
const coordinateScale = 100_000;
const textEncoder = new TextEncoder();

class BinaryWriter {
  constructor(initialCapacity = 1024 * 1024) {
    this.buffer = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  ensureCapacity(additionalBytes) {
    const required = this.offset + additionalBytes;
    if (required <= this.buffer.byteLength) return;
    let capacity = this.buffer.byteLength;
    while (capacity < required) capacity *= 2;
    const expanded = new ArrayBuffer(capacity);
    new Uint8Array(expanded).set(new Uint8Array(this.buffer, 0, this.offset));
    this.buffer = expanded;
    this.view = new DataView(expanded);
  }

  writeUint8(value) {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
  }

  writeUint16(value) {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
  }

  writeUint32(value) {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
  }

  writeVarUint(value) {
    let remaining = value >>> 0;
    while (remaining >= 0x80) {
      this.writeUint8((remaining & 0x7f) | 0x80);
      remaining >>>= 7;
    }
    this.writeUint8(remaining);
  }

  writeVarInt(value) {
    this.writeVarUint(((value << 1) ^ (value >> 31)) >>> 0);
  }

  writeBytes(bytes) {
    this.ensureCapacity(bytes.length);
    new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes);
    this.offset += bytes.length;
  }

  writeText(value) {
    const bytes = textEncoder.encode(value);
    if (bytes.length > 65_535) throw new Error("Biome label is too long.");
    this.writeUint16(bytes.length);
    this.writeBytes(bytes);
  }

  finish() {
    return new Uint8Array(this.buffer.slice(0, this.offset));
  }
}

function geometryPolygons(geometry) {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  throw new Error(`Unsupported biome geometry: ${geometry.type}`);
}

const writer = new BinaryWriter();
writer.writeBytes(textEncoder.encode("HBO2"));
writer.writeUint32(coordinateScale);
writer.writeUint16(catalog.biomes.length);

let vertexCount = 0;
for (const biome of catalog.biomes) {
  const sourcePath = path.join(root, "public", biome.geometryPath);
  const collection = JSON.parse(await readFile(sourcePath, "utf8"));
  if (collection.features.length !== 1) {
    throw new Error(`Expected one display feature for ${biome.id}.`);
  }
  const feature = collection.features[0];
  const polygons = geometryPolygons(feature.geometry);

  writer.writeText(String(feature.properties.id));
  writer.writeText(String(feature.properties.name));
  writer.writeUint8(feature.geometry.type === "Polygon" ? 1 : 2);
  writer.writeUint32(polygons.length);
  for (const polygon of polygons) {
    writer.writeUint32(polygon.length);
    for (const ring of polygon) {
      writer.writeUint32(ring.length);
      vertexCount += ring.length;
      let previousLongitude = 0;
      let previousLatitude = 0;
      for (const [longitude, latitude] of ring) {
        const encodedLongitude = Math.round(longitude * coordinateScale);
        const encodedLatitude = Math.round(latitude * coordinateScale);
        writer.writeVarInt(encodedLongitude - previousLongitude);
        writer.writeVarInt(encodedLatitude - previousLatitude);
        previousLongitude = encodedLongitude;
        previousLatitude = encodedLatitude;
      }
    }
  }
}

const uncompressed = writer.finish();
const compressed = gzipSync(uncompressed, { level: 9, mtime: 0 });
const outputPath = path.join(dataDirectory, "overview.bin");
await writeFile(outputPath, compressed);
console.log(
  JSON.stringify({
    output: outputPath,
    features: catalog.biomes.length,
    vertexCount,
    uncompressedBytes: uncompressed.byteLength,
    compressedBytes: compressed.byteLength,
  }),
);
