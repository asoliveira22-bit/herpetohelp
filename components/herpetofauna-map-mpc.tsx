"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { FeatureCollection, Point, Polygon } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { Hexagon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HerpetofaunaMap } from "@/components/herpetofauna-map";

const POINT_SOURCE_ID = "salve-points";
const POINT_LAYER_ID = "salve-points-layer";
const MPC_SOURCE_ID = "species-mpc";
const MPC_FILL_LAYER_ID = "species-mpc-fill";
const MPC_LINE_LAYER_ID = "species-mpc-line";
const MPC_POINTS_CHANGED_EVENT = "herpetohelp:mpc-points-changed";
const MPC_MAP_READY_EVENT = "herpetohelp:mpc-map-ready";

type SpeciesPointProperties = {
  kind: "species";
  species: string;
  color: string;
  records: number;
};

type MpcProperties = {
  species: string;
  color: string;
  coordinateCount: number;
};

type MapLibreModule = typeof import("maplibre-gl");

type BridgeGeoJSONSource = GeoJSONSource & {
  __herpetoHelpMpcWrapped?: boolean;
};

type BridgeMapPrototype = MapLibreMap & {
  __herpetoHelpMpcBridgeInstalled?: boolean;
};

let bridgedMap: MapLibreMap | null = null;
let latestPointData: FeatureCollection<Point, SpeciesPointProperties> = {
  type: "FeatureCollection",
  features: [],
};

function cross(
  origin: [number, number],
  a: [number, number],
  b: [number, number],
) {
  return (a[0] - origin[0]) * (b[1] - origin[1]) -
    (a[1] - origin[1]) * (b[0] - origin[0]);
}

function convexHull(points: [number, number][]) {
  const unique = Array.from(
    new Map(
      points
        .filter(([longitude, latitude]) =>
          Number.isFinite(longitude) && Number.isFinite(latitude),
        )
        .map((point) => [`${point[0]}|${point[1]}`, point] as const),
    ).values(),
  );

  if (unique.length < 3) return null;

  unique.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const lower: [number, number][] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: [number, number][] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  const hull = [...lower, ...upper];
  return hull.length >= 3 ? hull : null;
}

function buildMpcFeatureCollection(
  pointData: FeatureCollection<Point, SpeciesPointProperties>,
): FeatureCollection<Polygon, MpcProperties> {
  const grouped = new Map<
    string,
    { color: string; coordinates: [number, number][] }
  >();

  for (const feature of pointData.features) {
    const properties = feature.properties;
    if (!properties || properties.kind !== "species") continue;
    const coordinates = feature.geometry.coordinates;
    if (coordinates.length < 2) continue;

    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;

    const group = grouped.get(properties.species) ?? {
      color: properties.color,
      coordinates: [],
    };
    group.coordinates.push([longitude, latitude]);
    grouped.set(properties.species, group);
  }

  const features: FeatureCollection<Polygon, MpcProperties>["features"] = [];
  for (const [species, group] of grouped) {
    const hull = convexHull(group.coordinates);
    if (!hull) continue;
    const ring = [...hull, hull[0]];
    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
      properties: {
        species,
        color: group.color,
        coordinateCount: new Set(
          group.coordinates.map(([longitude, latitude]) => `${longitude}|${latitude}`),
        ).size,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

function installMapBridge(maplibre: MapLibreModule) {
  const prototype = maplibre.Map.prototype as unknown as BridgeMapPrototype & {
    addSource: (...args: unknown[]) => MapLibreMap;
  };
  if (prototype.__herpetoHelpMpcBridgeInstalled) return;

  const originalAddSource = prototype.addSource;
  prototype.addSource = function addSourceWithMpcBridge(
    this: MapLibreMap,
    ...args: unknown[]
  ) {
    const result = originalAddSource.apply(this, args);
    const sourceId = args[0];
    if (sourceId !== POINT_SOURCE_ID) return result;

    bridgedMap = this;
    const source = this.getSource(POINT_SOURCE_ID) as BridgeGeoJSONSource | undefined;
    if (source && !source.__herpetoHelpMpcWrapped) {
      const originalSetData = source.setData.bind(source);
      source.setData = ((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "type" in data &&
          (data as { type?: string }).type === "FeatureCollection"
        ) {
          latestPointData = data as FeatureCollection<Point, SpeciesPointProperties>;
        }
        window.dispatchEvent(new Event(MPC_POINTS_CHANGED_EVENT));
        return originalSetData(data as Parameters<GeoJSONSource["setData"]>[0]);
      }) as GeoJSONSource["setData"];
      source.__herpetoHelpMpcWrapped = true;
    }
    window.dispatchEvent(new Event(MPC_MAP_READY_EVENT));
    return result;
  };
  prototype.__herpetoHelpMpcBridgeInstalled = true;
}

function setMpcVisibility(map: MapLibreMap, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  if (map.getLayer(MPC_FILL_LAYER_ID)) {
    map.setLayoutProperty(MPC_FILL_LAYER_ID, "visibility", visibility);
  }
  if (map.getLayer(MPC_LINE_LAYER_ID)) {
    map.setLayoutProperty(MPC_LINE_LAYER_ID, "visibility", visibility);
  }
}

function updateMpcLayer(
  map: MapLibreMap,
  data: FeatureCollection<Polygon, MpcProperties>,
) {
  const existingSource = map.getSource(MPC_SOURCE_ID) as GeoJSONSource | undefined;
  if (existingSource) {
    existingSource.setData(data);
  } else {
    map.addSource(MPC_SOURCE_ID, { type: "geojson", data });
  }

  const beforeLayer = map.getLayer(POINT_LAYER_ID) ? POINT_LAYER_ID : undefined;

  if (!map.getLayer(MPC_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: MPC_FILL_LAYER_ID,
        type: "fill",
        source: MPC_SOURCE_ID,
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.12,
        },
      },
      beforeLayer,
    );
  }

  if (!map.getLayer(MPC_LINE_LAYER_ID)) {
    map.addLayer(
      {
        id: MPC_LINE_LAYER_ID,
        type: "line",
        source: MPC_SOURCE_ID,
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.4, 9, 2.5, 13, 3.2],
          "line-opacity": 0.9,
        },
      },
      beforeLayer,
    );
  }

  setMpcVisibility(map, true);
}

function MpcLayerControl({ maplibre }: { maplibre: MapLibreModule }) {
  const [active, setActive] = useState(false);
  const [revision, setRevision] = useState(0);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const [polygonCount, setPolygonCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const locateTarget = () => {
      if (cancelled) return;
      const target = document.querySelector(".atlas-map-layer-control");
      if (target) {
        setPortalTarget(target);
      } else {
        window.setTimeout(locateTarget, 50);
      }
    };
    locateTarget();

    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(MPC_POINTS_CHANGED_EVENT, refresh);
    window.addEventListener(MPC_MAP_READY_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(MPC_POINTS_CHANGED_EVENT, refresh);
      window.removeEventListener(MPC_MAP_READY_EVENT, refresh);
    };
  }, []);

  const visibleSpeciesWithPoints = useMemo(() => {
    const species = new Set<string>();
    for (const feature of latestPointData.features) {
      if (feature.properties?.kind === "species") {
        species.add(feature.properties.species);
      }
    }
    return species.size;
  }, [revision]);

  useEffect(() => {
    const map = bridgedMap;
    if (!map) return;

    if (!active) {
      setMpcVisibility(map, false);
      setPolygonCount(0);
      return;
    }

    const data = buildMpcFeatureCollection(latestPointData);
    setPolygonCount(data.features.length);
    updateMpcLayer(map, data);
  }, [active, revision]);

  useEffect(() => {
    const map = bridgedMap;
    if (!map) return;

    const handleClick = (event: maplibre.MapMouseEvent) => {
      if (!active) return;
      const feature = map.queryRenderedFeatures(event.point, {
        layers: [MPC_LINE_LAYER_ID, MPC_FILL_LAYER_ID].filter((layerId) =>
          Boolean(map.getLayer(layerId)),
        ),
      })[0];
      if (!feature) return;
      const properties = feature.properties as MpcProperties | undefined;
      if (!properties) return;

      const content = document.createElement("div");
      content.className = "map-popup-content";
      const name = document.createElement("strong");
      name.className = "map-popup-species";
      name.textContent = properties.species;
      const detail = document.createElement("span");
      const count = Number(properties.coordinateCount);
      detail.textContent = `MPC calculado com ${count.toLocaleString("pt-BR")} ${count === 1 ? "coordenada única" : "coordenadas únicas"}.`;
      const note = document.createElement("span");
      note.className = "map-popup-coordinate";
      note.textContent = "Camada derivada dos pontos atualmente visíveis.";
      content.append(name, detail, note);

      new maplibre.Popup({ closeButton: true, offset: 10 })
        .setLngLat(event.lngLat)
        .setDOMContent(content)
        .addTo(map);
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [active, maplibre, revision]);

  if (!portalTarget) return null;

  return createPortal(
    <>
      <Button
        type="button"
        variant="outline"
        className={`atlas-map-tool-button atlas-mpc-layer-button${active ? " is-active" : ""}`}
        onClick={() => setActive((value) => !value)}
        disabled={visibleSpeciesWithPoints === 0}
        aria-pressed={active}
        aria-label={`${active ? "Ocultar" : "Mostrar"} mínimo polígono convexo das espécies visíveis`}
        title="MPC — Mínimo Polígono Convexo"
      >
        <Hexagon aria-hidden="true" />
        <span>MPC</span>
      </Button>
      {active && (
        <div
          role="status"
          aria-live="polite"
          style={{
            maxWidth: 190,
            borderRadius: 8,
            background: "rgba(255, 255, 255, 0.94)",
            padding: "6px 8px",
            fontSize: 11,
            lineHeight: 1.35,
            boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
          }}
        >
          {polygonCount > 0
            ? `${polygonCount.toLocaleString("pt-BR")} ${polygonCount === 1 ? "MPC exibido" : "MPCs exibidos"} · espécies visíveis`
            : "Nenhuma espécie visível possui 3 coordenadas únicas para formar um MPC."}
        </div>
      )}
    </>,
    portalTarget,
  );
}

export function HerpetofaunaMapWithMpc() {
  const [maplibre, setMaplibre] = useState<MapLibreModule | null>(null);

  useEffect(() => {
    let active = true;
    void import("maplibre-gl").then((module) => {
      installMapBridge(module);
      if (active) setMaplibre(module);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!maplibre) {
    return (
      <main className="atlas-shell" aria-busy="true">
        <section className="atlas-map-region" aria-label="Preparando mapa">
          <div className="atlas-map-loading" role="status">Preparando mapa…</div>
        </section>
      </main>
    );
  }

  return (
    <>
      <HerpetofaunaMap />
      <MpcLayerControl maplibre={maplibre} />
    </>
  );
}
