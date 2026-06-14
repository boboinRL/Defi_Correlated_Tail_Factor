import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoot = join(projectRoot, "data", "generated");
const auditsRoot = join(generatedRoot, "audits");
const workspaceRoot = process.env.SLITHER_WORKSPACE_ROOT || join(tmpdir(), "defi-tail-slither-workspaces");
const resultsRoot = join(generatedRoot, "slither-results");
const chainId = String(process.argv[2] || process.env.AUDIT_CHAIN_ID || "1");
const address = String(process.argv[3] || process.env.AUDIT_ADDRESS || "").toLowerCase();

if (!/^0x[a-f0-9]{40}$/.test(address)) {
  throw new Error("Usage: node scripts/run-slither-audit.js <chainId> <contractAddress>");
}

const evidencePath = join(auditsRoot, `${chainId}-${address}-latest.json`);
if (!existsSync(evidencePath)) {
  throw new Error(`Reconnaissance evidence not found: ${evidencePath}`);
}

const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const sources = evidence.rawEvidence?.sources || {};
const sourceEntries = Object.entries(sources);
if (!sourceEntries.length) {
  throw new Error("Verified Solidity source is required before running Slither.");
}

const safeBundleId = String(evidence.bundleId || `${chainId}-${address}`).replace(/[^a-zA-Z0-9._-]/g, "_");
const scanRunId = `${safeBundleId}-${process.pid}-${Date.now()}`;
const scanWorkspace = join(workspaceRoot, scanRunId);
mkdirSync(scanWorkspace, { recursive: true });

for (const [sourcePath, sourceText] of sourceEntries) {
  const safePath = normalize(sourcePath).replace(/^([/\\])+/, "");
  const destination = resolve(scanWorkspace, safePath);
  if (relative(scanWorkspace, destination).startsWith(`..${sep}`)) {
    throw new Error(`Unsafe source path in evidence: ${sourcePath}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, String(sourceText), "utf8");
}
materializeImportAliases(sourceEntries, scanWorkspace);

const contractName = evidence.sources?.find((source) => source.role === evidence.primarySourceRole)?.contractName
  || evidence.sources?.[0]?.contractName
  || "";
const preferredSource = sourceEntries.find(([path, text]) =>
  basename(path, ".sol") === contractName || new RegExp(`\\b(contract|library)\\s+${escapeRegex(contractName)}\\b`).test(text)
)?.[0] || sourceEntries.find(([path]) => path.endsWith(".sol"))?.[0];
if (!preferredSource) throw new Error("No Solidity compilation target was found in the evidence bundle.");

mkdirSync(resultsRoot, { recursive: true });
const rawResultPath = join(resultsRoot, `${scanRunId}-raw.json`);
const slitherPath = process.env.SLITHER_PATH || join(projectRoot, ".venv-audit", "Scripts", "slither.exe");
const solcPath = process.env.SOLC_PATH || join(projectRoot, ".venv-audit", "Scripts", "solc.exe");
if (!existsSync(slitherPath)) throw new Error(`Slither executable not found: ${slitherPath}`);
if (!existsSync(solcPath)) throw new Error(`Solidity compiler not found: ${solcPath}`);

let commandError = "";
try {
  const remappings = deriveRemappings(sourceEntries, scanWorkspace);
  const slitherArgs = [join(scanWorkspace, preferredSource), "--solc", solcPath];
  if (remappings.length) slitherArgs.push("--solc-remaps", remappings.join(" "));
  slitherArgs.push("--json", rawResultPath);
  execFileSync(slitherPath, slitherArgs, {
    cwd: scanWorkspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: Number(process.env.SLITHER_TIMEOUT_MS || 180000)
  });
} catch (error) {
  commandError = String(error.stderr || error.message || error);
  if (!existsSync(rawResultPath)) throw new Error(`Slither compilation failed: ${commandError.slice(0, 1200)}`);
}

const raw = JSON.parse(readFileSync(rawResultPath, "utf8"));
const detectors = raw.results?.detectors || [];
const findings = detectors.map((detector, index) => normalizeFinding(detector, index, scanWorkspace));
const severityOrder = { High: 0, Medium: 1, Low: 2, Informational: 3, Optimization: 4 };
findings.sort((a, b) => (severityOrder[a.impact] ?? 5) - (severityOrder[b.impact] ?? 5));

const generatedAt = new Date();
const report = {
  schemaVersion: "slither-audit-v0.1.0",
  reportId: `slither-${chainId}-${address.slice(2, 10)}-${fileStamp(generatedAt)}`,
  generatedAt: generatedAt.toISOString(),
  chainId: Number(chainId),
  address,
  evidenceBundleId: evidence.bundleId,
  evidenceHash: evidence.evidenceHash,
  sourceTarget: preferredSource,
  status: raw.success === false ? "completed-with-tool-errors" : "completed",
  classification: "candidate-findings",
  summary: {
    total: findings.length,
    high: findings.filter((finding) => finding.impact === "High").length,
    medium: findings.filter((finding) => finding.impact === "Medium").length,
    low: findings.filter((finding) => finding.impact === "Low").length,
    informational: findings.filter((finding) => finding.impact === "Informational").length
  },
  factorCounts: countFactors(findings),
  findings,
  tool: {
    name: "Slither",
    version: commandVersion(slitherPath, ["--version"]),
    compiler: commandVersion(solcPath, ["--version"]).split(/\r?\n/).at(-1),
    commandWarning: commandError.slice(0, 2000)
  },
  limitations: [
    "Static-analysis findings are candidates and require manual validation.",
    "This phase does not yet prove exploitability or calculate financial impact.",
    "Risk-factor mappings are deterministic taxonomy links, not probability estimates."
  ]
};

writeFileSync(join(resultsRoot, `${report.reportId}.json`), JSON.stringify(report, null, 2));
writeFileSync(join(resultsRoot, `${chainId}-${address}-latest.json`), JSON.stringify(report, null, 2));
try {
  rmSync(scanWorkspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
} catch {
  // Windows scanners can briefly retain file handles; stale temp workspaces are harmless.
}
process.stdout.write(`${JSON.stringify(report)}\n`);

function normalizeFinding(detector, index, root) {
  const firstMapping = detector.elements?.flatMap((element) => element.source_mapping ? [element.source_mapping] : [])[0] || {};
  const filename = firstMapping.filename_relative || firstMapping.filename_short || "";
  const line = firstMapping.lines?.[0] || null;
  const check = detector.check || `slither-finding-${index + 1}`;
  const description = String(detector.description || detector.markdown || check).trim();
  return {
    id: `${check}-${index + 1}`,
    detector: check,
    impact: detector.impact || "Informational",
    confidence: detector.confidence || "Unknown",
    title: humanize(check),
    description,
    location: {
      file: filename ? relative(root, resolve(root, filename)).replaceAll("\\", "/") : "",
      line
    },
    riskFactors: mapRiskFactors(`${check} ${description}`),
    remediation: remediationFor(check)
  };
}

function mapRiskFactors(text) {
  const value = text.toLowerCase();
  const factors = new Set();
  if (/reentr|external call|unchecked.*transfer|arbitrary-send|token/.test(value)) factors.add("dex-liquidity");
  if (/oracle|price|spot|twap/.test(value)) factors.add("oracle");
  if (/access|owner|admin|upgrade|delegatecall|selfdestruct|suicid/.test(value)) factors.add("governance");
  if (/dos|gas|loop|calls-loop|costly/.test(value)) factors.add("gas");
  if (/dos|gas|loop|timestamp|block/.test(value)) factors.add("keeper");
  if (/front.?run|sandwich|order|external call/.test(value)) factors.add("mev");
  if (/divide|precision|round|overflow|underflow|arithmetic/.test(value)) factors.add("volatility");
  return [...factors];
}

function remediationFor(check) {
  const value = check.toLowerCase();
  if (value.includes("reentr")) return "Validate call ordering, add reentrancy protection where state can be re-entered, and test adversarial callbacks.";
  if (value.includes("access") || value.includes("suicid")) return "Confirm authorization on every privileged path and document the governance or multisig control boundary.";
  if (value.includes("unchecked")) return "Handle return values explicitly and revert on failed external token or low-level calls.";
  if (value.includes("loop") || value.includes("dos")) return "Bound iteration and external-call fanout, then test execution under congested gas conditions.";
  return "Review the reported path against protocol invariants and add a focused regression test before classifying exploitability.";
}

function countFactors(findings) {
  const counts = {};
  for (const finding of findings) {
    for (const factor of finding.riskFactors) counts[factor] = (counts[factor] || 0) + 1;
  }
  return counts;
}

function deriveRemappings(entries, root) {
  const sourcePaths = entries.map(([path]) => path.replaceAll("\\", "/"));
  const imports = new Set();
  for (const [, source] of entries) {
    for (const match of String(source).matchAll(/import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith(".") && !match[1].startsWith("/")) imports.add(match[1]);
    }
  }
  const mappings = new Map();
  for (const importPath of imports) {
    const prefix = `${importPath.split("/")[0]}/`;
    if (mappings.has(prefix)) continue;
    const matchingSource = sourcePaths.find((sourcePath) => sourcePath.endsWith(importPath));
    if (!matchingSource) continue;
    mappings.set(prefix, `${prefix}=${join(root, prefix).replaceAll("\\", "/")}`);
  }
  return [...mappings.values()];
}

function materializeImportAliases(entries, root) {
  const sourceMap = new Map(entries.map(([path, source]) => [path.replaceAll("\\", "/"), String(source)]));
  const packageRoots = new Map();
  for (const [, source] of entries) {
    for (const match of String(source).matchAll(/import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g)) {
      const importPath = match[1];
      if (importPath.startsWith(".") || importPath.startsWith("/")) continue;
      const matchingSource = [...sourceMap.entries()].find(([path]) => path.endsWith(importPath));
      if (!matchingSource) continue;
      const prefix = `${importPath.split("/")[0]}/`;
      packageRoots.set(prefix, matchingSource[0].slice(0, matchingSource[0].length - importPath.length));
    }
  }
  for (const [prefix, packageRoot] of packageRoots) {
    for (const [sourcePath, source] of sourceMap) {
      if (!sourcePath.startsWith(`${packageRoot}${prefix}`)) continue;
      const aliasPath = sourcePath.slice(packageRoot.length);
      const destination = join(root, aliasPath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, source, "utf8");
    }
  }
}

function commandVersion(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", timeout: 10000 }).trim();
  } catch {
    return "unknown";
  }
}

function humanize(value) {
  return value.split("-").map((part) => part ? part[0].toUpperCase() + part.slice(1) : "").join(" ");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fileStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
