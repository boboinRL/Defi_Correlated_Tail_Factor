const riskFactors = [
  {
    id: "oracle",
    name: "Oracle Depeg / Lag",
    desc: "Price-source deviation, stale rounds, and cross-oracle spread widening",
    baseProb: 0.018
  },
  {
    id: "liquidity",
    name: "DEX Liquidity Drain",
    desc: "Depth contraction, slippage expansion, and arbitrage route failure",
    baseProb: 0.026
  },
  {
    id: "volatility",
    name: "Volatility Jump",
    desc: "Collateral gap-downs and correlated deleveraging across risk assets",
    baseProb: 0.031
  },
  {
    id: "keeper",
    name: "Keeper Congestion",
    desc: "Liquidation bot latency, failed gas bidding, and batch execution stalls",
    baseProb: 0.015
  },
  {
    id: "governance",
    name: "Governance Upgrade Risk",
    desc: "Parameter votes, proxy upgrades, and privileged action windows",
    baseProb: 0.009
  },
  {
    id: "stablecoin",
    name: "Stablecoin Depeg",
    desc: "Stablecoin price break, redemption pressure, and liquidity fragmentation",
    baseProb: 0.014
  },
  {
    id: "gas",
    name: "Gas Spike",
    desc: "Blockspace congestion, delayed liquidations, and failed keeper bids",
    baseProb: 0.02
  },
  {
    id: "mev",
    name: "MEV / OEV Capture",
    desc: "Liquidation value extraction, adverse ordering, and keeper competition",
    baseProb: 0.013
  }
];

const fallbackProfiles = [
  {
    chainId: 1,
    address: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
    name: "Aave V3 Pool",
    protocol: "Aave",
    category: "Lending pool",
    symbol: "A",
    tvl: "$4.8B",
    oracle: "Chainlink",
    coverage: "84%",
    audit: "2026-05-18",
    source: "Local fallback",
    verified: true,
    baseResilience: 86,
    liquidityDepth: 0.82,
    keeperQuality: 0.78,
    governanceExposure: 0.22,
    insuranceBuffer: 0.74,
    riskFactorIds: ["oracle", "liquidity", "volatility", "keeper", "governance"]
  }
];

const els = {
  searchForm: document.querySelector("#contractSearchForm"),
  searchInput: document.querySelector("#contractSearchInput"),
  searchStatus: document.querySelector("#searchStatus"),
  searchResults: document.querySelector("#searchResults"),
  contract: document.querySelector("#contractSelect"),
  icon: document.querySelector("#protocolIcon"),
  name: document.querySelector("#protocolName"),
  meta: document.querySelector("#protocolMeta"),
  tvl: document.querySelector("#tvlValue"),
  oracle: document.querySelector("#oracleValue"),
  coverage: document.querySelector("#coverageValue"),
  audit: document.querySelector("#auditValue"),
  riskScore: document.querySelector("#riskScore"),
  riskGrade: document.querySelector("#riskGrade"),
  scoreRing: document.querySelector("#scoreRing"),
  narrative: document.querySelector("#riskNarrative"),
  jointProbability: document.querySelector("#jointProbability"),
  badDebt: document.querySelector("#badDebt"),
  recoveryWindow: document.querySelector("#recoveryWindow"),
  riskGrid: document.querySelector("#riskGrid"),
  severity: document.querySelector("#severityRange"),
  severityLabel: document.querySelector("#severityLabel"),
  correlation: document.querySelector("#correlationToggle"),
  keeper: document.querySelector("#keeperToggle"),
  reset: document.querySelector("#resetButton"),
  orb: document.querySelector("#probabilityOrb"),
  orbValue: document.querySelector("#orbValue"),
  scenarioTitle: document.querySelector("#scenarioTitle"),
  scenarioCopy: document.querySelector("#scenarioCopy"),
  coverageMetric: document.querySelector("#coverageMetric"),
  gapMetric: document.querySelector("#gapMetric"),
  queueMetric: document.querySelector("#queueMetric"),
  governanceMetric: document.querySelector("#governanceMetric"),
  coverageBar: document.querySelector("#coverageBar"),
  gapBar: document.querySelector("#gapBar"),
  queueBar: document.querySelector("#queueBar"),
  governanceBar: document.querySelector("#governanceBar"),
  heatmap: document.querySelector("#heatmap"),
  dependencyList: document.querySelector("#dependencyList"),
  codeScore: document.querySelector("#codeScore"),
  opsScore: document.querySelector("#opsScore"),
  marketScore: document.querySelector("#marketScore"),
  codeFindings: document.querySelector("#codeFindings"),
  opsFindings: document.querySelector("#opsFindings"),
  marketFindings: document.querySelector("#marketFindings"),
  eventTable: document.querySelector("#eventTable"),
  pathStatus: document.querySelector("#pathStatus")
};

const state = {
  profiles: [],
  selectedProfile: null,
  latestResult: null,
  requestId: 0
};

function percent(value, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function money(value) {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}B`;
  return `$${value.toFixed(1)}M`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function grade(score) {
  if (score >= 88) return "AAA";
  if (score >= 80) return "AA";
  if (score >= 70) return "A";
  if (score >= 60) return "BBB";
  return "BB";
}

function riskLevel(probability) {
  if (probability >= 0.12) return "High risk";
  if (probability >= 0.06) return "Elevated risk";
  if (probability >= 0.025) return "Moderate risk";
  return "Low risk";
}

function colorForProbability(probability) {
  if (probability >= 0.12) return "#df4558";
  if (probability >= 0.06) return "#d99218";
  if (probability >= 0.025) return "#2f6df6";
  return "#18a874";
}

function profileKey(profile) {
  return `${profile.chainId}:${profile.address.toLowerCase()}`;
}

function selectedRiskIds() {
  return [...document.querySelectorAll(".risk-option input:checked")].map((input) => input.value);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function setStatus(message, tone = "") {
  els.searchStatus.textContent = message;
  els.searchStatus.dataset.tone = tone;
}

function upsertProfiles(profiles) {
  const byKey = new Map(state.profiles.map((profile) => [profileKey(profile), profile]));
  for (const profile of profiles) byKey.set(profileKey(profile), profile);
  state.profiles = [...byKey.values()];
  if (!state.selectedProfile) state.selectedProfile = state.profiles[0];
  renderContracts();
}

function renderContracts() {
  els.contract.innerHTML = state.profiles
    .map((profile) => `<option value="${profileKey(profile)}">${profile.name}</option>`)
    .join("");
  if (state.selectedProfile) els.contract.value = profileKey(state.selectedProfile);
}

function renderRiskGrid(profile = state.selectedProfile) {
  const defaults = new Set(profile?.riskFactorIds?.length ? profile.riskFactorIds : ["oracle", "liquidity"]);
  els.riskGrid.innerHTML = riskFactors
    .map((risk) => `
      <label class="risk-option">
        <input type="checkbox" value="${risk.id}" ${defaults.has(risk.id) ? "checked" : ""}>
        <span>
          <span class="risk-name">${risk.name}</span>
          <span class="risk-desc">${risk.desc}</span>
        </span>
        <strong class="risk-weight">${percent(risk.baseProb, 1)}</strong>
      </label>
    `)
    .join("");
}

function renderSearchResults(results) {
  if (!results.length) {
    els.searchResults.innerHTML = "";
    return;
  }

  els.searchResults.innerHTML = results
    .map((profile) => `
      <article class="result-card">
        <div>
          <strong>${profile.name}</strong>
          <code>${profile.address}</code>
          <div class="result-meta">
            <span>${profile.protocol || "Unknown protocol"}</span>
            <span>${profile.category || "Smart contract"}</span>
            <span>${profile.verified ? "Verified" : "Unverified"}</span>
            <span>${profile.source || "Indexed"}</span>
          </div>
        </div>
        <button class="ghost-button" type="button" data-profile="${profileKey(profile)}">Use Contract</button>
      </article>
    `)
    .join("");
}

async function loadInitialProfiles() {
  try {
    const data = await api("/api/contracts/search");
    upsertProfiles(data.results || []);
    setStatus("Loaded local registry. Paste an Ethereum address for live metadata lookup.");
  } catch (error) {
    upsertProfiles(fallbackProfiles);
    setStatus(`API unavailable, using local fallback: ${error.message}`, "warn");
  }

  renderRiskGrid();
  await runStress();
}

async function searchContracts(query) {
  setStatus("Searching contract metadata...");
  els.searchResults.innerHTML = "";

  try {
    const data = await api(`/api/contracts/search?q=${encodeURIComponent(query)}&chainId=1`);
    const results = data.results || [];
    upsertProfiles(results);
    renderSearchResults(results);
    setStatus(results.length ? `Found ${results.length} result(s).` : data.message || "No results found.", results.length ? "" : "warn");
  } catch (error) {
    setStatus(`Search failed: ${error.message}`, "warn");
  }
}

async function runStress() {
  const profile = state.selectedProfile;
  if (!profile) return;

  const requestId = ++state.requestId;
  const severity = Number(els.severity.value) / 100;
  els.severityLabel.textContent = `${Math.round(severity * 100)}%`;

  try {
    const result = await api("/api/stress/run", {
      method: "POST",
      body: JSON.stringify({
        chainId: profile.chainId,
        address: profile.address,
        profile,
        factors: selectedRiskIds(),
        severity,
        useCorrelation: els.correlation.checked,
        simulateKeeper: els.keeper.checked
      })
    });
    if (requestId !== state.requestId) return;
    state.latestResult = result;
    renderResult(result);
  } catch (error) {
    setStatus(`Stress engine failed: ${error.message}`, "warn");
  }
}

function renderResult(result) {
  const profile = result.profile;
  const level = riskLevel(result.jointProbability);
  const probabilityColor = colorForProbability(result.jointProbability);
  const names = result.risks.map((risk) => risk.name.split(" ").slice(0, 2).join(" "));

  els.icon.textContent = profile.symbol || profile.name.slice(0, 1).toUpperCase();
  els.name.textContent = profile.name;
  els.meta.textContent = `${profile.category || "Smart contract"} / Ethereum`;
  els.tvl.textContent = profile.tvl || "Unknown";
  els.oracle.textContent = profile.oracle || "Not detected";
  els.coverage.textContent = profile.coverage || `${Math.round(result.liquidationCoverage)}%`;
  els.audit.textContent = profile.audit || "Not indexed";
  els.riskScore.textContent = result.resilienceScore;
  els.riskGrade.textContent = grade(result.resilienceScore);
  els.scoreRing.style.setProperty("--score", `${result.resilienceScore}%`);
  els.narrative.textContent = `${level}: ${
    result.resilienceScore >= 80
      ? "liquidation paths remain broadly resilient"
      : "liquidation and liquidity buffers need reinforcement"
  }. Model confidence is ${percent(result.model.confidence, 0)}.`;
  els.jointProbability.textContent = percent(result.jointProbability);
  els.badDebt.textContent = money(result.expectedBadDebtUsdM);
  els.recoveryWindow.textContent = `${result.recoveryWindowMinutes}m`;
  els.orbValue.textContent = percent(result.jointProbability);
  els.orb.style.setProperty("--score", `${clamp(result.jointProbability * 300, 4, 100)}%`);
  els.orb.style.background = `radial-gradient(circle at center, #14233b 0 56%, transparent 57%), conic-gradient(${probabilityColor} var(--score), rgba(255, 255, 255, 0.16) 0)`;
  els.scenarioTitle.textContent = names.length ? names.join(" + ") : "Baseline liquidation monitor";
  els.scenarioCopy.textContent = `${level}: the backend stress engine uses marginal probabilities plus a tail-dependence matrix for the selected factor set.`;
  els.coverageMetric.textContent = `${Math.round(result.liquidationCoverage)}%`;
  els.gapMetric.textContent = money(result.expectedBadDebtUsdM);
  els.queueMetric.textContent = `${Math.round(result.queueCongestion)}%`;
  els.governanceMetric.textContent = `${Math.round(result.governanceExposure)}%`;
  els.coverageBar.style.width = `${result.liquidationCoverage}%`;
  els.gapBar.style.width = `${clamp(result.expectedBadDebtUsdM, 5, 100)}%`;
  els.queueBar.style.width = `${result.queueCongestion}%`;
  els.governanceBar.style.width = `${result.governanceExposure}%`;
  els.codeScore.textContent = `${Math.round(clamp(result.resilienceScore + 8 - result.governanceExposure * 0.08, 38, 97))}%`;
  els.opsScore.textContent = `${Math.round(clamp(result.liquidationCoverage - result.queueCongestion * 0.12, 28, 95))}%`;
  els.marketScore.textContent = `${Math.round(clamp(96 - result.expectedBadDebtUsdM * 0.22 - result.jointProbability * 120, 25, 94))}%`;

  renderHeatmap(result);
  updateRiskProbabilities(result);
  renderDependencies(result);
  renderFindings(result);
  renderEvents(result);
}

function updateRiskProbabilities(result) {
  const byId = new Map(result.factorProbabilities.map((item) => [item.id, item]));
  document.querySelectorAll(".risk-option").forEach((option) => {
    const input = option.querySelector("input");
    const weight = option.querySelector(".risk-weight");
    const factor = byId.get(input.value);
    if (factor) {
      weight.textContent = percent(factor.marginalProbability, 1);
      weight.title = `${factor.priorSource}; ${factor.eventCount} event samples`;
    } else {
      const fallback = riskFactors.find((risk) => risk.id === input.value);
      weight.textContent = fallback ? percent(fallback.baseProb, 1) : "";
      weight.title = "Static model prior";
    }
  });
}

function renderHeatmap(result) {
  const cells = Array.from({ length: 36 }, (_, index) => {
    const horizon = 1 + Math.floor(index / 12);
    const phase = (index % 12) / 11;
    const multiplier = 0.55 + horizon * 0.36 + phase * 0.62;
    const value = clamp(result.jointProbability * multiplier, 0.002, 0.36);
    const alpha = clamp(0.18 + value * 2.1, 0.18, 0.92);
    const color = colorForProbability(value);
    return `<span class="heat-cell" title="${horizon === 1 ? "1d" : horizon === 2 ? "7d" : "30d"} ${percent(value)}" style="--cell: color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, white);"></span>`;
  });

  els.heatmap.innerHTML = cells.join("");
}

function renderDependencies(result) {
  const factorRows = result.factorProbabilities
    .map((item) => `
      <div class="dependency-item">
        <div>
          <strong>${item.name}</strong>
          <span>Single-factor marginal probability · ${item.eventCount} tail-event sample(s)</span>
        </div>
        <div class="dependency-score">${percent(item.marginalProbability, 1)}</div>
      </div>
    `)
    .join("");

  if (!result.dependencies.length) {
    els.dependencyList.innerHTML = `
      ${factorRows}
      <div class="empty">Select at least two factors to compute pair coupling.</div>
    `;
    return;
  }

  const pairRows = result.dependencies
    .slice(0, 6)
    .map((item) => `
      <div class="dependency-item">
        <div>
          <strong>${item.factors.join(" x ")}</strong>
          <span>${item.label} tail coupling · ${item.source}</span>
        </div>
        <div class="dependency-score">${percent(item.tailDependence, 0)}</div>
      </div>
    `)
    .join("");

  els.dependencyList.innerHTML = `${factorRows}${pairRows}`;
}

function finding(text, type = "") {
  return `<li class="${type}">${text}</li>`;
}

function renderFindings(result) {
  const ids = new Set(result.risks.map((risk) => risk.id));
  const highProb = result.jointProbability >= 0.06;
  const unverified = !result.profile.verified;

  els.codeFindings.innerHTML = [
    finding(
      unverified
        ? "Source metadata is incomplete; verification should be resolved before production scoring."
        : "Verified metadata is available for contract classification and ABI-aware review.",
      unverified ? "danger" : ""
    ),
    finding(
      ids.has("oracle")
        ? "Price-source reads should be monitored for stale rounds, fallback latency, and update cadence."
        : "No direct oracle dependency was inferred from the current factor set.",
      ids.has("oracle") ? "warn" : ""
    ),
    finding(
      result.governanceExposure > 55
        ? "Proxy upgrade and parameter permissions create material governance exposure during the stress window."
        : "Governance exposure remains inside the current model threshold.",
      result.governanceExposure > 55 ? "danger" : ""
    )
  ].join("");

  els.opsFindings.innerHTML = [
    finding(
      ids.has("keeper") || ids.has("gas")
        ? "Keeper delay and blockspace pressure materially increase peak liquidation queue depth."
        : "Keeper execution pressure is not dominant in this scenario.",
      ids.has("keeper") || ids.has("gas") ? "warn" : ""
    ),
    finding(
      result.liquidationCoverage < 62
        ? "Insurance-fund absorption falls below the upper simulated bad-debt band."
        : "Insurance-fund capacity covers the primary simulated bad-debt band.",
      result.liquidationCoverage < 62 ? "danger" : ""
    ),
    finding(
      `Estimated recovery window is ${result.recoveryWindowMinutes} minutes; gas pressure and execution batches should be monitored.`,
      result.recoveryWindowMinutes > 32 ? "warn" : ""
    )
  ].join("");

  els.marketFindings.innerHTML = [
    finding(
      ids.has("liquidity")
        ? "DEX depth withdrawal amplifies slippage and weakens liquidation incentives."
        : "Primary trading-route depth is not the main modeled driver.",
      ids.has("liquidity") ? "warn" : ""
    ),
    finding(
      highProb
        ? "Tail dependence lifts joint probability above linear single-factor aggregation."
        : "Joint probability remains inside the standard monitoring threshold.",
      highProb ? "warn" : ""
    ),
    finding(
      result.queueCongestion > 70
        ? "Liquidation incentives or batch auction limits should be increased."
        : "Current liquidation throughput satisfies the modeled stress load.",
      result.queueCongestion > 70 ? "danger" : ""
    )
  ].join("");
}

function renderEvents(result) {
  const severe = result.jointProbability >= 0.08 || result.queueCongestion > 70;
  const warning = result.jointProbability >= 0.035 || result.queueCongestion > 45;
  const status = severe ? "danger" : warning ? "warn" : "";
  const drivers = result.risks.map((risk) => risk.name.split(" ")[0]).join(" + ") || "Baseline";
  const rows = [
    ["T+00m", "Stress window opens", `${drivers} becomes active for ${result.profile.name}.`, warning ? "Watch" : "Stable"],
    ["T+03m", "Health factor reprice", `Collateral haircuts widen; joint tail probability reaches ${percent(result.jointProbability)}.`, warning ? "Elevated" : "Normal"],
    ["T+08m", "Liquidation execution", `Queue congestion is ${Math.round(result.queueCongestion)}% with expected bad debt of ${money(result.expectedBadDebtUsdM)}.`, severe ? "Critical" : warning ? "Slow" : "Clear"],
    [`T+${result.recoveryWindowMinutes}m`, "Recovery and rebalance", `Coverage recovers to ${Math.round(result.liquidationCoverage)}% after modeled absorption and execution.`, severe ? "Review" : "Recovered"]
  ];

  els.pathStatus.textContent = severe ? "Escalation required" : warning ? "Monitoring elevated" : "Monitoring active";
  els.eventTable.innerHTML = rows
    .map(([time, title, copy, pill]) => `
      <div class="event-row">
        <span class="event-label">${time}</span>
        <strong>${title}</strong>
        <p>${copy}</p>
        <span class="status-pill ${status}">${pill}</span>
      </div>
    `)
    .join("");
}

function resetScenario() {
  els.severity.value = 65;
  els.correlation.checked = true;
  els.keeper.checked = true;
  renderRiskGrid(state.selectedProfile);
  runStress();
}

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = els.searchInput.value.trim();
  if (query) searchContracts(query);
});

els.searchResults.addEventListener("click", (event) => {
  const button = event.target.closest("[data-profile]");
  if (!button) return;
  const profile = state.profiles.find((item) => profileKey(item) === button.dataset.profile);
  if (!profile) return;
  state.selectedProfile = profile;
  renderContracts();
  renderRiskGrid(profile);
  setStatus(`Using ${profile.name}. Stress engine refreshed.`);
  runStress();
});

els.contract.addEventListener("change", () => {
  state.selectedProfile = state.profiles.find((profile) => profileKey(profile) === els.contract.value) || state.profiles[0];
  renderRiskGrid(state.selectedProfile);
  runStress();
});
els.severity.addEventListener("input", runStress);
els.correlation.addEventListener("change", runStress);
els.keeper.addEventListener("change", runStress);
els.reset.addEventListener("click", resetScenario);
els.riskGrid.addEventListener("change", runStress);

loadInitialProfiles();
