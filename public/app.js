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
  glmAudit: document.querySelector("#glmAuditButton"),
  glmAuditStatus: document.querySelector("#glmAuditStatus"),
  glmAuditMemo: document.querySelector("#glmAuditMemo"),
  recon: document.querySelector("#reconButton"),
  reconStatus: document.querySelector("#reconStatus"),
  reconReport: document.querySelector("#reconReport"),
  slither: document.querySelector("#slitherButton"),
  slitherStatus: document.querySelector("#slitherStatus"),
  slitherReport: document.querySelector("#slitherReport"),
  fullAudit: document.querySelector("#fullAuditButton"),
  fullAuditStatus: document.querySelector("#fullAuditStatus"),
  fullAuditReport: document.querySelector("#fullAuditReport"),
  fullAuditDownload: document.querySelector("#fullAuditDownload"),
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
  horizonControl: document.querySelector("#horizonControl"),
  horizonButtons: document.querySelectorAll("#horizonControl button"),
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
  dependencySource: document.querySelector("#dependencySource"),
  dependencyList: document.querySelector("#dependencyList"),
  validationVersion: document.querySelector("#validationVersion"),
  validationSummary: document.querySelector("#validationSummary"),
  calibrationChart: document.querySelector("#calibrationChart"),
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
  auditMemoKey: "",
  reconKey: "",
  fullAuditResult: null,
  requestId: 0,
  locale: localStorage.getItem("tail-risk-locale") || "en",
  horizon: localStorage.getItem("tail-risk-horizon") || "7d"
};

if (!["1d", "7d", "30d"].includes(state.horizon)) state.horizon = "7d";

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
  "All-Selected Joint Probability": "所选因子全部联动概率",
  "Expected Bad Debt": "预期坏账",
  "Recovery Window": "恢复窗口",
  "Scenario Builder": "场景构建器",
  "Linked Risk Factors": "关联风险因子",
  "Ask GLM-5.1": "询问 GLM-5.1",
  "Reset": "重置",
  "GLM factor selection is available when GLM_API_KEY is configured.": "配置 GLM_API_KEY 后可使用 GLM 风险因子选择。",
  "Prediction Horizon": "预测周期",
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
  "Model Validation": "模型验证",
  "Walk-Forward Calibration": "滚动前推校准",
  "Not available": "暂无数据",
  "AI Analysis": "AI 分析",
  "GLM Risk Memo": "GLM 风险备忘录",
  "Generate AI Risk Memo": "生成 AI 风险备忘录",
  "Generate a structured explanation, mechanism chain, mitigations, monitoring signals, and limitations for the current scenario.": "为当前场景生成结构化解释、机制链、缓解措施、监控指标和模型限制。",
  "Audit Agent · Phase 1": "审计 Agent · 第一阶段",
  "Contract Reconnaissance": "合约侦察",
  "Run Reconnaissance": "运行合约侦察",
  "Build a traceable evidence bundle from verified source, ABI, proxy slots, bytecode, and function signatures.": "从验证源码、ABI、代理槽位、字节码和函数签名构建可追溯证据包。",
  "Audit Agent · Full Pipeline": "审计 Agent · 完整流程",
  "Autonomous Contract Audit": "自主智能合约审计",
  "Run Full Audit": "运行完整审计",
  "Download JSON": "下载 JSON",
  "One run collects evidence, executes Slither, triages findings, builds attack paths, and performs multi-round GLM review.": "一次运行即可收集证据、执行 Slither、筛选发现、构建攻击路径并完成 GLM 多轮复核。",
  "Audit Agent · Phase 2": "审计 Agent · 第二阶段",
  "Static Analysis & Finding Triage": "静态分析与发现筛选",
  "Run Slither Scan": "运行 Slither 扫描",
  "Run Slither against the verified source evidence, then map candidate findings to tail-risk factors.": "对已验证源码运行 Slither，并将候选发现映射到尾部风险因子。",
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
    ".search-form button", "#searchStatus", "#agentStatus", ".hero-band .eyebrow", ".hero-band h2", ".hero-band > div:first-child > p:last-child",
    ".hero-metrics span", ".control-panel .panel-head .eyebrow", ".control-panel .panel-head h3",
    "#glmFactorButton", "#glmAuditButton", "#glmAuditStatus", "#fullAuditButton", "#fullAuditDownload", "#fullAuditStatus", "#reconButton", "#reconStatus", "#slitherButton", "#slitherStatus", "#resetButton", ".horizon-block > span", ".slider-label span", ".switch-row span",
    ".probability-orb small", ".risk-summary .eyebrow", ".metric-grid span",
    ".chart-card .eyebrow", ".chart-card h3", "#dependencySource", "#validationVersion",
    ".section-title span", ".audit-card > p", ".timeline-card .eyebrow", ".timeline-card h3"
  ];
  document.querySelectorAll(selectors.join(",")).forEach((element) => {
    if (!element.dataset.en) element.dataset.en = element.textContent.trim().replace(/\s+/g, " ");
    element.textContent = isZh() ? tr(element.dataset.en) : element.dataset.en;
  });
  els.searchInput.placeholder = isZh() ? "输入 Aave V3 Pool 或 0x87870b..." : "Try Aave V3 Pool or 0x87870b...";
  els.language.value = state.locale;
  els.horizonButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.horizon === state.horizon);
  });
}

function percent(value, digits = 2) {
  return `${(value * 100).toFixed(digits)}%`;
}

function probabilityPercent(value) {
  if (value > 0 && value < 0.0001) return `${(value * 100).toFixed(4)}%`;
  if (value > 0 && value < 0.001) return `${(value * 100).toFixed(3)}%`;
  return percent(value);
}

function money(value) {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}B`;
  return `$${value.toFixed(1)}M`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
            <span>${profile.verified ? (isZh() ? "已验证" : "Verified") : (isZh() ? "未验证" : "Unverified")}</span>
            <span>${profile.source || "Indexed"}</span>
          </div>
        </div>
        <button class="ghost-button" type="button" data-profile="${profileKey(profile)}">${isZh() ? "使用此合约" : "Use Contract"}</button>
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
        horizon: state.horizon,
        severity,
        useCorrelation: els.correlation.checked,
        simulateKeeper: els.keeper.checked,
        useMarketData: true
      })
    });
    if (requestId !== state.requestId) return;
    state.latestResult = result;
    state.auditMemoKey = "";
    els.glmAuditMemo.innerHTML = "";
    els.glmAuditStatus.textContent = isZh()
      ? "场景已更新，可以生成新的 GLM 风险备忘录。"
      : "Scenario updated. Generate a new GLM risk memo.";
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
    const fallbackNote = data.fallbackReason
      ? (isZh()
          ? `GLM 请求未完成，已自动使用本地规则。原因：${data.fallbackReason}`
          : `GLM request did not complete; local rules were used automatically. Reason: ${data.fallbackReason}`)
      : "";
    setAgentStatus(isZh()
      ? `${source} 选择了：${factorNames}。置信度：${confidence}。${fallbackNote}`
      : `${source} selected: ${factorNames}. Confidence: ${confidence}. ${fallbackNote || data.classification?.rationale || ""}`,
    data.fallbackReason ? "warn" : "ok");
    await runStress();
  } catch (error) {
    setAgentStatus(`GLM factor selection failed: ${error.message}`, "warn");
  } finally {
    els.glmFactor.disabled = false;
  }
}

function auditResultKey(result) {
  return JSON.stringify({
    address: result.profile?.address,
    model: result.model?.version,
    horizon: result.predictionHorizon,
    factors: result.risks.map((risk) => risk.id).sort(),
    severity: result.severity,
    correlation: result.useCorrelation,
    keeper: result.simulateKeeper,
    locale: state.locale
  });
}

function memoSection(title, items) {
  const rows = (items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  return `
    <section>
      <h4>${escapeHtml(title)}</h4>
      <ul>${rows}</ul>
    </section>
  `;
}

function renderAuditMemo(memo) {
  const sourceLabel = memo.source === "GLM"
    ? `${memo.model}${memo.cached ? (isZh() ? " · 缓存" : " · cached") : ""}`
    : (isZh() ? "本地规则回退" : "Local rules fallback");
  els.glmAuditStatus.textContent = isZh()
    ? `来源：${sourceLabel}。GLM 仅解释已有证据，不负责计算概率。`
    : `Source: ${sourceLabel}. GLM explains supplied evidence and does not calculate probabilities.`;
  els.glmAuditMemo.innerHTML = `
    <article class="ai-memo-summary">
      <span>${isZh() ? "执行摘要" : "Executive Summary"}</span>
      <p>${escapeHtml(memo.executiveSummary || "")}</p>
    </article>
    <div class="ai-memo-grid">
      ${memoSection(isZh() ? "机制链" : "Mechanism Chain", memo.mechanismChain)}
      ${memoSection(isZh() ? "缓解措施" : "Mitigations", memo.mitigations)}
      ${memoSection(isZh() ? "监控指标" : "Monitoring Signals", memo.monitoringSignals)}
      ${memoSection(isZh() ? "限制" : "Limitations", memo.limitations)}
    </div>
    ${memo.fallbackReason ? `<div class="ai-memo-warning">${escapeHtml(memo.fallbackReason)}</div>` : ""}
  `;
}

async function generateGlmAudit() {
  const result = state.latestResult;
  if (!result || !result.risks.length) {
    els.glmAuditStatus.textContent = isZh()
      ? "请先选择至少一个风险因子。"
      : "Select at least one risk factor first.";
    return;
  }

  const key = auditResultKey(result);
  els.glmAudit.disabled = true;
  els.glmAuditStatus.textContent = isZh()
    ? "GLM 正在阅读当前场景、统计结果和回测证据..."
    : "GLM is reading the current scenario, statistical results, and validation evidence...";

  try {
    const data = await api("/api/agent/audit", {
      method: "POST",
      body: JSON.stringify({
        locale: state.locale,
        result
      })
    });
    if (key !== auditResultKey(state.latestResult)) {
      els.glmAuditStatus.textContent = isZh()
        ? "场景已变化，请重新生成风险备忘录。"
        : "The scenario changed. Generate the risk memo again.";
      return;
    }
    state.auditMemoKey = key;
    renderAuditMemo(data.memo || {});
  } catch (error) {
    els.glmAuditStatus.textContent = isZh()
      ? `AI 风险备忘录生成失败：${error.message}`
      : `AI risk memo failed: ${error.message}`;
  } finally {
    els.glmAudit.disabled = false;
  }
}

function clearReconReport() {
  state.reconKey = "";
  els.reconReport.innerHTML = "";
  els.reconStatus.textContent = isZh()
    ? "从验证源码、ABI、代理槽位、字节码和函数签名构建可追溯证据包。"
    : "Build a traceable evidence bundle from verified source, ABI, proxy slots, bytecode, and function signatures.";
}

function clearSlitherReport() {
  if (!els.slitherReport) return;
  els.slitherReport.innerHTML = "";
  els.slitherStatus.textContent = isZh()
    ? "对已验证源码运行 Slither，并将候选发现映射到尾部风险因子。"
    : "Run Slither against the verified source evidence, then map candidate findings to tail-risk factors.";
}

function clearFullAuditReport() {
  if (!els.fullAuditReport) return;
  state.fullAuditResult = null;
  els.fullAuditDownload.hidden = true;
  els.fullAuditReport.innerHTML = "";
  els.fullAuditStatus.textContent = isZh()
    ? "一次运行即可收集证据、执行 Slither、筛选发现、构建攻击路径并完成 GLM 多轮复核。"
    : "One run collects evidence, executes Slither, triages findings, builds attack paths, and performs multi-round GLM review.";
}

function reconList(items, emptyText) {
  if (!items?.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderReconReport(bundle) {
  const proxyItems = [
    bundle.proxy?.implementation && `${isZh() ? "实现合约" : "Implementation"}: ${bundle.proxy.implementation}`,
    bundle.proxy?.admin && `${isZh() ? "代理管理员" : "Proxy admin"}: ${bundle.proxy.admin}`,
    bundle.proxy?.beacon && `${isZh() ? "Beacon" : "Beacon"}: ${bundle.proxy.beacon}`,
    `${isZh() ? "字节码大小" : "Bytecode size"}: ${bundle.proxy?.bytecodeBytes || 0} bytes`
  ].filter(Boolean);
  const sourceItems = (bundle.sources || []).map((source) =>
    `${source.provider} (${source.role}): ${source.verified ? (isZh() ? "已验证" : "verified") : (isZh() ? "未验证" : "unverified")} · ${source.sourceFiles} ${isZh() ? "个源码文件" : "source files"} · ${source.abiEntries} ABI entries`
  );
  const privileged = (bundle.attackSurface?.privilegedFunctions || []).map((item) =>
    `${item.signature} · ${item.stateMutability || "nonpayable"}`
  );
  const economic = (bundle.attackSurface?.economicFunctions || []).map((item) =>
    `${item.signature} · ${item.stateMutability || "nonpayable"}`
  );
  const signals = (bundle.sourceSignals || []).map((item) =>
    `${item.id} · ${item.file}:${item.line} · ${item.description}`
  );

  els.reconStatus.textContent = isZh()
    ? `证据包 ${bundle.bundleId}${bundle.cached ? " · 缓存" : ""} · 状态：${bundle.status}`
    : `Evidence bundle ${bundle.bundleId}${bundle.cached ? " · cached" : ""} · Status: ${bundle.status}`;
  els.reconReport.innerHTML = `
    <div class="recon-metrics">
      <div><span>${isZh() ? "源码文件" : "Source Files"}</span><strong>${bundle.sourceFiles?.length || 0}</strong></div>
      <div><span>${isZh() ? "函数" : "Functions"}</span><strong>${bundle.attackSurface?.functionCount || 0}</strong></div>
      <div><span>${isZh() ? "状态修改函数" : "State-Changing"}</span><strong>${bundle.attackSurface?.stateChangingCount || 0}</strong></div>
      <div><span>${isZh() ? "源码信号" : "Source Signals"}</span><strong>${bundle.sourceSignals?.length || 0}</strong></div>
    </div>
    <div class="recon-hash">
      <span>${isZh() ? "证据哈希" : "Evidence Hash"}</span>
      <code>${escapeHtml(bundle.evidenceHash || "Unavailable")}</code>
    </div>
    <div class="recon-grid">
      <section>
        <h4>${isZh() ? "证据来源" : "Evidence Sources"}</h4>
        ${reconList(sourceItems, isZh() ? "未取得验证源码或 ABI。" : "No verified source or ABI was retrieved.")}
      </section>
      <section>
        <h4>${isZh() ? "代理与字节码" : "Proxy & Bytecode"}</h4>
        ${reconList(proxyItems, isZh() ? "未检测到标准代理槽位。" : "No standard proxy slots were detected.")}
      </section>
      <section>
        <h4>${isZh() ? "权限候选函数" : "Privileged Function Candidates"}</h4>
        ${reconList(privileged, isZh() ? "ABI 中未发现名称匹配的权限函数。" : "No name-matched privileged functions were found in the ABI.")}
      </section>
      <section>
        <h4>${isZh() ? "经济关键函数" : "Economic Function Candidates"}</h4>
        ${reconList(economic, isZh() ? "ABI 中未发现名称匹配的经济函数。" : "No name-matched economic functions were found in the ABI.")}
      </section>
    </div>
    <section class="recon-signals">
      <h4>${isZh() ? "源码模式证据" : "Source Pattern Evidence"}</h4>
      ${reconList(signals, isZh() ? "没有可扫描源码，或未命中当前模式。" : "No source was available to scan, or no current pattern matched.")}
    </section>
    ${(bundle.warnings || []).length ? `
      <div class="recon-warning">
        <strong>${isZh() ? "证据缺口" : "Evidence Gaps"}</strong>
        ${reconList(bundle.warnings, "")}
      </div>
    ` : ""}
  `;
}

async function runReconnaissance() {
  const profile = state.selectedProfile;
  if (!profile) return;
  const key = profileKey(profile);
  els.recon.disabled = true;
  els.reconStatus.textContent = isZh()
    ? "Audit Agent 正在收集源码、ABI、代理槽位和字节码证据..."
    : "Audit Agent is collecting source, ABI, proxy-slot, and bytecode evidence...";

  try {
    const data = await api("/api/audit/recon", {
      method: "POST",
      body: JSON.stringify({
        chainId: profile.chainId,
        address: profile.address,
        profile
      })
    });
    if (key !== profileKey(state.selectedProfile)) {
      clearReconReport();
      return;
    }
    state.reconKey = key;
    renderReconReport(data.bundle);
  } catch (error) {
    els.reconStatus.textContent = isZh()
      ? `合约侦察失败：${error.message}`
      : `Contract reconnaissance failed: ${error.message}`;
  } finally {
    els.recon.disabled = false;
  }
}

function renderSlitherReport(report) {
  const findings = report.findings || [];
  const visibleFindings = findings.filter((finding) => ["High", "Medium", "Low"].includes(finding.impact)).slice(0, 30);
  const factorNames = {
    oracle: "Oracle",
    "dex-liquidity": "DEX Liquidity",
    volatility: "Volatility",
    keeper: "Keeper",
    governance: "Governance",
    gas: "Gas",
    mev: "MEV"
  };
  els.slitherStatus.textContent = isZh()
    ? `扫描 ${report.status} · ${findings.length} 个候选发现 · ${report.tool?.name || "Slither"} ${report.tool?.version || ""}`
    : `Scan ${report.status} · ${findings.length} candidate findings · ${report.tool?.name || "Slither"} ${report.tool?.version || ""}`;
  els.slitherReport.innerHTML = `
    <div class="recon-metrics">
      <div><span>High</span><strong>${report.summary?.high || 0}</strong></div>
      <div><span>Medium</span><strong>${report.summary?.medium || 0}</strong></div>
      <div><span>Low</span><strong>${report.summary?.low || 0}</strong></div>
      <div><span>${isZh() ? "总计" : "Total"}</span><strong>${report.summary?.total || 0}</strong></div>
    </div>
    <div class="recon-hash">
      <span>${isZh() ? "证据包" : "Evidence Bundle"}</span>
      <code>${escapeHtml(report.evidenceBundleId || "Unavailable")}</code>
    </div>
    <div class="slither-findings">
      ${visibleFindings.length ? visibleFindings.map((finding) => `
        <article class="slither-finding impact-${String(finding.impact).toLowerCase()}">
          <div class="slither-finding-head">
            <strong>${escapeHtml(finding.title)}</strong>
            <span>${escapeHtml(finding.impact)} · ${escapeHtml(finding.confidence)}</span>
          </div>
          <p>${escapeHtml(finding.description)}</p>
          <code>${escapeHtml(finding.location?.file || "Source location unavailable")}${finding.location?.line ? `:${finding.location.line}` : ""}</code>
          <div class="finding-factors">${(finding.riskFactors || []).map((factor) => `<span>${factorNames[factor] || factor}</span>`).join("")}</div>
          <small>${escapeHtml(finding.remediation)}</small>
        </article>
      `).join("") : `<p>${isZh() ? "当前扫描没有产生需要优先复核的 Slither 候选发现。" : "This scan produced no prioritized Slither candidate findings."}</p>`}
      ${findings.length > visibleFindings.length ? `<p class="finding-overflow">${isZh() ? `页面显示优先级最高的 ${visibleFindings.length} 条；完整报告包含 ${findings.length} 条。` : `Showing the top ${visibleFindings.length} prioritized findings; the versioned report contains all ${findings.length}.`}</p>` : ""}
    </div>
    <div class="recon-warning">
      <strong>${isZh() ? "重要说明" : "Important"}</strong>
      <p>${isZh() ? "静态分析结果是待人工验证的候选发现，不等于已确认漏洞或可利用攻击路径。" : "Static-analysis results are candidates for manual validation, not confirmed vulnerabilities or proven exploit paths."}</p>
    </div>
  `;
}

async function runSlitherAudit() {
  const profile = state.selectedProfile;
  if (!profile) return;
  const key = profileKey(profile);
  els.slither.disabled = true;
  els.slitherStatus.textContent = isZh()
    ? "正在导出证据源码、编译合约并运行 Slither..."
    : "Exporting evidence source, compiling the contract, and running Slither...";
  try {
    const data = await api("/api/audit/slither", {
      method: "POST",
      body: JSON.stringify({ chainId: profile.chainId, address: profile.address })
    });
    if (key !== profileKey(state.selectedProfile)) return clearSlitherReport();
    renderSlitherReport(data.report);
  } catch (error) {
    els.slitherStatus.textContent = isZh()
      ? `Slither 扫描失败：${error.message}`
      : `Slither scan failed: ${error.message}`;
  } finally {
    els.slither.disabled = false;
  }
}

function verdictLabel(verdict) {
  const labels = {
    "credible-candidate": isZh() ? "可信候选" : "Credible candidate",
    "likely-benign-pattern": isZh() ? "疑似正常模式" : "Likely benign pattern",
    "needs-manual-review": isZh() ? "需要人工复核" : "Manual review"
  };
  return labels[verdict] || verdict;
}

function renderFullAuditReport(report) {
  const reviewById = new Map((report.aiReview?.findings || []).map((item) => [item.clusterId, item]));
  const queue = (report.reviewQueue || []).slice(0, 16);
  const factorNames = {
    oracle: "Oracle",
    "dex-liquidity": "DEX Liquidity",
    liquidity: "DEX Liquidity",
    volatility: "Volatility",
    keeper: "Keeper",
    governance: "Governance",
    gas: "Gas",
    mev: "MEV",
    stablecoin: "Stablecoin"
  };
  const aiSource = report.aiReview?.source || "deterministic fallback";
  els.fullAuditDownload.href = `/api/audit/report/${report.chainId}/${report.address}`;
  els.fullAuditDownload.hidden = false;
  els.fullAuditDownload.textContent = isZh() ? "下载 JSON" : "Download JSON";
  els.fullAuditStatus.textContent = isZh()
    ? `审计完成 · ${report.status} · ${aiSource} · 报告 ${report.reportId}`
    : `Audit completed · ${report.status} · ${aiSource} · Report ${report.reportId}`;
  els.fullAuditReport.innerHTML = `
    <div class="audit-overview">
      <div><span>${isZh() ? "审查等级" : "Review Level"}</span><strong>${escapeHtml(report.executiveRisk)}</strong></div>
      <div><span>${isZh() ? "原始发现" : "Raw Findings"}</span><strong>${report.summary?.rawFindings || 0}</strong></div>
      <div><span>${isZh() ? "复核队列" : "Review Queue"}</span><strong>${report.summary?.reviewQueue || 0}</strong></div>
      <div><span>${isZh() ? "可信候选" : "Credible Candidates"}</span><strong>${report.summary?.credibleCandidates || 0}</strong></div>
    </div>
    <section class="audit-executive">
      <div>
        <span>${isZh() ? "证据哈希" : "Evidence Hash"}</span>
        <code>${escapeHtml(report.evidence?.evidenceHash || "")}</code>
      </div>
      <p>${escapeHtml(report.aiReview?.executiveSummary || "")}</p>
    </section>
    <div class="audit-factor-strip">
      ${(report.factorExposure || []).map((factor) => `
        <span>${escapeHtml(factorNames[factor.id] || factor.id)} <strong>${factor.count}</strong></span>
      `).join("") || `<span>${isZh() ? "未映射尾部风险因子" : "No mapped tail-risk factors"}</span>`}
    </div>
    <section class="audit-review-list">
      <div class="audit-section-heading">
        <div><p class="eyebrow">${isZh() ? "复核队列" : "Review Queue"}</p><h4>${isZh() ? "证据化候选发现" : "Evidence-backed Candidates"}</h4></div>
        <span>${queue.length} / ${report.summary?.reviewQueue || 0}</span>
      </div>
      ${queue.map((item) => {
        const ai = reviewById.get(item.clusterId);
        const verdict = ai?.verdict || item.deterministicVerdict;
        return `
          <article class="audit-candidate verdict-${verdict}">
            <div class="candidate-head">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.maxImpact)} · ${escapeHtml(item.confidence)} · ${item.occurrenceCount}x</span>
              </div>
              <b>${escapeHtml(verdictLabel(verdict))}</b>
            </div>
            <p>${escapeHtml(ai?.rationale || item.description)}</p>
            <code>${escapeHtml(item.location?.file || "")}${item.location?.line ? `:${item.location.line}` : ""}</code>
            <pre>${escapeHtml(item.evidenceExcerpt?.text || "")}</pre>
            <div class="finding-factors">${(item.riskFactors || []).map((factor) => `<span>${factorNames[factor] || factor}</span>`).join("")}</div>
            <small><strong>${isZh() ? "建议测试：" : "Recommended test: "}</strong>${escapeHtml(ai?.recommendedTest || item.remediation)}</small>
          </article>
        `;
      }).join("")}
    </section>
    <div class="audit-report-grid">
      <section>
        <h4>${isZh() ? "跨因子机制链" : "Cross-factor Chains"}</h4>
        ${reconList(report.aiReview?.crossFactorChains || [], isZh() ? "没有生成机制链。" : "No mechanism chain was generated.")}
      </section>
      <section>
        <h4>${isZh() ? "立即行动" : "Immediate Actions"}</h4>
        ${reconList(report.aiReview?.immediateActions || [], isZh() ? "没有生成行动项。" : "No action was generated.")}
      </section>
    </div>
    <div class="recon-warning">
      <strong>${isZh() ? "审计边界" : "Audit Boundary"}</strong>
      <p>${isZh() ? "可信候选仍不等于已确认漏洞。最终确认需要主网分叉测试、部署状态验证和协议不变量检查。" : "A credible candidate is still not a confirmed vulnerability. Final confirmation requires fork tests, deployed-state validation, and protocol-invariant checks."}</p>
    </div>
  `;
}

async function runFullAudit() {
  const profile = state.selectedProfile;
  if (!profile) return;
  const key = profileKey(profile);
  els.fullAudit.disabled = true;
  els.fullAuditStatus.textContent = isZh()
    ? "Audit Agent 正在收集证据、编译源码、运行静态分析并进行多轮复核。这通常需要 10-90 秒..."
    : "Audit Agent is collecting evidence, compiling source, running static analysis, and performing multi-round review. This usually takes 10-90 seconds...";
  try {
    const data = await api("/api/audit/full", {
      method: "POST",
      body: JSON.stringify({
        chainId: profile.chainId,
        address: profile.address,
        profile,
        locale: state.locale
      })
    });
    if (key !== profileKey(state.selectedProfile)) return clearFullAuditReport();
    state.fullAuditResult = data.report;
    renderFullAuditReport(data.report);
  } catch (error) {
    els.fullAuditStatus.textContent = isZh()
      ? `完整审计失败：${error.message}`
      : `Full audit failed: ${error.message}`;
  } finally {
    els.fullAudit.disabled = false;
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
    ? `${level}：${result.resilienceScore >= 80 ? "清算路径整体具备韧性" : "需要加强清算与流动性缓冲"}。合约元数据与证据覆盖度为 ${percent(result.model.confidence, 0)}。`
    : `${level}: ${result.resilienceScore >= 80 ? "liquidation paths remain broadly resilient" : "liquidation and liquidity buffers need reinforcement"}. Contract metadata and evidence coverage is ${percent(result.model.confidence, 0)}.`;
  els.jointProbability.textContent = probabilityPercent(result.jointProbability);
  els.badDebt.textContent = money(result.expectedBadDebtUsdM);
  els.recoveryWindow.textContent = `${result.recoveryWindowMinutes}m`;
  els.orbValue.textContent = probabilityPercent(result.jointProbability);
  els.orb.style.setProperty("--score", `${clamp(result.jointProbability * 300, 4, 100)}%`);
  els.orb.style.background = `radial-gradient(circle at center, #14233b 0 56%, transparent 57%), conic-gradient(${probabilityColor} var(--score), rgba(255, 255, 255, 0.16) 0)`;
  els.scenarioTitle.textContent = names.length ? names.join(" + ") : (isZh() ? "基准清算监控" : "Baseline liquidation monitor");
  els.scenarioCopy.textContent = names.length
    ? (isZh()
        ? `${level}：这是 ${result.predictionHorizon} 所选因子全部联动概率，使用校准边际概率与 Gaussian copula Monte Carlo 计算。`
        : `${level}: ${result.predictionHorizon} all-selected joint probability from calibrated marginals and Gaussian-copula Monte Carlo.`)
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
  els.dependencySource.textContent = isZh()
    ? `${result.model.version} · ${result.model.calibrationStatus}`
    : `${result.model.version} · ${result.model.calibrationStatus}`;

  renderHeatmap(result);
  updateRiskProbabilities(result);
  renderDependencies(result);
  renderValidation(result);
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
  const horizons = ["1d", "7d", "30d"];
  const cells = Array.from({ length: 36 }, (_, index) => {
    const horizon = horizons[Math.floor(index / 12)];
    const value = result.horizonSurface?.[horizon]?.jointProbability || 0;
    const alpha = clamp(0.18 + value * 2.1, 0.18, 0.92);
    const color = colorForProbability(value);
    return `<span class="heat-cell" title="${horizon} ${probabilityPercent(value)}" style="--cell: color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, white);"></span>`;
  });

  els.heatmap.innerHTML = cells.join("");
}

function renderDependencies(result) {
  const simulationRows = result.risks.length ? `
    <div class="dependency-item">
      <div>
        <strong>${isZh() ? "至少一个所选因子" : "At least one selected factor"}</strong>
        <span>${isZh() ? "同一预测周期内任一所选因子发生" : "Any selected factor occurs inside the horizon"}</span>
      </div>
      <div class="dependency-score">${probabilityPercent(result.anySelectedProbability)}</div>
    </div>
    <div class="dependency-item">
      <div>
        <strong>${isZh() ? "至少两个因子联动" : "At least two selected factors"}</strong>
        <span>${result.simulation.method} · ${Number(result.simulation.samples).toLocaleString()} ${isZh() ? "次模拟" : "draws"}</span>
      </div>
      <div class="dependency-score">${probabilityPercent(result.atLeastTwoProbability)}</div>
    </div>
    <div class="dependency-item">
      <div>
        <strong>${isZh() ? "全部联动概率 95% 区间" : "All-selected 95% interval"}</strong>
        <span>${isZh() ? "仅表示 Monte Carlo 抽样误差，不包含模型风险" : "Monte Carlo sampling error only; excludes model risk"}</span>
      </div>
      <div class="dependency-score">${probabilityPercent(result.jointConfidence95.low)}-${probabilityPercent(result.jointConfidence95.high)}</div>
    </div>
  ` : "";
  const factorRows = result.factorProbabilities
    .map((item) => {
      const localRisk = riskFactors.find((risk) => risk.id === item.id);
      return `
      <div class="dependency-item">
        <div>
          <strong>${isZh() && localRisk ? localRisk.zhName : item.name}</strong>
          <span>${isZh() ? `校准边际概率 · ${item.calibrationObservations} 个日频观测` : `Calibrated marginal probability · ${item.calibrationObservations} daily observations`}</span>
        </div>
        <div class="dependency-score">${percent(item.marginalProbability, 1)}</div>
      </div>
    `;
    })
    .join("");
  const market = result.marketSignals;
  const marketRows = market ? `
    <div class="dependency-item">
      <div>
        <strong>${isZh() ? "市场数据调整" : "Market data adjustment"}</strong>
        <span>${isZh()
          ? `${market.coins?.length || 0} 个 CoinGecko 资产，${market.protocol ? "已获取 DefiLlama TVL" : "无 DefiLlama TVL"}，${market.dune ? "Dune 查询已排队" : "无 Dune 查询"}`
          : `${market.coins?.length || 0} CoinGecko asset(s), ${market.protocol ? "DefiLlama TVL" : "no DefiLlama TVL"}, ${market.dune ? "Dune execution queued" : "no Dune query"}`}</span>
      </div>
      <div class="dependency-score">${percent(Math.max(market.stress?.volatility || 0, market.stress?.liquidity || 0, market.stress?.stablecoin || 0), 0)}</div>
    </div>
    ${market.warnings?.length ? `
      <div class="empty">${market.warnings.slice(0, 2).join(" ")}</div>
    ` : ""}
  ` : "";

  if (!result.dependencies.length) {
    els.dependencyList.innerHTML = `
      ${simulationRows}
      ${marketRows}
      ${factorRows}
      <div class="empty">${isZh() ? "至少选择两个因子才能计算因子对耦合。" : "Select at least two factors to compute pair coupling."}</div>
    `;
    return;
  }

  const pairRows = result.dependencies
    .slice(0, 6)
    .map((item) => `
      <div class="dependency-item">
        <div>
          <strong>${item.factors.join(" x ")}</strong>
          <span>${isZh() ? `${item.label} 尾部耦合` : `${item.label} tail coupling`} · ${item.source}</span>
        </div>
        <div class="dependency-score">${percent(item.tailDependence, 0)}</div>
      </div>
    `)
    .join("");

  els.dependencyList.innerHTML = `${simulationRows}${marketRows}${factorRows}${pairRows}`;
}

function renderValidation(result) {
  const validation = result.model?.validation;
  if (!validation || !validation.observations) {
    els.validationVersion.textContent = isZh() ? "暂无回测" : "No backtest";
    els.validationSummary.innerHTML = `<div class="empty">${isZh() ? "请先运行 npm run backtest:model。" : "Run npm run backtest:model first."}</div>`;
    els.calibrationChart.innerHTML = "";
    return;
  }

  els.validationVersion.textContent = validation.metadata?.validationVersion || result.model.version;
  els.validationSummary.innerHTML = `
    <div><span>${isZh() ? "样本" : "Observations"}</span><strong>${validation.observations}</strong></div>
    <div><span>${isZh() ? "正标签" : "Positives"}</span><strong>${validation.positives}</strong></div>
    <div><span>Brier Score</span><strong>${Number(validation.brierScore).toFixed(4)}</strong></div>
    <div><span>Log Loss</span><strong>${Number(validation.logLoss).toFixed(4)}</strong></div>
  `;

  els.calibrationChart.innerHTML = (validation.calibrationCurve || []).map((bin) => {
    const predicted = clamp(Number(bin.meanPredicted || 0), 0, 1);
    const observed = clamp(Number(bin.observedRate || 0), 0, 1);
    const scale = Math.max(predicted, observed, 0.01);
    return `
      <div class="calibration-bin" title="${isZh() ? "预测" : "Predicted"} ${percent(predicted)} · ${isZh() ? "实际" : "Observed"} ${percent(observed)}">
        <div class="calibration-bars">
          <i class="predicted" style="height:${Math.max(3, predicted / scale * 100)}%"></i>
          <i class="observed" style="height:${Math.max(3, observed / scale * 100)}%"></i>
        </div>
        <span>${bin.observations}</span>
      </div>
    `;
  }).join("");
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
      isZh()
        ? (unverified ? "源码元数据不完整；在用于生产评分前应先完成验证。" : "已获得验证元数据，可用于合约分类和 ABI 感知审查。")
        : (unverified ? "Source metadata is incomplete; verification should be resolved before production scoring." : "Verified metadata is available for contract classification and ABI-aware review."),
      unverified ? "danger" : ""
    ),
    finding(
      isZh()
        ? (ids.has("oracle") ? "应监控价格源的过期轮次、备用源延迟和更新频率。" : "当前因子组合未推断出直接预言机依赖。")
        : (ids.has("oracle") ? "Price-source reads should be monitored for stale rounds, fallback latency, and update cadence." : "No direct oracle dependency was inferred from the current factor set."),
      ids.has("oracle") ? "warn" : ""
    ),
    finding(
      isZh()
        ? (result.governanceExposure > 55 ? "代理升级和参数权限在压力窗口内形成显著治理敞口。" : "治理敞口处于当前模型阈值内。")
        : (result.governanceExposure > 55 ? "Proxy upgrade and parameter permissions create material governance exposure during the stress window." : "Governance exposure remains inside the current model threshold."),
      result.governanceExposure > 55 ? "danger" : ""
    )
  ].join("");

  els.opsFindings.innerHTML = [
    finding(
      isZh()
        ? (ids.has("keeper") || ids.has("gas") ? "Keeper 延迟和区块空间压力会显著提高清算队列峰值。" : "Keeper 执行压力并非当前场景的主要驱动因素。")
        : (ids.has("keeper") || ids.has("gas") ? "Keeper delay and blockspace pressure materially increase peak liquidation queue depth." : "Keeper execution pressure is not dominant in this scenario."),
      ids.has("keeper") || ids.has("gas") ? "warn" : ""
    ),
    finding(
      isZh()
        ? (result.liquidationCoverage < 62 ? "保险基金吸收能力低于模拟坏账区间上沿。" : "保险基金能够覆盖主要模拟坏账区间。")
        : (result.liquidationCoverage < 62 ? "Insurance-fund absorption falls below the upper simulated bad-debt band." : "Insurance-fund capacity covers the primary simulated bad-debt band."),
      result.liquidationCoverage < 62 ? "danger" : ""
    ),
    finding(
      isZh()
        ? `预计恢复窗口为 ${result.recoveryWindowMinutes} 分钟；应持续监控 Gas 压力和执行批次。`
        : `Estimated recovery window is ${result.recoveryWindowMinutes} minutes; gas pressure and execution batches should be monitored.`,
      result.recoveryWindowMinutes > 32 ? "warn" : ""
    )
  ].join("");

  els.marketFindings.innerHTML = [
    finding(
      isZh()
        ? (ids.has("liquidity") ? "DEX 深度流失会放大滑点并削弱清算激励。" : "主要交易路径深度并非当前模型的主要驱动因素。")
        : (ids.has("liquidity") ? "DEX depth withdrawal amplifies slippage and weakens liquidation incentives." : "Primary trading-route depth is not the main modeled driver."),
      ids.has("liquidity") ? "warn" : ""
    ),
    finding(
      isZh()
        ? (highProb ? "尾部依赖使联合概率高于单因子线性聚合结果。" : "联合概率仍处于标准监控阈值内。")
        : (highProb ? "Tail dependence lifts joint probability above linear single-factor aggregation." : "Joint probability remains inside the standard monitoring threshold."),
      highProb ? "warn" : ""
    ),
    finding(
      isZh()
        ? (result.queueCongestion > 70 ? "应提高清算激励或批量拍卖上限。" : "当前清算吞吐量能够满足模拟压力负载。")
        : (result.queueCongestion > 70 ? "Liquidation incentives or batch auction limits should be increased." : "Current liquidation throughput satisfies the modeled stress load."),
      result.queueCongestion > 70 ? "danger" : ""
    )
  ].join("");
}

function renderEvents(result) {
  const severe = result.jointProbability >= 0.08 || result.queueCongestion > 70;
  const warning = result.jointProbability >= 0.035 || result.queueCongestion > 45;
  const status = severe ? "danger" : warning ? "warn" : "";
  const drivers = result.risks.map((risk) => {
    const localRisk = riskFactors.find((item) => item.id === risk.id);
    return isZh() && localRisk ? localRisk.zhName : risk.name.split(" ")[0];
  }).join(" + ") || (isZh() ? "基准场景" : "Baseline");
  const rows = isZh()
    ? [
        ["T+00m", "压力窗口开启", `${drivers} 已在 ${result.profile.name} 场景中激活。`, warning ? "关注" : "稳定"],
        ["T+03m", "健康因子重估", `抵押品折扣扩大；联合尾部概率达到 ${percent(result.jointProbability)}。`, warning ? "升高" : "正常"],
        ["T+08m", "清算执行", `队列拥堵率为 ${Math.round(result.queueCongestion)}%，预期坏账为 ${money(result.expectedBadDebtUsdM)}。`, severe ? "严重" : warning ? "缓慢" : "畅通"],
        [`T+${result.recoveryWindowMinutes}m`, "恢复与再平衡", `经过模型吸收和执行后，覆盖率恢复至 ${Math.round(result.liquidationCoverage)}%。`, severe ? "复核" : "已恢复"]
      ]
    : [
        ["T+00m", "Stress window opens", `${drivers} becomes active for ${result.profile.name}.`, warning ? "Watch" : "Stable"],
        ["T+03m", "Health factor reprice", `Collateral haircuts widen; joint tail probability reaches ${percent(result.jointProbability)}.`, warning ? "Elevated" : "Normal"],
        ["T+08m", "Liquidation execution", `Queue congestion is ${Math.round(result.queueCongestion)}% with expected bad debt of ${money(result.expectedBadDebtUsdM)}.`, severe ? "Critical" : warning ? "Slow" : "Clear"],
        [`T+${result.recoveryWindowMinutes}m`, "Recovery and rebalance", `Coverage recovers to ${Math.round(result.liquidationCoverage)}% after modeled absorption and execution.`, severe ? "Review" : "Recovered"]
      ];

  els.pathStatus.textContent = isZh()
    ? (severe ? "需要升级处置" : warning ? "监控级别升高" : "监控中")
    : (severe ? "Escalation required" : warning ? "Monitoring elevated" : "Monitoring active");
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
  state.horizon = "7d";
  localStorage.setItem("tail-risk-horizon", state.horizon);
  els.horizonButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.horizon === state.horizon);
  });
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
  clearReconReport();
  clearSlitherReport();
  clearFullAuditReport();
  setStatus(`Using ${profile.name}. Stress engine refreshed.`);
  runStress();
});

els.contract.addEventListener("change", () => {
  state.selectedProfile = state.profiles.find((profile) => profileKey(profile) === els.contract.value) || state.profiles[0];
  renderRiskGrid(state.selectedProfile);
  clearReconReport();
  clearSlitherReport();
  clearFullAuditReport();
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
  if (state.fullAuditResult) renderFullAuditReport(state.fullAuditResult);
  setAgentStatus(isZh() ? "语言已切换为简体中文。" : "Language switched to English.", "ok");
});
els.severity.addEventListener("input", runStress);
els.horizonControl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-horizon]");
  if (!button) return;
  state.horizon = button.dataset.horizon;
  localStorage.setItem("tail-risk-horizon", state.horizon);
  els.horizonButtons.forEach((item) => item.classList.toggle("active", item === button));
  runStress();
});
els.correlation.addEventListener("change", runStress);
els.keeper.addEventListener("change", runStress);
els.glmFactor.addEventListener("click", applyGlmFactors);
els.glmAudit.addEventListener("click", generateGlmAudit);
els.recon.addEventListener("click", runReconnaissance);
els.slither.addEventListener("click", runSlitherAudit);
els.fullAudit.addEventListener("click", runFullAudit);
els.reset.addEventListener("click", resetScenario);
els.riskGrid.addEventListener("change", runStress);

translateStaticUi();
loadInitialProfiles();
