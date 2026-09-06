"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FeatureCollection, Geometry, Point } from "geojson";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  MapGeoJSONFeature,
} from "maplibre-gl";
import {
  CircleAlert,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  FileUp,
  Info,
  Layers3,
  LoaderCircle,
  Mail,
  RotateCcw,
  Search,
  Trash2,
  TreePine,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AreaPoint } from "@/lib/kmz-analysis";

type SpeciesMeta = {
  id: string;
  name: string;
  className: "Amphibia" | "Reptilia";
  group: "Anfíbios" | "Répteis";
  family: string;
  coordinateCount: number;
  recordCount: number;
  bounds: [number, number, number, number];
};

type SpeciesGroup = SpeciesMeta["group"];

type SpeciesIndex = {
  source: string;
  sourceDate: string;
  crs: string;
  speciesCount: number;
  coordinateCount: number;
  recordCount: number;
  species: SpeciesMeta[];
};

type PointTuple = [longitude: number, latitude: number, records: number];

type SelectedSpecies = SpeciesMeta & {
  color: string;
  status: "loading" | "ready" | "error";
  points?: PointTuple[];
};

type SpeciesPointProperties = {
  kind: "species";
  species: string;
  color: string;
  records: number;
};

type InsidePointProperties = {
  kind: "inside";
  species: string;
  group: string;
  marker: string;
  records: number;
};

type PointProperties = SpeciesPointProperties | InsidePointProperties;

type SpeciesInsideAreaResult = {
  species: SpeciesMeta;
  color: string;
  coordinateCount: number;
  recordCount: number;
  points: AreaPoint[];
};

type BiomeMeta = {
  id: string;
  name: string;
  bounds: [number, number, number, number];
  speciesCount: number;
  coordinateCount: number;
  recordCount: number;
  geometryPath: string;
  pointsPath: string;
};

type BiomeCatalog = {
  source: string;
  title: string;
  edition: string;
  scale: string;
  crs: string;
  sourceUrl: string;
  legalNotice: string;
  biomes: BiomeMeta[];
};

type MapArea = {
  featureCollection: FeatureCollection<Geometry>;
  bounds: [number, number, number, number];
  geometryCount: number;
};

type PreservedViewport = {
  center: [longitude: number, latitude: number];
  zoom: number;
  bearing: number;
  pitch: number;
};

type AnalysisStatus = "idle" | "reading" | "loading-data" | "analyzing" | "ready" | "error";
type SpreadsheetStatus = "idle" | "loading" | "building";
type AnalysisMode = "biome" | "kmz" | null;
type BiomeLayerStatus = "idle" | "loading" | "ready" | "error";

const POINT_SOURCE_ID = "salve-points";
const POINT_LAYER_ID = "salve-points-layer";
const BIOME_OVERVIEW_SOURCE_ID = "biome-overview";
const BIOME_OVERVIEW_FILL_LAYER_ID = "biome-overview-fill";
const BIOME_OVERVIEW_LINE_LAYER_ID = "biome-overview-line";
const BIOME_OVERVIEW_PATH = "/data/biomes/overview.bin";
const AREA_SOURCE_ID = "uploaded-area";
const AREA_FILL_LAYER_ID = "uploaded-area-fill";
const AREA_LINE_LAYER_ID = "uploaded-area-line";
const AREA_POINT_LAYER_ID = "uploaded-area-point";
const INSIDE_SOURCE_ID = "inside-area-records";
const INSIDE_LAYER_ID = "inside-area-records-layer";
const BRAZIL_CENTER: [number, number] = [-53.3, -15.2];
const numberFormatter = new Intl.NumberFormat("pt-BR");
const SPECIES_GROUPS: SpeciesGroup[] = ["Anfíbios", "Répteis"];
const biomeColors: Record<string, string> = {
  amazonia: "#237a57",
  caatinga: "#d4922f",
  cerrado: "#8a9b3f",
  "mata-atlantica": "#287f8d",
  pampa: "#8067a8",
  pantanal: "#c45f48",
};

const curatedColors = [
  "#0d9488",
  "#e85d2a",
  "#2563eb",
  "#b9387a",
  "#7c3aed",
  "#ca8a04",
  "#0891b2",
  "#dc2626",
  "#4d7c0f",
  "#c2410c",
];

function colorForIndex(index: number) {
  if (index < curatedColors.length) return curatedColors[index];
  const hue = Math.round((index * 137.508) % 360);
  return `hsl(${hue} 68% 43%)`;
}

function createTriangleMarkerImage(color: string) {
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Não foi possível preparar os marcadores do mapa.");
  context.beginPath();
  context.moveTo(size / 2, 3);
  context.lineTo(size - 4, size - 4);
  context.lineTo(4, size - 4);
  context.closePath();
  context.fillStyle = color;
  context.fill();
  context.lineJoin = "round";
  context.lineWidth = 3.5;
  context.strokeStyle = "#ffffff";
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatSourceDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

async function fetchSpeciesPoints(speciesId: string) {
  const response = await fetch(`/data/species/${speciesId}.json`);
  if (!response.ok) throw new Error("Não foi possível carregar os pontos.");
  return response.json() as Promise<PointTuple[]>;
}

type InformationDialogProps = {
  sourceDate?: string;
  biomeSourceUrl?: string;
  biomeScale?: string;
};

function InformationDialog({
  sourceDate,
  biomeSourceUrl,
  biomeScale,
}: InformationDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="atlas-info-menu-button"
          aria-label="Informações sobre o HerpetoHelp"
        >
          <span className="atlas-info-menu-icon" aria-hidden="true">
            <Info />
          </span>
          <span className="atlas-info-menu-copy">
            <strong>Informações</strong>
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="atlas-info-dialog" showCloseButton={false}>
        <DialogHeader className="atlas-info-dialog-header">
          <span className="atlas-info-dialog-icon" aria-hidden="true">
            <Info />
          </span>
          <div>
            <DialogTitle>Sobre o HerpetoHelp</DialogTitle>
            <DialogDescription>
              Explore e compare registros georreferenciados de anfíbios e répteis em
              todo o Brasil.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="atlas-info-dialog-body">
          <section aria-labelledby="info-how-to-use">
            <h3 id="info-how-to-use">Como usar</h3>
            <ol className="atlas-info-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Busque espécies</strong>
                  <p>
                    Adicione uma ou mais espécies ao mapa para comparar suas
                    distribuições. Os controles de exibir e ocultar não alteram o
                    enquadramento atual.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Analise uma área em KMZ</strong>
                  <p>
                    Insira um polígono para identificar as espécies registradas dentro
                    dele e exportar os resultados em Excel.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Explore os biomas</strong>
                  <p>
                    Selecione um bioma para consultar suas espécies ou use o botão
                    Biomas para ligar e desligar todos os limites no mapa.
                  </p>
                </div>
              </li>
            </ol>
          </section>

          <section aria-labelledby="info-data-source">
            <h3 id="info-data-source">Dados e interpretação</h3>
            <div className="atlas-info-note">
              <p>
                <strong>Ocorrências:</strong> SALVE/ICMBio
                {sourceDate ? `, base de ${sourceDate}` : ""}. Pontos coincidentes por
                espécie são consolidados.
              </p>
              <p>
                <strong>Biomas:</strong>{" "}
                {biomeSourceUrl ? (
                  <a href={biomeSourceUrl} target="_blank" rel="noreferrer">
                    IBGE, Biomas do Brasil 2025
                  </a>
                ) : (
                  "IBGE, Biomas do Brasil 2025"
                )}
                {biomeScale ? ` (${biomeScale})` : ""}. Os limites são simplificados
                somente para a exibição; a consulta utiliza o recorte integral.
              </p>
            </div>
            <p className="atlas-info-caution">
              A ausência de registros não indica ausência biológica. Os dados devem
              ser interpretados considerando o esforço amostral, a data e a qualidade
              das coordenadas disponíveis.
            </p>
            <p className="atlas-info-recommendation">
              <strong>Importante:</strong> recomendamos sempre conferir as informações
              diretamente na base de dados do{" "}
              <a href="https://salve.icmbio.gov.br/" target="_blank" rel="noreferrer">
                SALVE/ICMBio
              </a>
              .
            </p>
          </section>

          <section aria-labelledby="info-privacy">
            <h3 id="info-privacy">Privacidade do KMZ</h3>
            <p className="atlas-info-privacy">
              O arquivo enviado é processado neste navegador e não é armazenado pelo
              HerpetoHelp.
            </p>
          </section>

          <section aria-labelledby="info-citation">
            <h3 id="info-citation">Como citar</h3>
            <div className="atlas-info-citation">
              <p>
                No texto, use “HerpetoHelp (Oliveira 2026)” ou “(Oliveira 2026)”.
              </p>
              <blockquote>
                Oliveira, A. S. 2026. <em>HerpetoHelp: mapa interativo de
                distribuição da herpetofauna brasileira. Versão 1.0</em>. Disponível
                em: <a href="https://www.herpetohelp.com.br">www.herpetohelp.com.br</a>.
                Acesso em: [dia mês ano].
              </blockquote>
              <p>
                Ao utilizar os registros, cite também a base original do{" "}
                <a href="https://salve.icmbio.gov.br/" target="_blank" rel="noreferrer">
                  SALVE/ICMBio
                </a>, conforme a finalidade do trabalho.
              </p>
            </div>
          </section>

          <section aria-labelledby="info-development">
            <h3 id="info-development">Desenvolvimento e contato</h3>
            <div className="atlas-info-credit">
              <p>
                Desenvolvido por <strong>Arthur Schramm de Oliveira</strong>, com
                auxílio da IA{" "}
                <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">
                  ChatGPT
                </a>
                .
              </p>
              <a className="atlas-info-email" href="mailto:asoliveira22@gmail.com">
                <Mail aria-hidden="true" />
                asoliveira22@gmail.com
              </a>
            </div>
          </section>
        </div>

        <DialogFooter className="atlas-info-dialog-footer">
          <DialogClose asChild>
            <Button type="button">Entendi</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HerpetofaunaMap() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const colorCounterRef = useRef(0);
  const speciesColorsRef = useRef(new Map<string, string>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pointIndexRef = useRef<ArrayBuffer | null>(null);
  const analysisRequestRef = useRef(0);
  const pendingVisibilityViewportRef = useRef<PreservedViewport | null>(null);
  const pendingGroupBoundsRef = useRef<SpeciesMeta["bounds"] | null>(null);
  const pendingGroupSpeciesIdsRef = useRef<Set<string> | null>(null);
  const [index, setIndex] = useState<SpeciesIndex | null>(null);
  const [indexError, setIndexError] = useState(false);
  const [biomeCatalog, setBiomeCatalog] = useState<BiomeCatalog | null>(null);
  const [biomeCatalogError, setBiomeCatalogError] = useState(false);
  const [selectedBiomeId, setSelectedBiomeId] = useState("");
  const [biomeLayerData, setBiomeLayerData] =
    useState<FeatureCollection<Geometry> | null>(null);
  const [biomeLayerVisible, setBiomeLayerVisible] = useState(false);
  const [biomeLayerStatus, setBiomeLayerStatus] =
    useState<BiomeLayerStatus>("idle");
  const [selected, setSelected] = useState<SelectedSpecies[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [searchKey, setSearchKey] = useState(0);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(null);
  const [analysisArea, setAnalysisArea] = useState<MapArea | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [insideResults, setInsideResults] = useState<SpeciesInsideAreaResult[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [spreadsheetStatus, setSpreadsheetStatus] = useState<SpreadsheetStatus>("idle");
  const [spreadsheetError, setSpreadsheetError] = useState("");
  const [hiddenSpeciesIds, setHiddenSpeciesIds] = useState<Set<string>>(
    () => new Set(),
  );
  const hiddenSpeciesIdsRef = useRef(hiddenSpeciesIds);

  useEffect(() => {
    hiddenSpeciesIdsRef.current = hiddenSpeciesIds;
  }, [hiddenSpeciesIds]);

  const ensureSpeciesColor = useCallback((speciesId: string) => {
    const existingColor = speciesColorsRef.current.get(speciesId);
    if (existingColor) return existingColor;
    const color = colorForIndex(colorCounterRef.current++);
    speciesColorsRef.current.set(speciesId, color);
    return color;
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/data/species-index.json")
        .then((response) => {
          if (!response.ok) throw new Error("Não foi possível carregar o índice.");
          return response.json() as Promise<SpeciesIndex>;
        })
        .then((payload) => {
          if (active) setIndex(payload);
        })
        .catch(() => {
          if (active) setIndexError(true);
        }),
      fetch("/data/biomes/index.json")
        .then((response) => {
          if (!response.ok) throw new Error("Não foi possível carregar os biomas.");
          return response.json() as Promise<BiomeCatalog>;
        })
        .then((payload) => {
          if (active) setBiomeCatalog(payload);
        })
        .catch(() => {
          if (active) setBiomeCatalogError(true);
        }),
    ]);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    let disposed = false;
    let map: MapLibreMap | null = null;

    void import("maplibre-gl").then((maplibregl) => {
      if (disposed || !mapContainerRef.current) return;

      map = new maplibregl.Map({
        container: mapContainerRef.current,
        center: BRAZIL_CENTER,
        zoom: 3.05,
        minZoom: 2,
        maxZoom: 18,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            openstreetmap: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [
            {
              id: "openstreetmap",
              type: "raster",
              source: "openstreetmap",
              paint: { "raster-saturation": -0.28, "raster-contrast": 0.05 },
            },
          ],
        },
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 110 }), "bottom-right");
      map.addControl(
        new maplibregl.AttributionControl({
          compact: true,
          customAttribution: "Dados: SALVE/ICMBio",
        }),
        "bottom-right",
      );

      map.on("load", () => {
        if (!map) return;
        map.addSource(BIOME_OVERVIEW_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: BIOME_OVERVIEW_FILL_LAYER_ID,
          type: "fill",
          source: BIOME_OVERVIEW_SOURCE_ID,
          layout: { visibility: "none" },
          paint: {
            "fill-color": [
              "match",
              ["get", "id"],
              "amazonia",
              biomeColors.amazonia,
              "caatinga",
              biomeColors.caatinga,
              "cerrado",
              biomeColors.cerrado,
              "mata-atlantica",
              biomeColors["mata-atlantica"],
              "pampa",
              biomeColors.pampa,
              "pantanal",
              biomeColors.pantanal,
              "#4f716c",
            ],
            "fill-opacity": 0.1,
          },
        });
        map.addLayer({
          id: BIOME_OVERVIEW_LINE_LAYER_ID,
          type: "line",
          source: BIOME_OVERVIEW_SOURCE_ID,
          layout: { visibility: "none" },
          paint: {
            "line-color": [
              "match",
              ["get", "id"],
              "amazonia",
              biomeColors.amazonia,
              "caatinga",
              biomeColors.caatinga,
              "cerrado",
              biomeColors.cerrado,
              "mata-atlantica",
              biomeColors["mata-atlantica"],
              "pampa",
              biomeColors.pampa,
              "pantanal",
              biomeColors.pantanal,
              "#365d57",
            ],
            "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1.2, 8, 2.2],
            "line-opacity": 0.9,
          },
        });
        map.addSource(AREA_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: AREA_FILL_LAYER_ID,
          type: "fill",
          source: AREA_SOURCE_ID,
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": "#0f766e",
            "fill-opacity": 0.16,
          },
        });
        map.addLayer({
          id: AREA_LINE_LAYER_ID,
          type: "line",
          source: AREA_SOURCE_ID,
          paint: {
            "line-color": "#0b5b55",
            "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.8, 12, 3.2],
            "line-opacity": 0.92,
          },
        });
        map.addLayer({
          id: AREA_POINT_LAYER_ID,
          type: "circle",
          source: AREA_SOURCE_ID,
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-color": "#0b5b55",
            "circle-radius": 7,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        map.addSource(POINT_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: POINT_LAYER_ID,
          type: "circle",
          source: POINT_SOURCE_ID,
          paint: {
            "circle-color": ["get", "color"],
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 2.7, 8, 4.7, 13, 7],
            "circle-opacity": 0.78,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 2, 0.6, 10, 1.3],
          },
        });
        map.addSource(INSIDE_SOURCE_ID, {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: INSIDE_LAYER_ID,
          type: "symbol",
          source: INSIDE_SOURCE_ID,
          layout: {
            "icon-image": ["get", "marker"],
            "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.55, 9, 0.86, 13, 1.12],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: {
            "icon-opacity": 0.96,
          },
        });

        const openPopup = (event: MapMouseEvent) => {
          if (!map) return;
          const feature = map.queryRenderedFeatures(event.point, {
            layers: [INSIDE_LAYER_ID, POINT_LAYER_ID],
          })[0] as MapGeoJSONFeature | undefined;
          if (!feature || feature.geometry.type !== "Point") return;
          const properties = feature.properties as PointProperties;
          const coordinates = (feature.geometry as Point).coordinates as [number, number];
          const content = document.createElement("div");
          content.className = "map-popup-content";
          const name = document.createElement("strong");
          name.className = "map-popup-species";
          name.textContent = properties.species;
          const detail = document.createElement("span");
          if (properties.kind === "inside") {
            const records = Number(properties.records);
            detail.textContent = `${properties.group} · ${formatNumber(records)} ${records === 1 ? "registro" : "registros"} nesta coordenada · dentro da área`;
          } else {
            detail.textContent = `${formatNumber(Number(properties.records))} ${Number(properties.records) === 1 ? "registro" : "registros"} nesta coordenada`;
          }
          const location = document.createElement("span");
          location.className = "map-popup-coordinate";
          location.textContent = `${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}`;
          content.append(name, detail, location);
          new maplibregl.Popup({ closeButton: true, offset: 10 })
            .setLngLat(coordinates)
            .setDOMContent(content)
            .addTo(map);
        };

        map.on("click", openPopup);
        map.on("mousemove", (event) => {
          if (!map) return;
          const hasInteractivePoint = map.queryRenderedFeatures(event.point, {
            layers: [INSIDE_LAYER_ID, POINT_LAYER_ID],
          }).length > 0;
          map.getCanvas().style.cursor = hasInteractivePoint ? "pointer" : "";
        });

        mapRef.current = map;
        setMapReady(true);
      });
    });

    return () => {
      disposed = true;
      setMapReady(false);
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource(BIOME_OVERVIEW_SOURCE_ID) as
      | GeoJSONSource
      | undefined;
    if (!source) return;
    if (biomeLayerData) source.setData(biomeLayerData);
    const visibility = biomeLayerVisible ? "visible" : "none";
    map.setLayoutProperty(BIOME_OVERVIEW_FILL_LAYER_ID, "visibility", visibility);
    map.setLayoutProperty(BIOME_OVERVIEW_LINE_LAYER_ID, "visibility", visibility);
  }, [biomeLayerData, biomeLayerVisible, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const pointSource = map.getSource(POINT_SOURCE_ID) as GeoJSONSource | undefined;
    const areaSource = map.getSource(AREA_SOURCE_ID) as GeoJSONSource | undefined;
    const insideSource = map.getSource(INSIDE_SOURCE_ID) as GeoJSONSource | undefined;
    if (!pointSource || !areaSource || !insideSource) return;

    const features: FeatureCollection<Point, PointProperties>["features"] = [];
    for (const species of selected) {
      if (
        species.status !== "ready" ||
        !species.points ||
        hiddenSpeciesIds.has(species.id)
      ) {
        continue;
      }
      for (const [longitude, latitude, records] of species.points) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [longitude, latitude] },
          properties: {
            kind: "species",
            species: species.name,
            color: species.color,
            records,
          },
        });
      }
    }
    pointSource.setData({ type: "FeatureCollection", features });
    areaSource.setData(
      analysisArea?.featureCollection ?? { type: "FeatureCollection", features: [] },
    );

    const insideFeatures: FeatureCollection<Point, PointProperties>["features"] = [];
    if (analysisMode === "kmz") {
      for (const result of insideResults) {
        if (hiddenSpeciesIds.has(result.species.id)) continue;
        const marker = `inside-triangle-${result.species.id}`;
        if (!map.hasImage(marker)) {
          map.addImage(marker, createTriangleMarkerImage(result.color), { pixelRatio: 2 });
        }
        for (const [longitude, latitude, records] of result.points) {
          insideFeatures.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [longitude, latitude] },
            properties: {
              kind: "inside",
              species: result.species.name,
              group: result.species.group,
              marker,
              records,
            },
          });
        }
      }
    }
    insideSource.setData({ type: "FeatureCollection", features: insideFeatures });
  }, [analysisArea, analysisMode, hiddenSpeciesIds, insideResults, mapReady, selected]);

  // Visibility toggles update the layers above without moving the consultant's viewport.
  const analysisAreaBounds = analysisArea?.bounds ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (pendingGroupSpeciesIdsRef.current) return;
    const readySpecies = selected.filter(
      (species) =>
        species.status === "ready" && !hiddenSpeciesIdsRef.current.has(species.id),
    );
    if (!analysisAreaBounds && readySpecies.length === 0) {
      map.easeTo({ center: BRAZIL_CENTER, zoom: 3.05, duration: 700 });
      return;
    }

    let west: number;
    let south: number;
    let east: number;
    let north: number;
    if (analysisAreaBounds) {
      [west, south, east, north] = analysisAreaBounds;
    } else {
      west = Math.min(...readySpecies.map((species) => species.bounds[0]));
      south = Math.min(...readySpecies.map((species) => species.bounds[1]));
      east = Math.max(...readySpecies.map((species) => species.bounds[2]));
      north = Math.max(...readySpecies.map((species) => species.bounds[3]));
    }

    if (west === east && south === north) {
      map.easeTo({
        center: [west, south],
        zoom: analysisAreaBounds ? 12 : 8.5,
        duration: 800,
      });
    } else {
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 64, duration: 850, maxZoom: analysisAreaBounds ? 12 : 10 },
      );
    }
  }, [analysisAreaBounds, mapReady, selected]);

  useEffect(() => {
    const pendingIds = pendingGroupSpeciesIdsRef.current;
    if (!pendingIds) return;
    const pendingSpecies = selected.filter((species) => pendingIds.has(species.id));
    if (pendingSpecies.some((species) => species.status === "loading")) return;

    const map = mapRef.current;
    const bounds = pendingGroupBoundsRef.current;
    if (bounds && (!mapReady || !map)) return;
    if (bounds && map) {
      map.stop();
      const [west, south, east, north] = bounds;
      if (west === east && south === north) {
        map.easeTo({ center: [west, south], zoom: 8.5, duration: 800 });
      } else {
        map.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          { padding: 64, duration: 850, maxZoom: 10 },
        );
      }
    }
    pendingGroupBoundsRef.current = null;
    pendingGroupSpeciesIdsRef.current = null;
  }, [mapReady, selected]);

  useEffect(() => {
    const map = mapRef.current;
    const viewport = pendingVisibilityViewportRef.current;
    if (!mapReady || !map || !viewport) return;
    map.stop();
    map.jumpTo(viewport);
    pendingVisibilityViewportRef.current = null;
  }, [hiddenSpeciesIds, mapReady]);

  const selectedIds = useMemo(() => new Set(selected.map((species) => species.id)), [selected]);
  const availableSpecies = useMemo(
    () => index?.species.filter((species) => !selectedIds.has(species.id)) ?? [],
    [index, selectedIds],
  );
  const selectedBiome = useMemo(
    () => biomeCatalog?.biomes.find((biome) => biome.id === selectedBiomeId) ?? null,
    [biomeCatalog, selectedBiomeId],
  );
  const visibleInsideResults = useMemo(() => {
    const normalizedQuery = resultQuery
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
    if (!normalizedQuery) return insideResults;
    return insideResults.filter((result) =>
      [result.species.name, result.species.family, result.species.group]
        .join(" ")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .includes(normalizedQuery),
    );
  }, [insideResults, resultQuery]);
  const groupedVisibleInsideResults = useMemo(
    () =>
      SPECIES_GROUPS.map((group) => ({
        group,
        results: visibleInsideResults.filter((result) => result.species.group === group),
      })).filter(({ results }) => results.length > 0),
    [visibleInsideResults],
  );
  const groupedSelectedSpecies = useMemo(
    () =>
      SPECIES_GROUPS.map((group) => ({
        group,
        species: selected.filter((item) => item.group === group),
      })).filter(({ species }) => species.length > 0),
    [selected],
  );

  const loadSpeciesPoints = useCallback((speciesId: string) => {
    fetchSpeciesPoints(speciesId)
      .then((points) => {
        setSelected((current) =>
          current.map((item) =>
            item.id === speciesId ? { ...item, status: "ready", points } : item,
          ),
        );
      })
      .catch(() => {
        setSelected((current) =>
          current.map((item) =>
            item.id === speciesId ? { ...item, status: "error" } : item,
          ),
        );
      });
  }, []);

  const addSpecies = useCallback((species: SpeciesMeta | null) => {
    if (!species) return;
    const color = ensureSpeciesColor(species.id);
    setHiddenSpeciesIds((current) => {
      if (!current.has(species.id)) return current;
      const next = new Set(current);
      next.delete(species.id);
      return next;
    });
    setSelected((current) => {
      if (current.some((item) => item.id === species.id)) return current;
      return [...current, { ...species, color, status: "loading" }];
    });
    setSearchKey((value) => value + 1);
    loadSpeciesPoints(species.id);
  }, [ensureSpeciesColor, loadSpeciesPoints]);

  const preserveViewportForVisibilityChange = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      map.stop();
      const center = map.getCenter();
      pendingVisibilityViewportRef.current = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
    }
  }, []);

  const toggleSpeciesVisibility = useCallback((speciesId: string) => {
    preserveViewportForVisibilityChange();
    setHiddenSpeciesIds((current) => {
      const next = new Set(current);
      if (next.has(speciesId)) {
        next.delete(speciesId);
      } else {
        next.add(speciesId);
      }
      return next;
    });
  }, [preserveViewportForVisibilityChange]);

  const setSpeciesGroupVisibility = useCallback((
    speciesIds: string[],
    visible: boolean,
  ) => {
    if (speciesIds.length === 0) return;
    preserveViewportForVisibilityChange();
    setHiddenSpeciesIds((current) => {
      const next = new Set(current);
      for (const speciesId of speciesIds) {
        if (visible) {
          next.delete(speciesId);
        } else {
          next.add(speciesId);
        }
      }
      return next;
    });
  }, [preserveViewportForVisibilityChange]);

  const addSpeciesGroup = useCallback((speciesGroup: SpeciesMeta[]) => {
    if (speciesGroup.length === 0) return;
    const groupIds = speciesGroup.map((species) => species.id);
    const speciesToAdd = speciesGroup.filter((species) => !selectedIds.has(species.id));

    if (speciesToAdd.length === 0) {
      setSpeciesGroupVisibility(groupIds, true);
      return;
    }

    pendingGroupBoundsRef.current = speciesGroup.reduce<SpeciesMeta["bounds"]>(
      ([west, south, east, north], species) => [
        Math.min(west, species.bounds[0]),
        Math.min(south, species.bounds[1]),
        Math.max(east, species.bounds[2]),
        Math.max(north, species.bounds[3]),
      ],
      [...speciesGroup[0].bounds],
    );
    pendingGroupSpeciesIdsRef.current = new Set(
      speciesToAdd.map((species) => species.id),
    );

    setHiddenSpeciesIds((current) => {
      const next = new Set(current);
      for (const speciesId of groupIds) next.delete(speciesId);
      return next;
    });
    setSelected((current) => {
      const currentIds = new Set(current.map((species) => species.id));
      const additions = speciesToAdd
        .filter((species) => !currentIds.has(species.id))
        .map((species) => ({
          ...species,
          color: ensureSpeciesColor(species.id),
          status: "loading" as const,
        }));
      return additions.length > 0 ? [...current, ...additions] : current;
    });
    setSearchKey((value) => value + 1);
    void Promise.all(
      speciesToAdd.map(async (species) => {
        try {
          const points = await fetchSpeciesPoints(species.id);
          return [species.id, { status: "ready" as const, points }] as const;
        } catch {
          return [species.id, { status: "error" as const }] as const;
        }
      }),
    ).then((loadedSpecies) => {
      const updates = new Map(loadedSpecies);
      setSelected((current) =>
        current.map((species) => {
          const update = updates.get(species.id);
          return update ? { ...species, ...update } : species;
        }),
      );
    });
  }, [ensureSpeciesColor, selectedIds, setSpeciesGroupVisibility]);

  const removeSpecies = useCallback((speciesId: string) => {
    setSelected((current) => current.filter((species) => species.id !== speciesId));
  }, []);

  const clearSelection = useCallback(() => {
    setSelected([]);
  }, []);

  const clearAnalysis = useCallback(() => {
    analysisRequestRef.current += 1;
    setAnalysisMode(null);
    setAnalysisArea(null);
    setSelectedBiomeId("");
    setUploadedFileName("");
    setInsideResults([]);
    setResultQuery("");
    setAnalysisError("");
    setAnalysisStatus("idle");
    setSpreadsheetError("");
    setSpreadsheetStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const toggleBiomeLayer = useCallback(async () => {
    if (biomeLayerVisible) {
      setBiomeLayerVisible(false);
      return;
    }
    if (biomeLayerData) {
      setBiomeLayerVisible(true);
      return;
    }
    if (!biomeCatalog || biomeLayerStatus === "loading") return;

    setBiomeLayerStatus("loading");
    try {
      const [response, overviewModule] = await Promise.all([
        fetch(BIOME_OVERVIEW_PATH),
        import("@/lib/biome-overview"),
      ]);
      if (!response.ok) {
        throw new Error("Não foi possível carregar os limites dos biomas.");
      }
      const featureCollection = overviewModule.decodeBiomeOverview(
        await response.arrayBuffer(),
      );
      setBiomeLayerData(featureCollection);
      setBiomeLayerVisible(true);
      setBiomeLayerStatus("ready");
    } catch {
      setBiomeLayerVisible(false);
      setBiomeLayerStatus("error");
    }
  }, [biomeCatalog, biomeLayerData, biomeLayerStatus, biomeLayerVisible]);

  const handleBiomeSelect = useCallback(
    async (biomeId: string) => {
      if (!index || !biomeCatalog) return;
      const biome = biomeCatalog.biomes.find((candidate) => candidate.id === biomeId);
      if (!biome) return;
      const requestId = analysisRequestRef.current + 1;
      analysisRequestRef.current = requestId;

      setAnalysisMode("biome");
      setSelectedBiomeId(biome.id);
      setUploadedFileName("");
      setInsideResults([]);
      setResultQuery("");
      setAnalysisError("");
      setSpreadsheetError("");
      setSpreadsheetStatus("idle");
      setAnalysisStatus("loading-data");
      setAnalysisArea({
        featureCollection: { type: "FeatureCollection", features: [] },
        bounds: biome.bounds,
        geometryCount: 1,
      });
      if (fileInputRef.current) fileInputRef.current.value = "";

      try {
        const [geometryResponse, pointsResponse, analysisModule] = await Promise.all([
          fetch(biome.geometryPath),
          fetch(biome.pointsPath),
          import("@/lib/kmz-analysis"),
        ]);
        if (!geometryResponse.ok || !pointsResponse.ok) {
          throw new Error("Não foi possível carregar os dados deste bioma.");
        }
        const [featureCollection, pointIndex] = await Promise.all([
          geometryResponse.json() as Promise<FeatureCollection<Geometry>>,
          pointsResponse.arrayBuffer(),
        ]);
        if (analysisRequestRef.current !== requestId) return;
        if (
          featureCollection.type !== "FeatureCollection" ||
          !Array.isArray(featureCollection.features)
        ) {
          throw new Error("O limite deste bioma está em um formato inesperado.");
        }

        setAnalysisArea({
          featureCollection,
          bounds: biome.bounds,
          geometryCount: featureCollection.features.length,
        });
        setAnalysisStatus("analyzing");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
        const results = analysisModule.groupSpeciesFromPointIndex(
          pointIndex,
          index.species.length,
        );
        const mappedResults = results.map(({ speciesIndex, ...result }) => {
          const species = index.species[speciesIndex];
          return {
            ...result,
            species,
            color: ensureSpeciesColor(species.id),
          };
        });
        const coordinateCount = mappedResults.reduce(
          (total, result) => total + result.coordinateCount,
          0,
        );
        const recordCount = mappedResults.reduce(
          (total, result) => total + result.recordCount,
          0,
        );
        if (
          mappedResults.length !== biome.speciesCount ||
          coordinateCount !== biome.coordinateCount ||
          recordCount !== biome.recordCount
        ) {
          throw new Error("Os registros deste bioma não passaram pela conferência de integridade.");
        }
        if (analysisRequestRef.current !== requestId) return;
        setInsideResults(mappedResults);
        setAnalysisStatus("ready");
      } catch (error) {
        if (analysisRequestRef.current !== requestId) return;
        setInsideResults([]);
        setAnalysisStatus("error");
        setAnalysisError(
          error instanceof Error
            ? error.message
            : "Não foi possível consultar este bioma.",
        );
      }
    },
    [biomeCatalog, ensureSpeciesColor, index],
  );

  const handleAreaUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      if (!file || !index) return;
      const requestId = analysisRequestRef.current + 1;
      analysisRequestRef.current = requestId;

      setAnalysisMode("kmz");
      setAnalysisArea(null);
      setSelectedBiomeId("");
      setInsideResults([]);
      setResultQuery("");
      setAnalysisError("");
      setSpreadsheetError("");
      setSpreadsheetStatus("idle");
      setUploadedFileName(file.name);
      setAnalysisStatus("reading");

      try {
        const analysisModule = await import("@/lib/kmz-analysis");
        const area = await analysisModule.readKmz(file);
        if (analysisRequestRef.current !== requestId) return;
        setAnalysisArea(area);
        setAnalysisStatus("loading-data");

        let pointIndex = pointIndexRef.current;
        if (!pointIndex) {
          const response = await fetch("/data/spatial-points.bin");
          if (!response.ok) throw new Error("Não foi possível carregar o índice espacial.");
          pointIndex = await response.arrayBuffer();
          pointIndexRef.current = pointIndex;
        }

        setAnalysisStatus("analyzing");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
        const results = analysisModule.findSpeciesInsideArea(
          pointIndex,
          area,
          index.species.length,
        );
        if (analysisRequestRef.current !== requestId) return;
        setInsideResults(
          results.map(({ speciesIndex, ...result }) => {
            const species = index.species[speciesIndex];
            return {
              ...result,
              species,
              color: ensureSpeciesColor(species.id),
            };
          }),
        );
        setAnalysisStatus("ready");
      } catch (error) {
        if (analysisRequestRef.current !== requestId) return;
        setInsideResults([]);
        setAnalysisStatus("error");
        setAnalysisError(
          error instanceof Error ? error.message : "Não foi possível analisar este KMZ.",
        );
      } finally {
        input.value = "";
      }
    },
    [ensureSpeciesColor, index],
  );

  const downloadAreaSpreadsheet = useCallback(async () => {
    if (insideResults.length === 0 || spreadsheetStatus !== "idle") return;
    setSpreadsheetError("");
    setSpreadsheetStatus("loading");
    try {
      const spreadsheetModule = await import("@/lib/area-spreadsheet");
      const details = await spreadsheetModule.loadAreaOccurrenceDetails(insideResults);
      setSpreadsheetStatus("building");
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      const workbook = spreadsheetModule.createAreaSpreadsheet(insideResults, details);
      const blob = new Blob([workbook], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fileStem = uploadedFileName
        .replace(/\.kmz$/i, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "");
      link.href = url;
      link.download = `especies_e_registros_na_area_${fileStem || "kmz"}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setSpreadsheetError(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar a planilha.",
      );
    } finally {
      setSpreadsheetStatus("idle");
    }
  }, [insideResults, spreadsheetStatus, uploadedFileName]);

  const totalSelectedCoordinates = selected.reduce(
    (total, species) =>
      total +
      (species.status === "ready" && !hiddenSpeciesIds.has(species.id)
        ? species.coordinateCount
        : 0),
    0,
  );
  const totalSelectedRecords = selected.reduce(
    (total, species) =>
      total +
      (species.status === "ready" && !hiddenSpeciesIds.has(species.id)
        ? species.recordCount
        : 0),
    0,
  );
  const visibleSelectedCount = selected.filter(
    (species) => !hiddenSpeciesIds.has(species.id),
  ).length;
  const totalInsideCoordinates = insideResults.reduce(
    (total, result) => total + result.coordinateCount,
    0,
  );
  const totalInsideRecords = insideResults.reduce(
    (total, result) => total + result.recordCount,
    0,
  );
  const isBiomeAnalysis = analysisMode === "biome";
  const analysisInProgress = ["reading", "loading-data", "analyzing"].includes(
    analysisStatus,
  );
  const analysisStatusText =
    isBiomeAnalysis && analysisStatus === "loading-data"
      ? "Carregando o limite e os registros do bioma…"
      : isBiomeAnalysis && analysisStatus === "analyzing"
        ? "Organizando a lista de espécies…"
        : analysisStatus === "reading"
          ? "Lendo o arquivo…"
          : analysisStatus === "loading-data"
            ? "Preparando os registros do SALVE…"
            : "Identificando as espécies dentro da área…";
  const spreadsheetStatusText =
    spreadsheetStatus === "loading"
      ? "Carregando registros…"
      : "Gerando Excel…";
  const analysisResultsPanel =
    analysisStatus === "ready" && insideResults.length > 0 ? (
      <div className={`atlas-inside-results${isBiomeAnalysis ? " is-biome" : ""}`}>
        <div className="atlas-inside-heading">
          <div className="atlas-inside-heading-copy">
            <span>
              Espécies registradas {isBiomeAnalysis ? "no bioma" : "na área"}
            </span>
            <small>
              {formatNumber(insideResults.length)}{" "}
              {insideResults.length === 1 ? "espécie" : "espécies"} ·{" "}
              {formatNumber(totalInsideCoordinates)}{" "}
              {totalInsideCoordinates === 1 ? "ponto" : "pontos"} ·{" "}
              {formatNumber(totalInsideRecords)}{" "}
              {totalInsideRecords === 1 ? "registro" : "registros"}
            </small>
          </div>
          {isBiomeAnalysis && selectedBiome ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="atlas-download-button"
            >
              <a
                href={`/data/biomes/exports/${selectedBiome.id}.xlsx`}
                download={`registros_salve_${selectedBiome.id}.xlsx`}
              >
                <Download aria-hidden="true" />
                Baixar planilha (.xlsx)
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="atlas-download-button"
              onClick={downloadAreaSpreadsheet}
              disabled={spreadsheetStatus !== "idle"}
            >
              {spreadsheetStatus === "idle" ? (
                <Download aria-hidden="true" />
              ) : (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              )}
              {spreadsheetStatus === "idle"
                ? "Baixar planilha (.xlsx)"
                : spreadsheetStatusText}
            </Button>
          )}
        </div>
        {spreadsheetError && !isBiomeAnalysis && (
          <div className="atlas-error" role="alert">
            <CircleAlert /> {spreadsheetError}
          </div>
        )}
        {isBiomeAnalysis ? (
          <label className="atlas-results-filter">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={resultQuery}
              onChange={(event) => setResultQuery(event.currentTarget.value)}
              placeholder="Filtrar por espécie ou família…"
              aria-label="Filtrar espécies registradas no bioma"
            />
            {resultQuery && (
              <span aria-live="polite">
                {formatNumber(visibleInsideResults.length)} de{" "}
                {formatNumber(insideResults.length)}
              </span>
            )}
          </label>
        ) : (
          <span className="atlas-inside-map-key">
            <i aria-hidden="true" /> triângulos = registros dentro da área
          </span>
        )}
        <div className="atlas-inside-groups">
          {groupedVisibleInsideResults.map(({ group, results }) => {
            const groupSpecies = results.map((result) => result.species);
            const groupIds = groupSpecies.map((species) => species.id);
            const visibilityIds = isBiomeAnalysis
              ? groupIds.filter((speciesId) => selectedIds.has(speciesId))
              : groupIds;
            const groupHidden =
              visibilityIds.length === 0 ||
              visibilityIds.every((speciesId) => hiddenSpeciesIds.has(speciesId));
            const groupAdded = groupIds.every((speciesId) => selectedIds.has(speciesId));
            return (
              <section
                className="atlas-inside-group"
                key={group}
                aria-label={`${group} registrados ${isBiomeAnalysis ? "no bioma" : "na área"}`}
              >
                <div className="atlas-species-group-heading atlas-inside-group-heading">
                  <div className="atlas-species-group-label">
                    <strong>{group}</strong>
                    <span>{formatNumber(results.length)}</span>
                  </div>
                  <div
                    className="atlas-group-visibility-actions"
                    role="group"
                    aria-label={`Controles de visibilidade do grupo ${group}`}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="atlas-group-visibility-button atlas-group-eye-button"
                      onClick={() =>
                        setSpeciesGroupVisibility(visibilityIds, groupHidden)
                      }
                      disabled={visibilityIds.length === 0}
                      aria-label={`${groupHidden ? "Ativar" : "Desativar"} a visibilidade do grupo ${group}`}
                      title={`${groupHidden ? "Mostrar" : "Ocultar"} grupo ${group}`}
                    >
                      {groupHidden ? <EyeOff /> : <Eye />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="atlas-group-visibility-button"
                      onClick={() => addSpeciesGroup(groupSpecies)}
                      disabled={groupAdded}
                      aria-label={`Adicionar todas as espécies do grupo ${group} ao mapa com suas distribuições completas`}
                      title={`Exibir distribuições completas do grupo ${group}`}
                    >
                      <span>Exibir</span>
                    </Button>
                  </div>
                </div>
                <ul>
                  {results.map((result) => {
                    const alreadySelected = selectedIds.has(result.species.id);
                    const hidden =
                      hiddenSpeciesIds.has(result.species.id) &&
                      (!isBiomeAnalysis || alreadySelected);
                    const showVisibilityAction = !isBiomeAnalysis || alreadySelected;
                    return (
                      <li key={result.species.id}>
                        <div
                          className={`atlas-inside-result-row${hidden ? " is-hidden" : ""}${showVisibilityAction ? "" : " no-visibility-action"}`}
                        >
                          <button
                            type="button"
                            className="atlas-inside-result"
                            disabled={alreadySelected}
                            onClick={() => addSpecies(result.species)}
                            aria-label={
                              alreadySelected
                                ? `${result.species.name} já está no mapa`
                                : `Exibir a distribuição completa de ${result.species.name}`
                            }
                          >
                            <span
                              className="atlas-inside-marker"
                              style={{ backgroundColor: result.color }}
                              aria-hidden="true"
                            />
                            <span className="atlas-inside-copy">
                              <strong>{result.species.name}</strong>
                              <small>
                                {result.species.group} · {formatNumber(result.coordinateCount)}{" "}
                                {result.coordinateCount === 1 ? "ponto" : "pontos"} ·{" "}
                                {formatNumber(result.recordCount)}{" "}
                                {result.recordCount === 1 ? "registro" : "registros"}
                              </small>
                            </span>
                            <span className="atlas-inside-action">
                              {alreadySelected ? (hidden ? "Oculta" : "No mapa") : "Exibir"}
                            </span>
                          </button>
                          {showVisibilityAction && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="atlas-inside-visibility-button"
                              onClick={() => toggleSpeciesVisibility(result.species.id)}
                              aria-label={`${hidden ? "Mostrar" : "Ocultar"} ${result.species.name} no mapa`}
                              title={`${hidden ? "Mostrar" : "Ocultar"} no mapa`}
                            >
                              {hidden ? <EyeOff /> : <Eye />}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        {isBiomeAnalysis && visibleInsideResults.length === 0 && (
          <div className="atlas-results-no-match" role="status">
            Nenhuma espécie corresponde a este filtro.
          </div>
        )}
        <p className="atlas-area-note">
          {isBiomeAnalysis ? (
            <>
              Recorte:{" "}
              <a href={biomeCatalog?.sourceUrl} target="_blank" rel="noreferrer">
                IBGE, Biomas do Brasil 2025
              </a>{" "}
              ({biomeCatalog?.scale}). A classificação usa o limite oficial integral; o
              traçado é simplificado apenas na exibição do mapa. “Exibir” adiciona a
              distribuição completa da espécie. {biomeCatalog?.legalNotice}
            </>
          ) : (
            <>
              Somente ocorrências com coordenadas dentro do polígono enviado são consideradas. Pontos sobre o limite também são incluídos. O ícone de olho oculta a espécie no mapa sem alterar a planilha.
            </>
          )}
        </p>
      </div>
    ) : analysisStatus === "ready" && insideResults.length === 0 ? (
      <div className="atlas-area-empty-result" role="status">
        <CircleAlert aria-hidden="true" />
        <span>
          Nenhum registro do SALVE foi encontrado{" "}
          {isBiomeAnalysis ? "neste bioma" : "dentro desta área"}.
        </span>
      </div>
    ) : null;

  return (
    <main className="atlas-shell">
      <aside className="atlas-panel" aria-label="Seleção de espécies">
        <header className="atlas-header">
          <div className="atlas-brand-row">
            <span className="atlas-logo-frame">
              <img
                className="atlas-logo"
                src="/herpetohelp-logo.png"
                width="1672"
                height="941"
                alt="HerpetoHelp"
              />
            </span>
          </div>
          <h1>Distribuição da herpetofauna</h1>
          <p>Compare distribuições ou explore os registros por bioma e por área em KMZ.</p>
        </header>

        <section className="atlas-summary" aria-label="Resumo da base">
          {index ? (
            <>
              <div>
                <strong>{formatNumber(index.speciesCount)}</strong>
                <span>espécies</span>
              </div>
              <div>
                <strong>{formatNumber(index.coordinateCount)}</strong>
                <span>pontos</span>
              </div>
              <div>
                <strong>{formatNumber(index.recordCount)}</strong>
                <span>registros</span>
              </div>
            </>
          ) : (
            <div className="atlas-index-loading">
              <LoaderCircle className="animate-spin" /> Preparando a busca…
            </div>
          )}
        </section>

        <section className="atlas-search" aria-labelledby="species-search-label">
          <div className="atlas-section-label">
            <Search aria-hidden="true" />
            <label id="species-search-label">Buscar espécie</label>
          </div>
          {indexError ? (
            <div className="atlas-error" role="alert">
              <CircleAlert /> Não foi possível carregar a lista de espécies.
            </div>
          ) : (
            <Combobox
              key={searchKey}
              items={availableSpecies}
              itemToStringLabel={(species: SpeciesMeta) => species.name}
              itemToStringValue={(species: SpeciesMeta) => species.id}
              isItemEqualToValue={(a: SpeciesMeta, b: SpeciesMeta) => a.id === b.id}
              onValueChange={addSpecies}
              limit={60}
              disabled={!index}
            >
              <ComboboxInput
                className="atlas-combobox"
                placeholder="Digite o nome científico…"
                aria-label="Digite o nome científico da espécie"
                showClear
              />
              <ComboboxContent className="atlas-combobox-content">
                <ComboboxEmpty>Nenhuma espécie encontrada.</ComboboxEmpty>
                <ComboboxList>
                  <ComboboxCollection>
                    {(species: SpeciesMeta) => (
                      <ComboboxItem key={species.id} value={species} className="atlas-species-option">
                        <span className="atlas-option-name">{species.name}</span>
                        <span className="atlas-option-meta">
                          {species.group} · {formatNumber(species.coordinateCount)} pontos
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          )}
        </section>

        <section className="atlas-area" aria-labelledby="area-analysis-heading">
          <div className="atlas-section-label">
            <FileUp aria-hidden="true" />
            <h2 id="area-analysis-heading">Analisar uma área</h2>
          </div>
          <input
            ref={fileInputRef}
            className="atlas-file-input"
            type="file"
            accept=".kmz,application/vnd.google-earth.kmz"
            onChange={handleAreaUpload}
            aria-label="Selecionar arquivo KMZ da área"
          />
          <div className="atlas-upload-actions">
            <Button
              variant="outline"
              className="atlas-upload-button"
              disabled={!index || analysisInProgress}
              onClick={() => fileInputRef.current?.click()}
            >
              {analysisInProgress ? <LoaderCircle className="animate-spin" /> : <FileUp />}
              {uploadedFileName ? "Substituir área" : "Inserir área (.kmz)"}
            </Button>
            {uploadedFileName && (
              <Button
                variant="ghost"
                size="icon"
                className="atlas-delete-area-button"
                onClick={clearAnalysis}
                disabled={analysisInProgress}
                aria-label="Remover a área enviada"
              >
                <Trash2 />
              </Button>
            )}
          </div>
          <p className="atlas-upload-privacy">
            O KMZ é opcional. Sem ele, use a busca acima para comparar duas ou mais espécies. O arquivo enviado é analisado neste navegador e não é armazenado.
          </p>

          {analysisMode === "kmz" && analysisInProgress && (
            <div className="atlas-area-status" role="status" aria-live="polite">
              <LoaderCircle className="animate-spin" />
              <span>{analysisStatusText}</span>
            </div>
          )}

          {analysisMode === "kmz" && analysisStatus === "error" && (
            <div className="atlas-error" role="alert">
              <CircleAlert /> {analysisError}
            </div>
          )}

          {analysisMode === "kmz" &&
            analysisArea &&
            !analysisInProgress &&
            analysisStatus !== "error" && (
              <div className="atlas-area-file">
                <FileCheck2 aria-hidden="true" />
                <div>
                  <strong>{uploadedFileName}</strong>
                  <span>
                    {formatNumber(analysisArea.geometryCount)}{" "}
                    {analysisArea.geometryCount === 1 ? "geometria" : "geometrias"} no
                    mapa
                  </span>
                </div>
              </div>
            )}

          {analysisMode === "kmz" && analysisResultsPanel}
        </section>

        <section className="atlas-biome" aria-labelledby="biome-search-heading">
          <div className="atlas-section-label">
            <TreePine aria-hidden="true" />
            <h2 id="biome-search-heading">Explorar por bioma</h2>
          </div>
          {biomeCatalogError ? (
            <div className="atlas-error" role="alert">
              <CircleAlert /> Não foi possível carregar a lista de biomas.
            </div>
          ) : (
            <div className="atlas-biome-controls">
              <Select
                value={selectedBiomeId}
                onValueChange={(value) => void handleBiomeSelect(value)}
                disabled={
                  !index ||
                  !biomeCatalog ||
                  (analysisInProgress && isBiomeAnalysis)
                }
              >
                <SelectTrigger
                  className="atlas-biome-select"
                  aria-label="Selecionar bioma"
                >
                  <SelectValue placeholder="Selecione um bioma…" />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                  {biomeCatalog?.biomes.map((biome) => (
                    <SelectItem key={biome.id} value={biome.id}>
                      {biome.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isBiomeAnalysis && selectedBiome && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="atlas-delete-area-button"
                  onClick={clearAnalysis}
                  disabled={analysisInProgress}
                  aria-label="Limpar bioma selecionado"
                  title="Limpar bioma"
                >
                  <X />
                </Button>
              )}
            </div>
          )}
          <p className="atlas-upload-privacy">
            Ao selecionar, o mapa enquadra o bioma e mostra todas as espécies com registros nele.
          </p>

          {isBiomeAnalysis && analysisInProgress && (
            <div className="atlas-area-status" role="status" aria-live="polite">
              <LoaderCircle className="animate-spin" />
              <span>{analysisStatusText}</span>
            </div>
          )}

          {isBiomeAnalysis && analysisStatus === "error" && (
            <div className="atlas-error" role="alert">
              <CircleAlert /> {analysisError}
            </div>
          )}

          {isBiomeAnalysis &&
            selectedBiome &&
            !analysisInProgress &&
            analysisStatus !== "error" && (
              <div className="atlas-area-file atlas-biome-file">
                <TreePine aria-hidden="true" />
                <div>
                  <strong>{selectedBiome.name}</strong>
                  <span>
                    {formatNumber(selectedBiome.speciesCount)} espécies registradas ·
                    limite IBGE 2025
                  </span>
                </div>
              </div>
            )}

          {isBiomeAnalysis && analysisResultsPanel}
        </section>

        <section className="atlas-info-menu" aria-label="Informações do site">
          <InformationDialog
            sourceDate={index ? formatSourceDate(index.sourceDate) : undefined}
            biomeSourceUrl={biomeCatalog?.sourceUrl}
            biomeScale={biomeCatalog?.scale}
          />
        </section>

        <footer className="atlas-footer">
          <p>
            Fonte: SALVE/ICMBio{index ? `, base de ${formatSourceDate(index.sourceDate)}` : ""}. Pontos coincidentes por espécie são consolidados. A ausência de registros não indica ausência biológica.
          </p>
        </footer>
      </aside>

      <section className="atlas-map-region" aria-label="Mapa de distribuição e recorte geográfico">
        <div ref={mapContainerRef} className="atlas-map" />
        <div className="atlas-map-layer-control">
          <Button
            type="button"
            variant="outline"
            className={`atlas-map-tool-button atlas-biome-layer-button${biomeLayerVisible ? " is-active" : ""}`}
            onClick={() => void toggleBiomeLayer()}
            disabled={!biomeCatalog || biomeCatalogError || biomeLayerStatus === "loading"}
            aria-pressed={biomeLayerVisible}
            aria-label={`${biomeLayerVisible ? "Ocultar" : "Mostrar"} delimitações dos biomas`}
          >
            {biomeLayerStatus === "loading" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Layers3 aria-hidden="true" />
            )}
            <span>{biomeLayerStatus === "loading" ? "Carregando…" : "Biomas"}</span>
          </Button>
          {biomeLayerStatus === "error" && (
            <span className="atlas-biome-layer-error" role="alert">
              Não foi possível carregar. Tente novamente.
            </span>
          )}
          {biomeLayerVisible && biomeCatalog && (
            <div className="atlas-biome-map-legend" aria-label="Legenda dos biomas">
              <strong>Biomas</strong>
              <ul>
                {biomeCatalog.biomes.map((biome) => (
                  <li key={biome.id}>
                    <i
                      style={{ backgroundColor: biomeColors[biome.id] }}
                      aria-hidden="true"
                    />
                    <span>{biome.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {!mapReady && (
          <div className="atlas-map-loading" role="status">
            <LoaderCircle className="animate-spin" /> Carregando mapa…
          </div>
        )}
        {mapReady &&
          visibleSelectedCount === 0 &&
          !analysisArea &&
          !biomeLayerVisible && (
          <div className="atlas-map-empty" aria-hidden="true">
            <span className="atlas-map-crosshair" />
            <strong>Mapa pronto</strong>
            <span>Busque uma espécie, selecione um bioma ou insira uma área em KMZ.</span>
          </div>
          )}
      </section>

      <aside className="atlas-species-panel" aria-label="Espécies adicionadas ao mapa">
        <section className="atlas-selection" aria-labelledby="selected-species-heading">
          <div className="atlas-selection-heading">
            <div className="atlas-section-label">
              <Layers3 aria-hidden="true" />
              <h2 id="selected-species-heading">Espécies no mapa</h2>
              {selected.length > 0 && <span className="atlas-count-pill">{selected.length}</span>}
            </div>
            {selected.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearSelection} className="atlas-clear-button">
                <RotateCcw /> Limpar
              </Button>
            )}
          </div>

          {selected.length === 0 ? (
            <div className="atlas-empty-list">
              <span className="atlas-empty-symbol" aria-hidden="true" />
              <p>As espécies adicionadas pela busca aparecerão aqui.</p>
            </div>
          ) : (
            <div className="atlas-species-list">
              {groupedSelectedSpecies.map(({ group, species: groupSpecies }) => {
                const groupIds = groupSpecies.map((species) => species.id);
                const groupHidden = groupIds.every((speciesId) =>
                  hiddenSpeciesIds.has(speciesId),
                );
                return (
                  <section
                    className={`atlas-selected-group${groupHidden ? " is-hidden" : ""}`}
                    key={group}
                    aria-label={`${group} adicionados ao mapa`}
                  >
                    <div className="atlas-species-group-heading atlas-selected-group-heading">
                      <div className="atlas-species-group-label">
                        <strong>{group}</strong>
                        <span>{formatNumber(groupSpecies.length)}</span>
                      </div>
                      <div
                        className="atlas-group-visibility-actions"
                        role="group"
                        aria-label={`Controles de visibilidade do grupo ${group}`}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="atlas-group-visibility-button"
                          onClick={() =>
                            setSpeciesGroupVisibility(groupIds, groupHidden)
                          }
                          aria-label={`${groupHidden ? "Ativar" : "Desativar"} a visibilidade do grupo ${group}`}
                          title={`${groupHidden ? "Mostrar" : "Ocultar"} grupo ${group}`}
                        >
                          {groupHidden ? <EyeOff /> : <Eye />}
                          <span>{groupHidden ? "Exibir" : "Ocultar"}</span>
                        </Button>
                      </div>
                    </div>
                    <div className="atlas-selected-group-items">
                      {groupSpecies.map((species) => {
                        const hidden = hiddenSpeciesIds.has(species.id);
                        return (
                          <article
                            className={`atlas-species-card${hidden ? " is-hidden" : ""}`}
                            key={species.id}
                          >
                            <span
                              className="atlas-legend-dot"
                              style={{ background: species.color }}
                              aria-hidden="true"
                            />
                            <div className="atlas-species-card-copy">
                              <h3 title={species.name}>{species.name}</h3>
                              {species.status === "loading" && (
                                <span className="atlas-status"><LoaderCircle className="animate-spin" /> Carregando pontos…</span>
                              )}
                              {species.status === "error" && (
                                <span className="atlas-status atlas-status-error">Falha ao carregar os pontos.</span>
                              )}
                              {species.status === "ready" && (
                                <span>
                                  {formatNumber(species.coordinateCount)} pontos · {formatNumber(species.recordCount)} registros
                                </span>
                              )}
                            </div>
                            <div className="atlas-species-card-actions">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="atlas-species-visibility-button"
                                onClick={() => toggleSpeciesVisibility(species.id)}
                                aria-label={`${hidden ? "Exibir" : "Ocultar"} ${species.name} no mapa`}
                                title={`${hidden ? "Exibir" : "Ocultar"} no mapa`}
                              >
                                {hidden ? <EyeOff /> : <Eye />}
                                <span>{hidden ? "Exibir" : "Ocultar"}</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="atlas-remove-button"
                                onClick={() => removeSpecies(species.id)}
                                aria-label={`Remover ${species.name} do mapa`}
                                title="Remover do mapa"
                              >
                                <X />
                              </Button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>
        {selected.length > 0 && (
          <footer className="atlas-species-footer">
            <p className="atlas-selected-total">
              Exibindo <strong>{formatNumber(totalSelectedCoordinates)}</strong> pontos de {formatNumber(totalSelectedRecords)} registros.
            </p>
          </footer>
        )}
      </aside>
    </main>
  );
}
