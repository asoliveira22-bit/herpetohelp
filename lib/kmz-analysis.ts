import type { Feature, FeatureCollection, Geometry } from "geojson";
import { strFromU8, unzipSync } from "fflate";

export type LngLat = [longitude: number, latitude: number];
export type LngLatBounds = [west: number, south: number, east: number, north: number];
export type AreaPoint = [longitude: number, latitude: number, records: number];

export type KmzArea = {
  featureCollection: FeatureCollection<Geometry>;
  polygons: LngLat[][][];
  bounds: LngLatBounds;
  geometryCount: number;
  vertexCount: number;
};

export type SpeciesInsideArea = {
  speciesIndex: number;
  coordinateCount: number;
  recordCount: number;
  points: AreaPoint[];
};

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_KML_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_KML_BYTES = 30 * 1024 * 1024;
const POINT_INDEX_HEADER_SIZE = 12;
const POINT_INDEX_RECORD_SIZE = 24;
const BOUNDARY_TOLERANCE = 1e-10;

function validatedPointIndex(pointIndex: ArrayBuffer, speciesCount: number) {
  const view = new DataView(pointIndex);
  if (view.byteLength < POINT_INDEX_HEADER_SIZE) {
    throw new Error("O índice espacial está incompleto.");
  }
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  const coordinateCount = view.getUint32(4, true);
  const indexedSpeciesCount = view.getUint32(8, true);
  if (
    magic !== "HSP2" ||
    indexedSpeciesCount !== speciesCount ||
    view.byteLength !== POINT_INDEX_HEADER_SIZE + coordinateCount * POINT_INDEX_RECORD_SIZE
  ) {
    throw new Error("O índice espacial não corresponde à lista de espécies.");
  }
  return { view, coordinateCount };
}

function pointIndexRecord(view: DataView, index: number, speciesCount: number) {
  const offset = POINT_INDEX_HEADER_SIZE + index * POINT_INDEX_RECORD_SIZE;
  const speciesIndex = view.getUint32(offset, true);
  const longitude = view.getFloat64(offset + 4, true);
  const latitude = view.getFloat64(offset + 12, true);
  const records = view.getUint32(offset + 20, true);
  if (
    speciesIndex >= speciesCount ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    records < 1
  ) {
    throw new Error("O índice espacial contém uma coordenada inválida.");
  }
  return { speciesIndex, longitude, latitude, records };
}

function appendPoint(
  results: Map<number, SpeciesInsideArea>,
  speciesIndex: number,
  longitude: number,
  latitude: number,
  records: number,
) {
  const result = results.get(speciesIndex) ?? {
    speciesIndex,
    coordinateCount: 0,
    recordCount: 0,
    points: [],
  };
  result.coordinateCount += 1;
  result.recordCount += records;
  result.points.push([longitude, latitude, records]);
  results.set(speciesIndex, result);
}

function elementsByLocalName(parent: Document | Element, localName: string) {
  return Array.from(parent.getElementsByTagNameNS("*", localName));
}

function sameCoordinate(a: LngLat, b: LngLat) {
  return a[0] === b[0] && a[1] === b[1];
}

function parseCoordinates(value: string | null): LngLat[] {
  if (!value) return [];
  return value
    .trim()
    .split(/\s+/)
    .map((tuple) => tuple.split(","))
    .map(([longitude, latitude]) => [Number(longitude), Number(latitude)] as LngLat)
    .filter(
      ([longitude, latitude]) =>
        Number.isFinite(longitude) &&
        Number.isFinite(latitude) &&
        longitude >= -180 &&
        longitude <= 180 &&
        latitude >= -90 &&
        latitude <= 90,
    );
}

function closeRing(coordinates: LngLat[]) {
  if (coordinates.length < 3) return [];
  return sameCoordinate(coordinates[0], coordinates.at(-1)!)
    ? coordinates
    : [...coordinates, coordinates[0]];
}

function coordinatesWithin(element: Element) {
  return parseCoordinates(elementsByLocalName(element, "coordinates")[0]?.textContent ?? null);
}

function coordinateBounds(coordinates: LngLat[]): LngLatBounds {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [longitude, latitude] of coordinates) {
    west = Math.min(west, longitude);
    south = Math.min(south, latitude);
    east = Math.max(east, longitude);
    north = Math.max(north, latitude);
  }
  return [west, south, east, north];
}

function parseKml(kml: string): KmzArea {
  const document = new DOMParser().parseFromString(kml, "application/xml");
  if (elementsByLocalName(document, "parsererror").length > 0) {
    throw new Error("O KML interno está inválido.");
  }

  const features: Array<Feature<Geometry>> = [];
  const polygons: LngLat[][][] = [];
  const polygonCoordinates: LngLat[] = [];

  for (const polygonElement of elementsByLocalName(document, "Polygon")) {
    const outerBoundary = elementsByLocalName(polygonElement, "outerBoundaryIs")[0];
    const outerRing = closeRing(outerBoundary ? coordinatesWithin(outerBoundary) : []);
    if (outerRing.length < 4) continue;
    const rings = [outerRing];
    for (const innerBoundary of elementsByLocalName(polygonElement, "innerBoundaryIs")) {
      const innerRing = closeRing(coordinatesWithin(innerBoundary));
      if (innerRing.length >= 4) rings.push(innerRing);
    }
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: rings },
    });
    polygons.push(rings);
    polygonCoordinates.push(...rings.flat());
  }

  if (features.length === 0 || polygonCoordinates.length === 0) {
    throw new Error("O KMZ precisa conter pelo menos um polígono fechado.");
  }

  return {
    featureCollection: { type: "FeatureCollection", features },
    polygons,
    bounds: coordinateBounds(polygonCoordinates),
    geometryCount: features.length,
    vertexCount: polygonCoordinates.length,
  };
}

export async function readKmz(file: File) {
  if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".kmz")) {
    throw new Error("Selecione um arquivo com extensão .kmz.");
  }
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error("O KMZ deve ter no máximo 10 MB.");
  }

  const archive = new Uint8Array(await file.arrayBuffer());
  let acceptedBytes = 0;
  let oversizedKml = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive, {
      filter: (entry) => {
        if (!entry.name.toLocaleLowerCase("pt-BR").endsWith(".kml")) return false;
        if (entry.originalSize > MAX_KML_BYTES) {
          oversizedKml = true;
          return false;
        }
        if (acceptedBytes + entry.originalSize > MAX_TOTAL_KML_BYTES) return false;
        acceptedBytes += entry.originalSize;
        return true;
      },
    });
  } catch {
    throw new Error("Não foi possível abrir o KMZ.");
  }

  const entries = Object.entries(files);
  if (entries.length === 0) {
    throw new Error(
      oversizedKml
        ? "O KML interno é grande demais para análise."
        : "O arquivo não contém um KML válido.",
    );
  }
  const selectedEntry =
    entries.find(([name]) => /(^|\/)doc\.kml$/i.test(name)) ?? entries[0];
  return parseKml(strFromU8(selectedEntry[1]));
}

type RingRelation = "outside" | "inside" | "boundary";

function pointOnSegment(point: LngLat, start: LngLat, end: LngLat) {
  const crossProduct =
    (point[1] - start[1]) * (end[0] - start[0]) -
    (point[0] - start[0]) * (end[1] - start[1]);
  const segmentScale = Math.max(
    1,
    Math.abs(end[0] - start[0]),
    Math.abs(end[1] - start[1]),
  );
  if (Math.abs(crossProduct) > BOUNDARY_TOLERANCE * segmentScale) return false;
  return (
    point[0] >= Math.min(start[0], end[0]) - BOUNDARY_TOLERANCE &&
    point[0] <= Math.max(start[0], end[0]) + BOUNDARY_TOLERANCE &&
    point[1] >= Math.min(start[1], end[1]) - BOUNDARY_TOLERANCE &&
    point[1] <= Math.max(start[1], end[1]) + BOUNDARY_TOLERANCE
  );
}

function pointRelationToRing(point: LngLat, ring: LngLat[]): RingRelation {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const currentPoint = ring[current];
    const previousPoint = ring[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return "boundary";
    const crosses =
      currentPoint[1] > point[1] !== previousPoint[1] > point[1] &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (crosses) inside = !inside;
  }
  return inside ? "inside" : "outside";
}

function pointCoveredByPolygon(point: LngLat, polygon: LngLat[][]) {
  const outerRelation = pointRelationToRing(point, polygon[0]);
  if (outerRelation === "outside") return false;
  if (outerRelation === "boundary") return true;
  for (const hole of polygon.slice(1)) {
    const holeRelation = pointRelationToRing(point, hole);
    if (holeRelation === "boundary") return true;
    if (holeRelation === "inside") return false;
  }
  return true;
}

function pointInsideArea(point: LngLat, area: KmzArea) {
  const [west, south, east, north] = area.bounds;
  if (point[0] < west || point[0] > east || point[1] < south || point[1] > north) {
    return false;
  }
  return area.polygons.some((polygon) => pointCoveredByPolygon(point, polygon));
}

export function findSpeciesInsideArea(
  pointIndex: ArrayBuffer,
  area: KmzArea,
  speciesCount: number,
) {
  const { view, coordinateCount } = validatedPointIndex(pointIndex, speciesCount);
  const results = new Map<number, SpeciesInsideArea>();
  for (let index = 0; index < coordinateCount; index += 1) {
    const { speciesIndex, longitude, latitude, records } = pointIndexRecord(
      view,
      index,
      speciesCount,
    );
    if (!pointInsideArea([longitude, latitude], area)) continue;
    appendPoint(results, speciesIndex, longitude, latitude, records);
  }

  return Array.from(results.values()).sort((a, b) => a.speciesIndex - b.speciesIndex);
}

export function groupSpeciesFromPointIndex(pointIndex: ArrayBuffer, speciesCount: number) {
  const { view, coordinateCount } = validatedPointIndex(pointIndex, speciesCount);
  const results = new Map<number, SpeciesInsideArea>();
  for (let index = 0; index < coordinateCount; index += 1) {
    const { speciesIndex, longitude, latitude, records } = pointIndexRecord(
      view,
      index,
      speciesCount,
    );
    appendPoint(results, speciesIndex, longitude, latitude, records);
  }
  return Array.from(results.values()).sort((a, b) => a.speciesIndex - b.speciesIndex);
}
