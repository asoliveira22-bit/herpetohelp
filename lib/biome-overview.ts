import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { gunzipSync } from "fflate";

type BiomeProperties = {
  id: string;
  name: string;
};

const MAX_FEATURES = 100;
const MAX_POLYGONS = 100_000;
const MAX_RINGS = 100_000;
const MAX_POINTS = 1_000_000;
const textDecoder = new TextDecoder();

class BinaryReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private ensureAvailable(length: number) {
    if (length < 0 || this.offset + length > this.view.byteLength) {
      throw new Error("O arquivo geral dos biomas está incompleto.");
    }
  }

  readUint8() {
    this.ensureAvailable(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  readUint16() {
    this.ensureAvailable(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32() {
    this.ensureAvailable(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readVarUint() {
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      const byte = this.readUint8();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value >>> 0;
    }
    throw new Error("O arquivo geral dos biomas contém um número inválido.");
  }

  readVarInt() {
    const value = this.readVarUint();
    return (value >>> 1) ^ -(value & 1);
  }

  readText() {
    const length = this.readUint16();
    this.ensureAvailable(length);
    const value = textDecoder.decode(
      this.bytes.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return value;
  }

  readMagic() {
    this.ensureAvailable(4);
    const value = textDecoder.decode(this.bytes.subarray(this.offset, this.offset + 4));
    this.offset += 4;
    return value;
  }

  assertFinished() {
    if (this.offset !== this.view.byteLength) {
      throw new Error("O arquivo geral dos biomas contém dados inesperados.");
    }
  }
}

function readCount(reader: BinaryReader, maximum: number) {
  const count = reader.readUint32();
  if (count > maximum) {
    throw new Error("O arquivo geral dos biomas excede o limite esperado.");
  }
  return count;
}

function readPolygon(reader: BinaryReader, scale: number) {
  const ringCount = readCount(reader, MAX_RINGS);
  const polygon: number[][][] = [];
  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const pointCount = readCount(reader, MAX_POINTS);
    if (pointCount < 4) {
      throw new Error("O arquivo geral dos biomas contém um anel inválido.");
    }
    const ring: number[][] = [];
    let encodedLongitude = 0;
    let encodedLatitude = 0;
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      encodedLongitude += reader.readVarInt();
      encodedLatitude += reader.readVarInt();
      const longitude = encodedLongitude / scale;
      const latitude = encodedLatitude / scale;
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        throw new Error("O arquivo geral dos biomas contém uma coordenada inválida.");
      }
      ring.push([longitude, latitude]);
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      throw new Error("O arquivo geral dos biomas contém um anel aberto.");
    }
    polygon.push(ring);
  }
  return polygon;
}

export function decodeBiomeOverview(payload: ArrayBuffer) {
  const input = new Uint8Array(payload);
  const bytes =
    input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input;
  const reader = new BinaryReader(bytes);
  if (reader.readMagic() !== "HBO2") {
    throw new Error("O arquivo geral dos biomas está em um formato inesperado.");
  }
  const scale = reader.readUint32();
  if (scale < 1 || scale > 10_000_000) {
    throw new Error("O arquivo geral dos biomas usa uma escala inválida.");
  }
  const featureCount = reader.readUint16();
  if (featureCount < 1 || featureCount > MAX_FEATURES) {
    throw new Error("O arquivo geral dos biomas contém uma quantidade inválida.");
  }

  const features: Array<Feature<Polygon | MultiPolygon, BiomeProperties>> = [];
  for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
    const id = reader.readText();
    const name = reader.readText();
    const geometryType = reader.readUint8();
    const polygonCount = readCount(reader, MAX_POLYGONS);
    const polygons = Array.from({ length: polygonCount }, () =>
      readPolygon(reader, scale),
    );
    const geometry: Polygon | MultiPolygon =
      geometryType === 1
        ? { type: "Polygon", coordinates: polygons[0] ?? [] }
        : geometryType === 2
          ? { type: "MultiPolygon", coordinates: polygons }
          : (() => {
              throw new Error("O arquivo geral dos biomas contém uma geometria inválida.");
            })();
    if ((geometryType === 1 && polygonCount !== 1) || !id || !name) {
      throw new Error("O arquivo geral dos biomas contém uma feição inválida.");
    }
    features.push({
      type: "Feature",
      properties: { id, name },
      geometry,
    });
  }
  reader.assertFinished();
  return {
    type: "FeatureCollection",
    features,
  } satisfies FeatureCollection<Polygon | MultiPolygon, BiomeProperties>;
}
