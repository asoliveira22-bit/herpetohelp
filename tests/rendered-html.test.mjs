import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("renders HerpetoHelp metadata and citation guidance", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>HerpetoHelp — Distribuição da Herpetofauna<\/title>/);
  assert.match(html, /href="\/herpetohelp-favicon\.png"/);
  const mapSource = await readFile(
    new URL("../components/herpetofauna-map.tsx", import.meta.url),
    "utf8",
  );
  assert.match(mapSource, /Como citar/);
  assert.match(mapSource, /Oliveira, A\. S\. 2026/);
});
