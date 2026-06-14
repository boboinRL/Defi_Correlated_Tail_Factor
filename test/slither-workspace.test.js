import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../scripts/run-slither-audit.js", import.meta.url), "utf8");

test("Slither uses a unique workspace and does not delete a shared directory before scanning", () => {
  assert.match(source, /scanRunId\s*=\s*`\$\{safeBundleId\}-\$\{process\.pid\}-\$\{Date\.now\(\)\}`/);
  const setup = source.slice(source.indexOf("const scanRunId"), source.indexOf("for (const [sourcePath"));
  assert.doesNotMatch(setup, /rmSync/);
  assert.match(setup, /mkdirSync\(scanWorkspace/);
});
