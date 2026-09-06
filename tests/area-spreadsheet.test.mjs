import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { gzipSync, strFromU8, strToU8, unzipSync } from "fflate";
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

const result = {
  species: {
    id: "species-1",
    name: "Testudo exemplaris",
    group: "Répteis",
    family: "Testudinidae",
  },
  coordinateCount: 1,
  recordCount: 1,
  points: [[-47.12345678, -15.87654321, 1]],
};

test("keeps one source row per occurrence inside the selected area", async () => {
  const { loadAreaOccurrenceDetails } = await vite.ssrLoadModule(
    "/lib/area-spreadsheet.ts",
  );
  const sourceRows = [
    [
      -47.12345678,
      -15.87654321,
      -15.8765,
      -47.1234,
      "SIRGAS 2000",
      "Exata",
      "Referência A",
      "SALVE",
      "origem-1",
      "MZ 42",
      "Museu Z",
    ],
    [
      -40,
      -10,
      -10,
      -40,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
  ];
  const compressed = gzipSync(strToU8(JSON.stringify(sourceRows)));
  const details = await loadAreaOccurrenceDetails([result], async () => ({
    ok: true,
    async arrayBuffer() {
      return compressed.buffer.slice(
        compressed.byteOffset,
        compressed.byteOffset + compressed.byteLength,
      );
    },
  }));

  assert.equal(details.length, 1);
  assert.deepEqual(details[0], {
    group: "Répteis",
    family: "Testudinidae",
    species: "Testudo exemplaris",
    latitudeSirgas2000: -15.87654321,
    longitudeSirgas2000: -47.12345678,
    latitudeOriginal: -15.8765,
    longitudeOriginal: -47.1234,
    datumOriginal: "SIRGAS 2000",
    coordinatePrecision: "Exata",
    database: "SALVE",
    bibliographicReference: "Referência A",
    originId: "origem-1",
    voucher: "MZ 42",
    voucherInstitution: "Museu Z",
  });
});

test("creates an Excel workbook with summary and occurrence-source sheets", async () => {
  const { createAreaSpreadsheet } = await vite.ssrLoadModule(
    "/lib/area-spreadsheet.ts",
  );
  const workbook = createAreaSpreadsheet([result], [
    {
      group: "Répteis",
      family: "Testudinidae",
      species: "Testudo exemplaris",
      latitudeSirgas2000: -15.87654321,
      longitudeSirgas2000: -47.12345678,
      latitudeOriginal: -15.8765,
      longitudeOriginal: -47.1234,
      datumOriginal: "SIRGAS 2000",
      coordinatePrecision: "Exata",
      database: "SALVE",
      bibliographicReference: "Referência A & B",
      originId: "origem-1",
      voucher: "MZ 42",
      voucherInstitution: "Museu Z",
    },
  ]);
  const files = unzipSync(workbook);
  const workbookXml = strFromU8(files["xl/workbook.xml"]);
  const summaryXml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const detailsXml = strFromU8(files["xl/worksheets/sheet2.xml"]);

  assert.match(workbookXml, /Resumo por espécie/);
  assert.match(workbookXml, /Registros e fontes/);
  assert.match(summaryXml, /Família/);
  assert.match(summaryXml, /Testudinidae/);
  assert.match(detailsXml, /Latitude no mapa \(SIRGAS 2000\)/);
  assert.match(detailsXml, /Referência bibliográfica/);
  assert.match(detailsXml, /Referência A &amp; B/);
  assert.match(detailsXml, /state="frozen"/);
  assert.match(detailsXml, /<autoFilter/);
});
