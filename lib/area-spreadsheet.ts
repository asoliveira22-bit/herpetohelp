import { gunzipSync, strFromU8, strToU8, zipSync } from "fflate";

export type SpreadsheetSpecies = {
  id: string;
  name: string;
  group: string;
  family: string;
};

export type AreaSpreadsheetResult = {
  species: SpreadsheetSpecies;
  coordinateCount: number;
  recordCount: number;
  points: Array<[longitude: number, latitude: number, records: number]>;
};

type RawOccurrenceTuple = [
  longitudeSirgas2000: number,
  latitudeSirgas2000: number,
  latitudeOriginal: number,
  longitudeOriginal: number,
  datumOriginal: string,
  coordinatePrecision: string,
  bibliographicReference: string,
  database: string,
  originId: string,
  voucher: string,
  voucherInstitution: string,
];

export type AreaOccurrenceDetail = {
  group: string;
  family: string;
  species: string;
  latitudeSirgas2000: number;
  longitudeSirgas2000: number;
  latitudeOriginal: number;
  longitudeOriginal: number;
  datumOriginal: string;
  coordinatePrecision: string;
  database: string;
  bibliographicReference: string;
  originId: string;
  voucher: string;
  voucherInstitution: string;
};

type FetchResponse = {
  ok: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type Fetcher = (input: string) => Promise<FetchResponse>;

const NOT_REPORTED = "Não informado";
const MAX_PARALLEL_FETCHES = 8;

function coordinateKey(longitude: number, latitude: number) {
  return `${longitude.toFixed(8)}|${latitude.toFixed(8)}`;
}

function reported(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
  return !trimmed || normalized === "nao informado" ? NOT_REPORTED : trimmed;
}

function isOccurrenceTuple(value: unknown): value is RawOccurrenceTuple {
  return (
    Array.isArray(value) &&
    value.length === 11 &&
    value.slice(0, 4).every((item) => typeof item === "number" && Number.isFinite(item)) &&
    value.slice(4).every((item) => typeof item === "string")
  );
}

export function parseOccurrenceDetails(payload: Uint8Array) {
  const isGzip = payload[0] === 0x1f && payload[1] === 0x8b;
  const json = strFromU8(isGzip ? gunzipSync(payload) : payload);
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every(isOccurrenceTuple)) {
    throw new Error("Os registros-fonte do SALVE estão em um formato inesperado.");
  }
  return parsed;
}

async function loadSpeciesOccurrenceDetails(
  result: AreaSpreadsheetResult,
  fetcher: Fetcher,
) {
  const response = await fetcher(`/data/occurrences/${result.species.id}.bin`);
  if (!response.ok) {
    throw new Error(`Não foi possível carregar as fontes de ${result.species.name}.`);
  }
  const payload = new Uint8Array(await response.arrayBuffer());
  const occurrences = parseOccurrenceDetails(payload);
  const includedCoordinates = new Set(
    result.points.map(([longitude, latitude]) => coordinateKey(longitude, latitude)),
  );
  const selected = occurrences.filter(([longitude, latitude]) =>
    includedCoordinates.has(coordinateKey(longitude, latitude)),
  );
  if (selected.length !== result.recordCount) {
    throw new Error(
      `A conferência dos registros-fonte de ${result.species.name} não corresponde ao recorte do mapa.`,
    );
  }
  return selected.map(
    ([
      longitudeSirgas2000,
      latitudeSirgas2000,
      latitudeOriginal,
      longitudeOriginal,
      datumOriginal,
      coordinatePrecision,
      bibliographicReference,
      database,
      originId,
      voucher,
      voucherInstitution,
    ]): AreaOccurrenceDetail => ({
      group: result.species.group,
      family: result.species.family,
      species: result.species.name,
      latitudeSirgas2000,
      longitudeSirgas2000,
      latitudeOriginal,
      longitudeOriginal,
      datumOriginal: reported(datumOriginal),
      coordinatePrecision: reported(coordinatePrecision),
      database: reported(database),
      bibliographicReference: reported(bibliographicReference),
      originId: reported(originId),
      voucher: reported(voucher),
      voucherInstitution: reported(voucherInstitution),
    }),
  );
}

export async function loadAreaOccurrenceDetails(
  results: AreaSpreadsheetResult[],
  fetcher: Fetcher = fetch,
) {
  const perSpecies = new Array<AreaOccurrenceDetail[]>(results.length);
  let nextIndex = 0;
  const workerCount = Math.min(MAX_PARALLEL_FETCHES, results.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < results.length) {
        const currentIndex = nextIndex++;
        perSpecies[currentIndex] = await loadSpeciesOccurrenceDetails(
          results[currentIndex],
          fetcher,
        );
      }
    }),
  );
  return perSpecies.flat();
}

type CellValue = string | number;

type SheetDefinition = {
  name: string;
  headers: string[];
  rows: CellValue[][];
  widths: number[];
  numericStyles: Record<number, number>;
  columnStyles?: Record<number, number>;
  rowHeight?: number;
};

function cleanXmlText(value: string) {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

function escapeXml(value: string) {
  return cleanXmlText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellXml(value: CellValue, row: number, column: number, style: number) {
  const reference = `${columnName(column)}${row}`;
  if (typeof value === "number") {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function worksheetXml(sheet: SheetDefinition) {
  const lastColumn = columnName(sheet.headers.length - 1);
  const lastRow = sheet.rows.length + 1;
  const columns = sheet.widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  const header = sheet.headers
    .map((value, column) => cellXml(value, 1, column, 1))
    .join("");
  const rows = sheet.rows
    .map((values, index) => {
      const row = index + 2;
      const cells = values
        .map((value, column) =>
          cellXml(
            value,
            row,
            column,
            sheet.numericStyles[column] ?? sheet.columnStyles?.[column] ?? 4,
          ),
        )
        .join("");
      const height = sheet.rowHeight
        ? ` ht="${sheet.rowHeight}" customHeight="1"`
        : "";
      return `<row r="${row}"${height}>${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData><row r="1" ht="30" customHeight="1">${header}</row>${rows}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
  <pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
</worksheet>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="0.00000000"/></numFmts>
  <fonts count="2">
    <font><sz val="11"/><color theme="1"/><name val="Aptos"/><family val="2"/><scheme val="minor"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F766E"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FF0B5B55"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

export function createAreaSpreadsheet(
  results: AreaSpreadsheetResult[],
  details: AreaOccurrenceDetail[],
) {
  const summarySheet: SheetDefinition = {
    name: "Resumo por espécie",
    headers: [
      "Grupo",
      "Família",
      "Espécie",
      "Pontos dentro da área",
      "Registros dentro da área",
    ],
    rows: results.map((result) => [
      result.species.group,
      result.species.family,
      result.species.name,
      result.coordinateCount,
      result.recordCount,
    ]),
    widths: [14, 24, 34, 22, 25],
    numericStyles: { 3: 3, 4: 3 },
  };
  const detailsSheet: SheetDefinition = {
    name: "Registros e fontes",
    headers: [
      "Grupo",
      "Família",
      "Espécie",
      "Latitude no mapa (SIRGAS 2000)",
      "Longitude no mapa (SIRGAS 2000)",
      "Latitude original",
      "Longitude original",
      "Datum original",
      "Precisão da coordenada",
      "Base de dados",
      "Referência bibliográfica",
      "ID na origem",
      "Tombamento",
      "Instituição de tombamento",
    ],
    rows: details.map((detail) => [
      detail.group,
      detail.family,
      detail.species,
      detail.latitudeSirgas2000,
      detail.longitudeSirgas2000,
      detail.latitudeOriginal,
      detail.longitudeOriginal,
      detail.datumOriginal,
      detail.coordinatePrecision,
      detail.database,
      detail.bibliographicReference,
      detail.originId,
      detail.voucher,
      detail.voucherInstitution,
    ]),
    widths: [14, 24, 34, 22, 22, 18, 18, 18, 22, 22, 70, 22, 22, 34],
    numericStyles: { 3: 2, 4: 2, 5: 2, 6: 2 },
    columnStyles: { 10: 5 },
    rowHeight: 42,
  };
  const sheets = [summarySheet, detailsSheet];
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView/></bookViews>
  <sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
  <calcPr calcId="191029"/>
</workbook>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const coreProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Espécies e registros do SALVE dentro da área</dc:title>
  <dc:creator>SALVE/ICMBio</dc:creator>
  <cp:lastModifiedBy>Distribuição da herpetofauna</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>`;
  const appProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Distribuição da herpetofauna</Application>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Planilhas</vt:lpstr></vt:variant><vt:variant><vt:i4>2</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="2" baseType="lpstr"><vt:lpstr>Resumo por espécie</vt:lpstr><vt:lpstr>Registros e fontes</vt:lpstr></vt:vector></TitlesOfParts>
</Properties>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rootRelationships),
      "docProps/app.xml": strToU8(appProperties),
      "docProps/core.xml": strToU8(coreProperties),
      "xl/workbook.xml": strToU8(workbookXml),
      "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships),
      "xl/styles.xml": strToU8(stylesXml),
      "xl/worksheets/sheet1.xml": strToU8(worksheetXml(summarySheet)),
      "xl/worksheets/sheet2.xml": strToU8(worksheetXml(detailsSheet)),
    },
    { level: 6 },
  );
}
