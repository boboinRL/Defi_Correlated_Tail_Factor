# DeFi Correlated Tail Factor

Ethereum-focused DeFi tail-risk stress testing and evidence-backed smart-contract auditing.

## Run

```powershell
cd "E:\DeFi\Tail-Factor"
$env:GLM_API_KEY="your-key"
$env:GLM_API_MODE="coding"
$env:COINGECKO_API_KEY="your-key"
$env:COINGECKO_API_PLAN="demo"
node server.js
```

Open `http://localhost:3000`.

API keys must stay in environment variables. Do not place them in frontend files or commit them to Git.

`GLM_API_MODE` defaults to `coding`, which uses the Coding Plan endpoint. Set it to `standard` only when using a regular pay-as-you-go API key:

```powershell
$env:GLM_API_MODE="standard"
```

`COINGECKO_API_PLAN` defaults to `demo`. Set it to `pro` only for a paid CoinGecko Pro key:

```powershell
$env:COINGECKO_API_PLAN="pro"
```

## Full Audit

Select a contract and click **Run Full Audit**. The pipeline:

1. Resolves proxy and implementation addresses.
2. Collects verified source, ABI, bytecode, and proxy-slot evidence.
3. Hashes and versions the evidence bundle.
4. Compiles verified Solidity source and runs Slither.
5. Clusters duplicate findings and extracts source excerpts.
6. Prioritizes economic, privileged, oracle, liquidity, keeper, gas, governance, and MEV paths.
7. Downgrades known benign framework patterns without hiding them.
8. Uses GLM for an analyst round and an adversarial reviewer round when `GLM_API_KEY` is configured.
9. Saves and exposes a downloadable JSON report.

GLM does not generate probabilities, alter source evidence, or confirm exploitability. Confirmed vulnerability status requires deployed-state checks and focused fork tests.

## Generated Evidence

Generated files are local and ignored by Git:

- `data/generated/audits/`
- `data/generated/slither-results/`
- `data/generated/agent-reports/`

## Commands

```powershell
npm test
npm run audit:slither -- 1 0xContractAddress
```

The project-local audit environment is stored in `.venv-audit/` and uses Slither with the Solidity compiler version required by the verified contract source.
