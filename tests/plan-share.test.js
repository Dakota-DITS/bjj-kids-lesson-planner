/* Share a lesson plan as a PDF file. Desktops download it; phones use the share sheet. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const P = require("../js/plan-math.js");
const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "app/index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "server/httpapp.py"), "utf8");

const NOTE =
  "Your browser can't share files directly. The PDF was downloaded so you can attach it to a text or email.";

assert.strictEqual(P.SHARE_FALLBACK_NOTE, NOTE);

assert.strictEqual(P.planPdfFilename("2026-10-27", "mite"), "grace-bjj-plan-2026-10-27-mite.pdf");
assert.strictEqual(P.planPdfFilename("2026-10-27", "mite+upper"), "grace-bjj-plan-2026-10-27-mite+upper.pdf");
assert.strictEqual(P.planPdfFilename("2026-10-27", "Mite"), "grace-bjj-plan-2026-10-27-mite.pdf");
assert.strictEqual(P.planPdfFilename("10/27/2026", "mite"), "grace-bjj-plan-undated-mite.pdf");
assert.strictEqual(P.planPdfFilename("", ""), "grace-bjj-plan-undated-class.pdf");
assert.strictEqual(P.planPdfFilename("2026-10-27", "Mighty Mites!"), "grace-bjj-plan-2026-10-27-mightymites.pdf");

const file = { name: "grace-bjj-plan-2026-10-27-mite.pdf", type: "application/pdf" };

async function fallback() {
  let shared = false;
  let downloaded = null;
  const result = await P.deliverPlanPdf(file, {
    title: "Mighty Mites",
    text: "Tuesday plan",
    canShare: () => false,
    share: () => {
      shared = true;
    },
    download: (got) => {
      downloaded = got;
    },
  });
  assert.strictEqual(shared, false, "fallback must not open the share sheet");
  assert.strictEqual(downloaded, file);
  assert.deepStrictEqual(result, { downloaded: true, note: NOTE });
}

async function shareSheet() {
  let downloaded = false;
  let payload = null;
  const result = await P.deliverPlanPdf(file, {
    title: "Mighty Mites",
    text: "Tuesday plan",
    canShare: (data) => {
      assert.strictEqual(data.files[0], file);
      return true;
    },
    share: (data) => {
      payload = data;
    },
    download: () => {
      downloaded = true;
    },
  });
  assert.strictEqual(downloaded, false);
  assert.deepStrictEqual(result, { shared: true });
  assert.strictEqual(payload.files[0], file);
  assert.strictEqual(payload.title, "Mighty Mites");
  assert.strictEqual(payload.text, "Tuesday plan");
}

async function cancelSheet() {
  let downloaded = false;
  const err = new Error("Share canceled");
  err.name = "AbortError";
  const result = await P.deliverPlanPdf(file, {
    canShare: () => true,
    share: () => Promise.reject(err),
    download: () => {
      downloaded = true;
    },
  });
  assert.strictEqual(downloaded, false);
  assert.deepStrictEqual(result, { cancelled: true });
}

async function canShareThrows() {
  let downloaded = null;
  const result = await P.deliverPlanPdf(file, {
    canShare: () => {
      throw new Error("not implemented");
    },
    share: () => {
      throw new Error("share should not run");
    },
    download: (got) => {
      downloaded = got;
    },
  });
  assert.strictEqual(downloaded, file);
  assert.strictEqual(result.note, NOTE);
}

async function otherShareError() {
  let downloaded = false;
  const err = Object.assign(new Error("nope"), { name: "NotAllowedError" });
  await assert.rejects(
    () =>
      P.deliverPlanPdf(file, {
        canShare: () => true,
        share: () => Promise.reject(err),
        download: () => {
          downloaded = true;
        },
      }),
    (caught) => caught.name === "NotAllowedError"
  );
  assert.strictEqual(downloaded, false);
}

const bytes = P.buildPlanPdf([
  { kind: "title", text: "Grace Kids BJJ" },
  { kind: "section", text: "Technique — Knee cut" },
  { kind: "item", text: "5:30–5:40 Knee cut Age override" },
  { kind: "body", text: "Step (1) from closed guard." },
  { kind: "break" },
  { kind: "title", text: "My First Gi" },
]);
assert.ok(bytes instanceof Uint8Array);
const pdf = Buffer.from(bytes).toString("latin1");
assert.ok(pdf.startsWith("%PDF-1.4"));
assert.ok(pdf.includes("Age override"), "age override tag is in the PDF");
assert.ok(pdf.includes("Knee cut"));
assert.ok(pdf.includes("My First Gi"));
assert.ok(pdf.includes("%%EOF"));
assert.ok(pdf.includes("/MediaBox [0 0 612 792]"));
const xrefAt = Number(pdf.slice(pdf.lastIndexOf("startxref\n") + "startxref\n".length).split("\n")[0]);
assert.strictEqual(pdf.slice(xrefAt, xrefAt + 4), "xref");
assert.ok(pdf.includes("/Count 2"), "the coloring sheet starts a second page");

const many = P.buildPlanPdf(Array.from({ length: 80 }, (_, i) => ({ kind: "body", text: `Line ${i} stays on the plan.` })));
const manyPdf = Buffer.from(many).toString("latin1");
assert.ok(!manyPdf.includes("/Count 1"), "a long plan continues onto another page");
assert.ok(manyPdf.includes("Age") === false || manyPdf.includes("Line 79"));

const printBtn = html.indexOf('id="printBtn"');
const shareBtn = html.indexOf('id="sharePlanBtn"');
assert.ok(printBtn > 0 && shareBtn > printBtn, "Share sits after Print / save PDF");
assert.ok(/id="sharePlanBtn"[^>]*>Share<\/button>/.test(html));
assert.ok(html.slice(printBtn, shareBtn).includes("Print / save PDF"));

assert.ok(app.includes('data-plan-share="${esc(plan.id)}"'), "saved plans can be shared");
assert.ok(app.includes("share.dataset.planShare"), "the saved-plan Share button loads that plan");

const linesFn = app.slice(app.indexOf("function planPrintLines"), app.indexOf("function downloadPlanFile"));
assert.ok(linesFn.includes(".no-print"));
assert.ok(linesFn.includes(".name-live"));
assert.ok(!linesFn.includes("age-override"), "Age override tags stay in the shared PDF");

const shareFn = app.slice(app.indexOf("async function sharePlanPdf"), app.indexOf("async function printBlankCards"));
assert.ok(shareFn.includes("planPdfFilename"));
assert.ok(shareFn.includes("buildPlanPdf"));
assert.ok(shareFn.includes("deliverPlanPdf"));
assert.ok(shareFn.includes("planPrintLines"));
assert.ok(!shareFn.includes("/api/"), "sharing does not publish a plan link");
assert.ok(!/https?:\/\//.test(shareFn), "sharing does not publish a plan link");
assert.ok(!server.includes("/api/plans/share"), "there is no public plan share route");

const toastFn = app.slice(app.indexOf("function toast"), app.indexOf("function passwordChangeError"));
assert.ok(toastFn.includes("7000"), "the download note stays up long enough to read");

Promise.all([fallback(), shareSheet(), cancelSheet(), canShareThrows(), otherShareError()]).then(() => {
  console.log("plan share tests passed");
});
