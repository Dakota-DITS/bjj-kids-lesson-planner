/* Demo preview stays off production paths, cookies, and the live database. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const base = read("bjj-base.js");
assert.ok(base.includes("BJJ_BASE_AWARE"));
assert.ok(base.includes("DEMO PREVIEW, not live"));
assert.ok(base.includes("does not take payments"));
assert.ok(base.includes("does not email anyone"));
assert.ok(base.includes("onrealm.org"));
assert.ok(base.includes("serviceWorker.register"));

const sw = read("sw.js");
assert.ok(sw.includes('url.pathname === "/demo" || url.pathname.startsWith("/demo/")'));
assert.ok(sw.includes("grace-demo-public-"));
assert.ok(sw.includes("grace-demo-staff-"));
assert.ok(sw.includes('url.pathname.startsWith("/api/")'));
assert.equal((sw.match(/"\/api\//g) || []).length, 1);

const pwa = read("pwa.js");
assert.ok(pwa.includes('"/sw.js" + (version ? "?v=" + encodeURIComponent(version) : "")'));
assert.ok(pwa.includes('if (base) swPath = base + swPath'));
assert.ok(pwa.includes('path === "/demo" || path.indexOf("/demo/") === 0'));

const html = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".git" || name === "node_modules" || name === "vendor") continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else if (name.endsWith(".html")) html.push(full);
  }
}
walk(root);
assert.ok(html.length >= 12);
html.forEach((full) => {
  const text = fs.readFileSync(full, "utf8");
  assert.ok(text.includes('name="bjj-base" content=""'), full);
  assert.ok(text.includes('src="/bjj-base.js?v=20261023-41"'), full);
  assert.equal(text.includes("DEMO PREVIEW, not live"), false, full);
});

const config = JSON.parse(read("waiver-config.json"));
assert.equal(config.waiverSubmissionsEnabled, true);
assert.equal(config.waitlistEnabled, false);

const unit = read("deploy/bjj-planner-demo.service");
assert.ok(unit.includes("BJJ_DB=/var/lib/bjj-planner/demo.db"));
assert.ok(unit.includes("BJJ_PORT=8767"));
assert.ok(unit.includes("BJJ_COOKIE_NAME=bjj_demo_session"));
assert.ok(unit.includes("BJJ_COOKIE_PATH=/demo"));
assert.ok(unit.includes("BJJ_WAIVER_SUBMISSIONS=1"));
assert.ok(unit.includes("BJJ_WAITLIST=1"));
assert.ok(unit.includes("User=bjj-demo"));
assert.ok(unit.includes("InaccessiblePaths=/var/lib/bjj-planner/data.db"));
assert.equal(unit.includes("DEMO_STAFF_PASSWORD"), false);
assert.equal(unit.includes("DEMO_PASSWORD_DAKOTA"), false);
assert.equal(unit.includes("DEMO_PASSWORD_PIERRE"), false);
assert.equal(unit.includes("8766"), false);

const nginx = read("deploy/nginx-demo.conf");
assert.ok(nginx.includes("location /demo/api/"));
assert.ok(nginx.includes("proxy_pass http://127.0.0.1:8767/api/;"));
assert.ok(nginx.includes("X-Robots-Tag"));
assert.ok(nginx.includes("return 302 /demo/login/;"));
assert.equal(nginx.includes("8766"), false);
assert.equal(nginx.includes("data.db"), false);

const prod = read("deploy/nginx-bjj.conf");
assert.equal(prod.includes("8767"), false);
assert.ok(prod.includes("proxy_pass http://127.0.0.1:8766;"));

const setup = read("deploy/demo/setup.sh");
const pull = read("deploy/demo/pull.sh");
assert.ok(setup.includes("DEMO_BRANCH:-cursor/adult-home-c3e3"));
assert.ok(setup.includes("DEMO_PASSWORD_DAKOTA"));
assert.ok(setup.includes("DEMO_PASSWORD_PIERRE"));
assert.ok(setup.includes("/root/bjj-demo-credentials"));
assert.ok(setup.includes("0o600"));
assert.equal(setup.includes('echo "$DEMO_PASSWORD_DAKOTA"'), false);
assert.equal(setup.includes('echo "$DEMO_PASSWORD_PIERRE"'), false);
assert.equal(setup.includes("DEMO_STAFF_PASSWORD"), false);
assert.ok(setup.includes("cursor/demo-preview-c3e3"));
assert.equal(/systemctl restart bjj-planner(?!-demo)/.test(setup), false);
assert.equal(/systemctl restart bjj-planner(?!-demo)/.test(pull), false);
assert.ok(pull.includes("systemctl restart bjj-planner-demo.service"));
assert.ok(read("deploy/demo/ROLLBACK.md").includes("/var/lib/bjj-planner/data.db"));
assert.equal(read("server/demoseed.py").includes("correct-horse"), false);
assert.equal(read("server/demoseed.py").includes("DEMO_STAFF_PASSWORD"), false);
assert.equal(read("server/demoseed.py").includes("DEMO_PASSWORD_DAKOTA="), false);
assert.equal(read("server/demoseed.py").includes("DEMO_PASSWORD_PIERRE="), false);
assert.ok(read("deploy/demo/ROLLBACK.md").includes("/root/bjj-demo-credentials"));

console.log("demo checks passed");
