import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const htmlPath = resolve(root, "docs", "product-overview.html");
const pdfPath = resolve(root, "docs", "product-overview.pdf");
const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const fileUrl = `file:///${htmlPath.replaceAll("\\", "/").replaceAll(" ", "%20")}`;
execFileSync(chromePath, [
  "--headless",
  "--disable-gpu",
  "--no-pdf-header-footer",
  `--print-to-pdf=${pdfPath}`,
  fileUrl
], { stdio: "inherit", windowsHide: true });
console.log(pdfPath);
