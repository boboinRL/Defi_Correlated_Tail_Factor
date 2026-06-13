import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IMPACT_SCORE = { High: 40, Medium: 24, Low: 12, Informational: 3, Optimization: 1 };
const CONFIDENCE_SCORE = { High: 18, Medium: 10, Low: 4 };
const BENIGN_PATTERNS = {
  "arbitrary-send-erc20": /safeTransferFrom\((?:params\.)?(user|liquidator|receiverAddress)/i,
  "incorrect-equality": /(timestamp\s*==\s*block\.timestamp|exp\s*==\s*0)/i,
  "uninitialized-local": /\bvars\b.*local variable never initialized/i,
  "unused-return": /ignores return value/i,
  "naming-convention": /.*/i,
  "too-many-digits": /.*/i,
  "constable-states": /.*/i,
  "unused-state": /__DEPRECATED_/i
};

export function buildDeterministicAuditReport({ evidence, slither, profile = {} }) {
  const sources = evidence.rawEvidence?.sources || {};
  const prioritized = (slither.findings || [])
    .map((finding) => enrichFinding(finding, sources))
    .sort((left, right) => right.priorityScore - left.priorityScore);
  const clusters = clusterFindings(prioritized);
  const reviewQueue = clusters
    .filter((cluster) => cluster.maxImpact !== "Informational" && cluster.maxImpact !== "Optimization")
    .slice(0, 24);
  const confirmed = reviewQueue.filter((cluster) => cluster.deterministicVerdict === "credible-candidate").length;
  const likelyBenign = reviewQueue.filter((cluster) => cluster.deterministicVerdict === "likely-benign-pattern").length;
  const generatedAt = new Date();
  const report = {
    schemaVersion: "contract-audit-agent-v0.2.0",
    reportId: `audit-${evidence.chainId}-${evidence.address.slice(2, 10)}-${fileStamp(generatedAt)}`,
    generatedAt: generatedAt.toISOString(),
    chainId: evidence.chainId,
    address: evidence.address,
    contract: {
      name: profile.name || evidence.sources?.[0]?.contractName || "Smart Contract",
      protocol: profile.protocol || "Unknown protocol",
      category: profile.category || "Smart contract",
      sourceTarget: slither.sourceTarget
    },
    evidence: {
      bundleId: evidence.bundleId,
      evidenceHash: evidence.evidenceHash,
      slitherReportId: slither.reportId,
      sourceFiles: evidence.sourceFiles?.length || 0,
      compiler: slither.tool?.compiler || "",
      analyzer: `${slither.tool?.name || "Slither"} ${slither.tool?.version || ""}`.trim()
    },
    status: "deterministic-review-completed",
    executiveRisk: riskBand(reviewQueue),
    summary: {
      rawFindings: slither.summary?.total || prioritized.length,
      findingClusters: clusters.length,
      reviewQueue: reviewQueue.length,
      credibleCandidates: confirmed,
      likelyBenignPatterns: likelyBenign,
      manualReviewRequired: reviewQueue.filter((cluster) => cluster.deterministicVerdict === "needs-manual-review").length
    },
    factorExposure: summarizeFactors(reviewQueue),
    attackPaths: reviewQueue.slice(0, 10).map(toAttackPath),
    reviewQueue,
    methodology: [
      "Verified source and proxy evidence are hashed before analysis.",
      "Slither findings are clustered by detector and source location to reduce duplicate noise.",
      "Priority combines detector impact, confidence, economic-path keywords, and tail-risk mapping.",
      "Known framework patterns are downgraded, never silently removed.",
      "AI review may classify supplied evidence but cannot change source locations or tool output."
    ],
    limitations: [
      "A credible candidate is not a confirmed exploitable vulnerability.",
      "Dynamic execution, fork tests, symbolic execution, and economic loss simulation remain separate validation stages.",
      "Source verification and compiler settings determine static-analysis completeness."
    ]
  };
  report.reportHash = sha256(JSON.stringify(report));
  return report;
}

export function persistAuditReport(root, report) {
  const output = join(root, "data", "generated", "agent-reports");
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, `${report.reportId}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(output, `${report.chainId}-${report.address}-latest.json`), JSON.stringify(report, null, 2));
}

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function enrichFinding(finding, sources) {
  const source = sources[finding.location?.file] || "";
  const line = Number(finding.location?.line || 1);
  const excerpt = sourceExcerpt(source, line, 4);
  const text = `${finding.detector} ${finding.description} ${excerpt.text}`;
  const benignPattern = BENIGN_PATTERNS[finding.detector];
  const likelyBenign = Boolean(benignPattern?.test(text));
  const economic = /(liquidat|borrow|repay|supply|flash.?loan|price|oracle|transfer|withdraw|reserve|collateral)/i.test(text);
  const privileged = /(admin|owner|upgrade|initialize|governance|delegatecall|selfdestruct)/i.test(text);
  const priorityScore = Math.min(100,
    (IMPACT_SCORE[finding.impact] || 0) +
    (CONFIDENCE_SCORE[finding.confidence] || 0) +
    (economic ? 16 : 0) +
    (privileged ? 12 : 0) +
    ((finding.riskFactors || []).length ? 8 : 0) -
    (likelyBenign ? 24 : 0)
  );
  return {
    ...finding,
    priorityScore,
    deterministicVerdict: likelyBenign
      ? "likely-benign-pattern"
      : priorityScore >= 64
        ? "credible-candidate"
        : "needs-manual-review",
    evidenceExcerpt: excerpt,
    economicPath: economic,
    privilegedPath: privileged
  };
}

function clusterFindings(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = `${finding.detector}:${finding.location?.file || "unknown"}:${Math.floor((finding.location?.line || 0) / 25)}`;
    const current = groups.get(key) || [];
    current.push(finding);
    groups.set(key, current);
  }
  return [...groups.entries()].map(([clusterId, items]) => {
    const representative = items[0];
    return {
      clusterId,
      title: representative.title,
      detector: representative.detector,
      maxImpact: highestImpact(items.map((item) => item.impact)),
      confidence: representative.confidence,
      occurrenceCount: items.length,
      priorityScore: Math.max(...items.map((item) => item.priorityScore)),
      deterministicVerdict: strongestVerdict(items.map((item) => item.deterministicVerdict)),
      riskFactors: [...new Set(items.flatMap((item) => item.riskFactors || []))],
      location: representative.location,
      description: representative.description,
      evidenceExcerpt: representative.evidenceExcerpt,
      remediation: representative.remediation,
      economicPath: items.some((item) => item.economicPath),
      privilegedPath: items.some((item) => item.privilegedPath),
      findingIds: items.map((item) => item.id)
    };
  }).sort((left, right) => right.priorityScore - left.priorityScore);
}

function toAttackPath(cluster) {
  const functionMatch = cluster.description.match(/^([A-Za-z0-9_.$]+)\(/);
  const sinkMatch = cluster.description.match(/(?:uses|by)\s+(.+?)(?:\s+\(|$)/i);
  return {
    id: cluster.clusterId,
    severity: cluster.maxImpact,
    confidence: cluster.confidence,
    verdict: cluster.deterministicVerdict,
    entryPoint: functionMatch?.[1] || "Source-level entry point requires manual tracing",
    sink: sinkMatch?.[1]?.slice(0, 180) || cluster.detector,
    steps: [
      `Enter ${functionMatch?.[1] || cluster.location?.file || "the reported path"}.`,
      cluster.economicPath ? "Reach an economically sensitive state transition or asset flow." : "Reach the detector-reported state transition.",
      cluster.privilegedPath ? "Evaluate the authorization and upgrade boundary." : `Evaluate the ${cluster.detector} sink and its preconditions.`
    ],
    source: cluster.location,
    riskFactors: cluster.riskFactors
  };
}

function sourceExcerpt(source, line, radius) {
  if (!source) return { startLine: line, endLine: line, text: "" };
  const lines = source.split(/\r?\n/);
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);
  return {
    startLine: start,
    endLine: end,
    text: lines.slice(start - 1, end).map((value, index) => `${start + index}: ${value}`).join("\n")
  };
}

function summarizeFactors(clusters) {
  const counts = {};
  for (const cluster of clusters) {
    for (const factor of cluster.riskFactors) {
      counts[factor] = (counts[factor] || 0) + cluster.occurrenceCount;
    }
  }
  return Object.entries(counts)
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => right.count - left.count);
}

function riskBand(queue) {
  const credibleHigh = queue.filter((item) => item.maxImpact === "High" && item.deterministicVerdict === "credible-candidate").length;
  const credibleMedium = queue.filter((item) => item.maxImpact === "Medium" && item.deterministicVerdict === "credible-candidate").length;
  if (credibleHigh >= 2) return "elevated-review";
  if (credibleHigh || credibleMedium >= 3) return "focused-review";
  return "routine-review";
}

function highestImpact(values) {
  const order = ["High", "Medium", "Low", "Informational", "Optimization"];
  return order.find((impact) => values.includes(impact)) || "Informational";
}

function strongestVerdict(values) {
  if (values.includes("credible-candidate")) return "credible-candidate";
  if (values.includes("needs-manual-review")) return "needs-manual-review";
  return "likely-benign-pattern";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
