import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const steps = [
  ["Build leakage-safe labels", "scripts/build-training-labels.js"],
  ["Calibrate marginals and dependence", "scripts/calibrate-marginals.js"],
  ["Run walk-forward validation", "scripts/backtest-model.js"]
];

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, script)], {
      cwd: root,
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code}`));
    });
  });
}

for (const [label, script] of steps) {
  console.log(`\n=== ${label} ===`);
  await run(script);
}

console.log("\nModel pipeline completed. The running dashboard will load the new artifacts on its next stress request.");
