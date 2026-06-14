import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("full audit report cannot expand the dashboard horizontally", () => {
  assert.match(css, /body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.content,[\s\S]*?\.audit-candidate,[\s\S]*?\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.full-audit-report\s*\{[^}]*width:\s*100%[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.audit-candidate pre\s*\{[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/s);
});
