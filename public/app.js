const riskFactors = [
  {
    id: "oracle",
    name: "Oracle Depeg / Lag",
    desc: "Price-source deviation, stale rounds, and cross-oracle spread widening",
    zhName: "预言机脱锚 / 延迟",
    zhDesc: "价格源偏离、轮次过期以及跨预言机价差扩大",
    baseProb: 0.018
  },
  {
    id: "liquidity",
    name: "DEX Liquidity Drain",
    desc: "Depth contraction, slippage expansion, and arbitrage route failure",
    zhName: "DEX 流动性枯竭",
    zhDesc: "市场深度收缩、滑点扩大以及套利路径失效",
    baseProb: 0.026
  },
  {
    id: "volatility",
    name: "Volatility Jump",
    desc: "Collateral gap-downs and correlated deleveraging across risk assets",
    zhName: "波动率跳升",
    zhDesc: "抵押品跳空下跌以及风险资产同步去杠杆",
    baseProb: 0.031
  },
  {
    id: "keeper",
    name: "Keeper Congestion",
    desc: "Liquidation bot latency, failed gas bidding, and batch execution stalls",
    zhName: "Keeper 拥堵",
    zhDesc: "清算机器人延迟、Gas 竞价失败以及批量执行阻塞",
    baseProb: 0.015
  },
  {
    id: "governance",
    name: "Governance Upgrade Risk",
    desc: "Parameter votes, proxy upgrades, and privileged action windows",
    zhName: "治理升级风险",
    zhDesc: "参数投票、代理升级以及特权操作窗口",
    baseProb: 0.009
  },
  {
    id: "stablecoin",
    name: "Stablecoin Depeg",
    desc: "Stablecoin price break, redemption pressure, and liquidity fragmentation",
    zhName: "稳定币脱锚",
    zhDesc: "稳定币价格偏离、赎回压力以及流动性碎片化",
    baseProb: 0.014
  },
  {
    id: "gas",
    name: "Gas Spike",
    desc: "Blockspace congestion, delayed liquidations, and failed keeper bids",
    zhName: "Gas 费用激增",
    zhDesc: "区块空间拥堵、清算延迟以及 Keeper 竞价失败",
    baseProb: 0.02
  },
  {
    id: "mev",
    name: "MEV / OEV Capture",
    desc: "Liquidation value extraction, adverse ordering, and keeper competition",
    zhName: "MEV / OEV 价值捕获",
    zhDesc: "清算价值提取、不利交易排序以及 Keeper 竞争",
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
  language: document.querySelector("#languageSelect"),
  searchInput: document.querySelector("#contractSearchInput"),
  searchStatus: document.querySelector("#searchStatus"),
  searchResults: document.querySelector("#searchResults"),
  glmFactor: document.querySelector("#glmFactorButton"),
  agentStatus: document.querySelector("#agentStatus"),
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
  requestId: 0,
  locale: localStorage.getItem("tail-risk-locale") || "en"
};

const zh = {
  "Overview": "概览",
  "Stress Test": "压力测试",
  "Audit": "审计",
  "Monitor": "监控",
  "Smart Contract": "智能合约",
  "DeFi Protocol": "DeFi 协议",
  "Liquidation Resilience": "清算韧性",
  "Coverage": "覆盖率",
  "Last Audit": "最近审计",
  "Formal Verified": "形式化验证",
  "Bug Bounty": "漏洞赏金",
  "Oracle Monitor": "预言机监控",
  "Live Contract Search": "实时合约搜索",
  "Search Ethereum contracts by name or address": "按名称或地址搜索以太坊智能合约",
  "The backend can resolve known protocols locally, fetch verified metadata from Sourcify, and use Etherscan when an API key is configured.": "后端可从本地索引识别已知协议、从 Sourcify 获取验证信息，并在配置 API Key 后使用 Etherscan。",
  "Search": "搜索",
  "Ready to search Ethereum mainnet.": "可以搜索以太坊主网合约。",
  "Tail Event Audit": "尾部事件审计",
  "Multi-factor stress testing for liquidation resilience": "面向清算韧性的多因素压力测试",
  "Select a contract and combine stress factors to estimate joint tail-event probability, bad-debt exposure, liquidity shock, keeper congestion, and governance upgrade risk.": "选择合约并组合压力因子，以估算联合尾部事件概率、坏账敞口、流动性冲击、Keeper 拥堵和治理升级风险。",
  "Joint Tail Probability": "联合尾部概率",
  "Expected Bad Debt": "预期坏账",
  "Recovery Window": "恢复窗口",
  "Scenario Builder": "场景构建器",
  "Linked Risk Factors": "关联风险因子",
  "Ask GLM-5.1": "询问 GLM-5.1",
  "Reset": "重置",
  "GLM factor selection is available when GLM_API_KEY is configured.": "配置 GLM_API_KEY 后可使用 GLM 风险因子选择。",
  "Shock Severity": "冲击强度",
  "Apply tail-dependence matrix": "应用尾部依赖矩阵",
  "Simulate keeper delay": "模拟 Keeper 延迟",
  "Tail Probability": "尾部概率",
  "Current Scenario": "当前场景",
  "Liquidation Coverage": "清算覆盖率",
  "Capital Gap": "资金缺口",
  "Queue Congestion": "队列拥堵",
  "Governance Exposure": "治理敞口",
  "Event Surface": "事件曲面",
  "Tail Probability Heatmap": "尾部概率热力图",
  "Dependency Model": "依赖模型",
  "Active Factor Pair Coupling": "当前因子对耦合",
  "Single-factor prior + pair coupling": "单因子先验 + 因子对耦合",
  "Code Security": "代码安全",
  "Operational Resilience": "运营韧性",
  "Market Stability": "市场稳定性",
  "Static review of proxy contracts, external calls, oracle reads, and liquidation function paths.": "静态检查代理合约、外部调用、预言机读取和清算函数路径。",
  "Keeper availability, oracle freshness, execution congestion, and insurance-fund absorption capacity.": "评估 Keeper 可用性、预言机时效、执行拥堵和保险基金吸收能力。",
  "DEX depth, collateral correlation, volatility jumps, liquidation incentives, and slippage spread.": "评估 DEX 深度、抵押品相关性、波动率跳升、清算激励和滑点扩散。",
  "Liquidation Path": "清算路径",
  "Stress Event Execution Path": "压力事件执行路径",
  "Monitoring active": "监控中"
};

function isZh() {
  return state.locale === "zh-CN";
}

function tr(text) {
  return isZh() ? zh[text] || text : text;
}

function translateStaticUi() {
  document.documentElement.lang = state.locale;
  const selectors = [
    ".nav-links a", ".contract-picker label", ".identity-card .eyebrow",
    ".score-card .eyebrow", ".quick-facts span", ".badges span",
    ".search-card .eyebrow", ".search-card h2", ".search-card > div:first-child > p:last-child",
    ".search-form button", ".hero-band .eyebrow", ".hero-band h2", ".hero-band > div:first-child > p:last-child",
    ".hero-metrics span", ".control-panel .panel-head .eyebrow", ".control-panel .panel-head h3",
    "#glmFactorButton", "#resetButton", ".slider-label span", ".switch-row span",
    ".probability-orb small", ".risk-summary .eyebrow", ".metric-grid span",
    ".chart-card .eyebrow", ".chart-card h3", "#dependencySource",
    ".section-title span", ".audit-card > p", ".timeline-card .eyebrow", ".timeline-card h3"
  ];
  document.querySelectorAll(selectors.join(",")).forEach((element) => {
    if (!element.dataset.en) element.dataset.en = element.textContent.trim().replace(/\s+/g, " ");
    element.textContent = isZh() ? tr(element.dataset.en) : element.dataset.en;
  });
  els.searchInput.placeholder = isZh() ? "输入 Aave V3 Pool 或 0x87870b..." : "Try Aave V3 Pool or 0x87870b...";
  els.language.value = state.locale;
}

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
  if (probability >= 0.12) return isZh() ? "高风险" : "High risk";
  if (probability >= 0.06) return isZh() ? "较高风险" : "Elevated risk";
  if (probability >= 0.025) return isZh() ? "中等风险" : "Moderate risk";
  return isZh() ? "低风险" : "Low risk";
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

function setAgentStatus(message, tone = "") {
  els.agentStatus.textContent = message;
  els.agentStatus.dataset.tone = tone;
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
          <span class="risk-name">${isZh() ? risk.zhName : risk.name}</span>
          <span class="risk-desc">${isZh() ? risk.zhDesc : risk.desc}</span>
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
    setStatus(isZh() ? "已加载本地索引。粘贴以太坊地址可查询实时元数据。" : "Loaded local registry. Paste an Ethereum address for live metadata lookup.");
  } catch (error) {
    upsertProfiles(fallbackProfiles);
    setStatus(`API unavailable, using local fallback: ${error.message}`, "warn");
  }

  renderRiskGrid();
  await runStress();
}

async function searchContracts(query) {
  setStatus(isZh() ? "正在搜索合约元数据..." : "Searching contract metadata...");
  els.searchResults.innerHTML = "";

  try {
    const data = await api(`/api/contracts/search?q=${encodeURIComponent(query)}&chainId=1`);
    const results = data.results || [];
    upsertProfiles(results);
    renderSearchResults(results);
    setStatus(results.length ? (isZh() ? `找到 ${results.length} 个结果。` : `Found ${results.length} result(s).`) : data.message || (isZh() ? "未找到结果。" : "No results found."), results.length ? "" : "warn");
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
        simulateKeeper: els.keeper.checked,
        useMarketData: true
      })
    });
    if (requestId !== state.requestId) return;
    state.latestResult = result;
    renderResult(result);
  } catch (error) {
    setStatus(`Stress engine failed: ${error.message}`, "warn");
  }
}

async function applyGlmFactors() {
  const profile = state.selectedProfile;
  if (!profile) return;

  els.glmFactor.disabled = true;
  setAgentStatus(isZh() ? "正在请求 GLM-5.1 分类合约并选择合适的风险因子..." : "Asking GLM-5.1 to classify this contract and select suitable factors...");

  try {
    const data = await api("/api/agent/classify", {
      method: "POST",
      body: JSON.stringify({
        chainId: profile.chainId,
        address: profile.address,
        profile
      })
    });
    const allowed = new Set(riskFactors.map((risk) => risk.id));
    const ids = new Set((data.classification?.riskFactorIds || []).filter((id) => allowed.has(id)));

    document.querySelectorAll(".risk-option input").forEach((input) => {
      input.checked = ids.has(input.value);
    });

    const source = data.classification?.source || "classification agent";
    const confidence = data.classification?.confidence ? percent(Number(data.classification.confidence), 0) : "n/a";
    const factorNames = [...ids].map((id) => {
      const risk = riskFactors.find((item) => item.id === id);
      return risk ? (isZh() ? risk.zhName : risk.name) : id;
    }).join(", ") || (isZh() ? "无" : "none");
    setAgentStatus(isZh()
      ? `${source} 选择了：${factorNames}。置信度：${confidence}。`
      : `${source} selected: ${factorNames}. Confidence: ${confidence}. ${data.classification?.rationale || ""}`, "ok");
    await runStress();
  } catch (error) {
    setAgentStatus(`GLM factor selection failed: ${error.message}`, "warn");
  } finally {
    els.glmFactor.disabled = false;
  }
}

function renderResult(result) {
  const profile = result.profile;
  const level = riskLevel(result.jointProbability);
  const probabilityColor = colorForProbability(result.jointProbability);
  const names = result.risks.map((risk) => {
    const localRisk = riskFactors.find((item) => item.id === risk.id);
    return isZh() && localRisk ? localRisk.zhName : risk.name.split(" ").slice(0, 2).join(" ");
  });

  els.icon.textContent = profile.symbol || profile.name.slice(0, 1).toUpperCase();
  els.name.textContent = profile.name;
  els.meta.textContent = `${profile.category || (isZh() ? "智能合约" : "Smart contract")} / Ethereum`;
  els.tvl.textContent = profile.tvl || "Unknown";
  els.oracle.textContent = profile.oracle || "Not detected";
  els.coverage.textContent = profile.coverage || `${Math.round(result.liquidationCoverage)}%`;
  els.audit.textContent = profile.audit || "Not indexed";
  els.riskScore.textContent = result.resilienceScore;
  els.riskGrade.textContent = grade(result.resilienceScore);
  els.scoreRing.style.setProperty("--score", `${result.resilienceScore}%`);
  els.narrative.textContent = isZh()
    ? `${level}：${result.resilienceScore >= 80 ? "清算路径整体具备韧性" : "需要加强清算与流动性缓冲"}。模型置信度为 ${percent(result.model.confidence, 0)}。`
    : `${level}: ${result.resilienceScore >= 80 ? "liquidation paths remain broadly resilient" : "liquidation and liquidity buffers need reinforcement"}. Model confidence is ${percent(result.model.confidence, 0)}.`;
  els.jointProbability.textContent = percent(result.jointProbability);
  els.badDebt.textContent = money(result.expectedBadDebtUsdM);
  els.recoveryWindow.textContent = `${result.recoveryWindowMinutes}m`;
  els.orbValue.textContent = percent(result.jointProbability);
  els.orb.style.setProperty("--score", `${clamp(result.jointProbability * 300, 4, 100)}%`);
  els.orb.style.background = `radial-gradient(circle at center, #14233b 0 56%, transparent 57%), conic-gradient(${probabilityColor} var(--score), rgba(255, 255, 255, 0.16) 0)`;
  els.scenarioTitle.textContent = names.length ? names.join(" + ") : (isZh() ? "基准清算监控" : "Baseline liquidation monitor");
  els.scenarioCopy.textContent = names.length
    ? (isZh() ? `${level}：后端压力引擎使用单因子边际概率与尾部依赖矩阵计算当前因子组合。` : `${level}: the backend stress engine uses marginal probabilities plus a tail-dependence matrix for the selected factor set.`)
    : (isZh() ? "当前未选择风险因子，因此场景概率和压力指标均重置为零。" : "No risk factor is selected, so scenario probability and stress metrics are reset to zero.");
  els.coverageMetric.textContent = `${Math.round(result.liquidationCoverage)}%`;
  els.gapMetric.textContent = money(result.expectedBadDebtUsdM);
  els.queueMetric.textContent = `${Math.round(result.queueCongestion)}%`;
  els.governanceMetric.textContent = `${Math.round(result.governanceExposure)}%`;
  els.coverageBar.style.width = `${result.liquidationCoverage}%`;
  els.gapBar.style.width = `${result.expectedBadDebtUsdM ? clamp(result.expectedBadDebtUsdM, 5, 100) : 0}%`;
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
    if (input.checked && factor) {
      weight.textContent = percent(factor.marginalProbability, 1);
      weight.title = `${factor.priorSource}; ${factor.eventCount} event samples`;
    } else {
      weight.textContent = "0.0%";
      weight.title = isZh() ? "当前场景未选择该因子" : "Not selected in the current scenario";
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
  const market = result.marketSignals;
  const marketRows = market ? `
    <div class="dependency-item">
      <div>
        <strong>Market data adjustment</strong>
        <span>${market.coins?.length || 0} CoinGecko asset(s), ${market.protocol ? "DefiLlama TVL" : "no DefiLlama TVL"}, ${market.dune ? "Dune execution queued" : "no Dune query"}</span>
      </div>
      <div class="dependency-score">${percent(Math.max(market.stress?.volatility || 0, market.stress?.liquidity || 0, market.stress?.stablecoin || 0), 0)}</div>
    </div>
    ${market.warnings?.length ? `
      <div class="empty">${market.warnings.slice(0, 2).join(" ")}</div>
    ` : ""}
  ` : "";

  if (!result.dependencies.length) {
    els.dependencyList.innerHTML = `
      ${marketRows}
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

  els.dependencyList.innerHTML = `${marketRows}${factorRows}${pairRows}`;
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
  document.querySelectorAll(".risk-option input").forEach((input) => {
    input.checked = false;
  });
  setAgentStatus(isZh() ? "场景已清空，当前未选择风险因子。" : "Scenario cleared. No risk factor is selected.", "");
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
  setAgentStatus(isZh() ? "合约已切换。点击“询问 GLM-5.1”获取推荐风险因子。" : "Contract changed. Use Ask GLM-5.1 to classify recommended factors.", "");
  runStress();
});
els.language.addEventListener("change", () => {
  const selectedIds = new Set(selectedRiskIds());
  state.locale = els.language.value;
  localStorage.setItem("tail-risk-locale", state.locale);
  translateStaticUi();
  renderRiskGrid(state.selectedProfile);
  document.querySelectorAll(".risk-option input").forEach((input) => {
    input.checked = selectedIds.has(input.value);
  });
  if (state.latestResult) renderResult(state.latestResult);
  setAgentStatus(isZh() ? "语言已切换为简体中文。" : "Language switched to English.", "ok");
});
els.severity.addEventListener("input", runStress);
els.correlation.addEventListener("change", runStress);
els.keeper.addEventListener("change", runStress);
els.glmFactor.addEventListener("click", applyGlmFactors);
els.reset.addEventListener("click", resetScenario);
els.riskGrid.addEventListener("change", runStress);

translateStaticUi();
loadInitialProfiles();
