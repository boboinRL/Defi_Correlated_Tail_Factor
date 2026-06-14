import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const frontend = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("CoinGecko Demo keys use the public root URL and demo header", () => {
  assert.match(server, /COINGECKO_API_PLAN\s*\|\|\s*"demo"/);
  assert.match(server, /usePro\s*\?\s*"https:\/\/pro-api\.coingecko\.com\/api\/v3"\s*:\s*"https:\/\/api\.coingecko\.com\/api\/v3"/);
  assert.match(server, /"x-cg-demo-api-key":\s*coingeckoKey/);
  assert.match(server, /\[\.\.\.new Set\(warnings\)\]/);
});

test("market warning text is escaped before rendering", () => {
  assert.match(frontend, /map\(\(warning\) => escapeHtml\(warning\)\)/);
});
