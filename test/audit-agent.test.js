import test from "node:test";
import assert from "node:assert/strict";
import { buildDeterministicAuditReport } from "../lib/audit-agent.js";

const evidence = {
  chainId: 1,
  address: "0x0000000000000000000000000000000000000001",
  bundleId: "recon-test",
  evidenceHash: "abc123",
  sourceFiles: [{ path: "Pool.sol" }],
  sources: [{ contractName: "Pool" }],
  rawEvidence: {
    sources: {
      "Pool.sol": [
        "contract Pool {",
        "  function repay(address user, uint amount) external {",
        "    token.safeTransferFrom(user, address(this), amount);",
        "  }",
        "}"
      ].join("\n")
    }
  }
};

function slitherWith(findings) {
  return {
    reportId: "slither-test",
    sourceTarget: "Pool.sol",
    summary: { total: findings.length },
    tool: { name: "Slither", version: "0.11.5", compiler: "0.8.27" },
    findings
  };
}

test("clusters nearby detector findings and preserves source evidence", () => {
  const report = buildDeterministicAuditReport({
    evidence,
    slither: slitherWith([
      finding("a-1", 2),
      finding("a-2", 3)
    ])
  });
  assert.equal(report.summary.rawFindings, 2);
  assert.equal(report.summary.findingClusters, 1);
  assert.equal(report.reviewQueue[0].occurrenceCount, 2);
  assert.match(report.reviewQueue[0].evidenceExcerpt.text, /safeTransferFrom/);
  assert.equal(report.evidence.evidenceHash, "abc123");
  assert.match(report.reportHash, /^[a-f0-9]{64}$/);
});

test("downgrades explicit user transferFrom patterns instead of hiding them", () => {
  const report = buildDeterministicAuditReport({
    evidence,
    slither: slitherWith([finding("a-1", 2)])
  });
  assert.equal(report.reviewQueue[0].deterministicVerdict, "likely-benign-pattern");
  assert.equal(report.summary.likelyBenignPatterns, 1);
});

function finding(id, line) {
  return {
    id,
    detector: "arbitrary-send-erc20",
    impact: "High",
    confidence: "High",
    title: "Arbitrary Send ERC20",
    description: "Pool.repay(address,uint256) uses arbitrary from in transferFrom: token.safeTransferFrom(user,address(this),amount)",
    location: { file: "Pool.sol", line },
    riskFactors: ["dex-liquidity"],
    remediation: "Validate the caller-controlled source address."
  };
}
