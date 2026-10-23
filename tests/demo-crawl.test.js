/* Published /demo/ links must stay under /demo/, except external sites. */
const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const script = path.join(root, "deploy", "demo", "crawl_links.py");
execFileSync("python3", [script, "--self-check"], { cwd: root, stdio: "inherit" });

const dest = fs.mkdtempSync(path.join(os.tmpdir(), "bjj-demo-crawl-"));
try {
  execFileSync("python3", [script, "--publish", root, dest], { cwd: root, stdio: "inherit" });
} catch (err) {
  const out = (err.stdout && err.stdout.toString()) || "";
  const errText = (err.stderr && err.stderr.toString()) || "";
  assert.fail(out + errText + (err.message || ""));
} finally {
  fs.rmSync(dest, { recursive: true, force: true });
}

console.log("demo crawl checks passed");
