/* Welcome-page gi section and home-practice video. No browser required. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "kids/index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");

assert.ok(html.includes("Get your gi"));
assert.ok(html.includes("Loaner gis are available the first week."));
assert.ok(html.includes('href="https://a.co/d/010Etpyq" target="_blank" rel="noopener noreferrer"'));
assert.ok(html.includes("Shop the recommended gi on Amazon"));
assert.ok(html.includes("Order by the Elite Sports size chart below."));
assert.ok(html.includes("Don't order by their current gi size"));
assert.ok(!html.includes("What to bring"));

for (const row of [
  ["C000", "3'4\"–3'8\"", "35–50 lbs"],
  ["00", "3'8\"–3'11\"", "50–60 lbs"],
  ["0", "3'11\"–4'3\"", "60–70 lbs"],
  ["1", "4'3\"–4'7\"", "70–80 lbs"],
  ["2", "4'7\"–4'10\"", "80–90 lbs"],
  ["3", "4'10\"–5'2\"", "90–120 lbs"]
]) {
  row.forEach((cell) => assert.ok(html.includes(cell), cell));
}
assert.ok(html.includes("<table class=\"size-chart\">"));
assert.equal((html.match(/<th scope="row">/g) || []).length, 6);

const photos = [
  "01-ibjjf-approved",
  "02-pearl-fabric",
  "03-technical-features",
  "04-free-white-belt",
  "05-size-guide"
];
photos.forEach((name) => {
  assert.ok(html.includes(`/img/gi/${name}-600.jpg 600w`), name);
  assert.ok(html.includes(`/img/gi/${name}-1000.jpg 1000w`), name);
  assert.ok(fs.existsSync(path.join(root, "img/gi", `${name}-600.jpg`)), name);
  assert.ok(fs.existsSync(path.join(root, "img/gi", `${name}-1000.jpg`)), name);
});
assert.equal((html.match(/loading="lazy"/g) || []).length, 6);

assert.ok(html.includes("Practice at home"));
assert.ok(html.includes("https://www.youtube-nocookie.com/embed/QPy386CpuQg?autoplay=1"));
assert.ok(html.includes('frame.title = "How to Practice Jiu Jitsu with Your Kids | Parent-Child BJJ Games & Drills"'));
assert.ok(html.includes("https://www.youtube.com/watch?v=QPy386CpuQg"));
assert.ok(html.includes("https://i.ytimg.com/vi/QPy386CpuQg/hqdefault.jpg"));
assert.ok(html.includes('loading="lazy"'));
assert.ok(html.includes('aria-label="Play video"'));
assert.ok(html.includes('class="video-play"'));
assert.ok(html.includes('fill="currentColor"'));
assert.equal(html.includes("video-play-label"), false);
assert.equal(html.includes(">Play</span>"), false);
const playCss = fs.readFileSync(path.join(root, "css/splash.css"), "utf8");
const playRule = playCss.slice(playCss.indexOf(".video-play {"), playCss.indexOf(".video-fallback"));
assert.ok(playRule.includes("border-radius: 50%"));
assert.ok(playRule.includes("width: 72px"));
assert.ok(playRule.includes("height: 72px"));
assert.ok(playRule.includes("translate(-50%, -50%)"));
assert.ok(playRule.includes("translateX(3px)"));
assert.ok(playRule.includes(".video-facade:hover .video-play"));
assert.ok(playRule.includes(".video-facade:active .video-play"));
assert.ok(playRule.includes(".video-facade:focus-visible .video-play"));
assert.ok(playCss.includes(".video-play { width: 60px; height: 60px; }"));
assert.equal(playCss.includes("video-play-label"), false);
assert.equal(playRule.includes("Luckiest Guy"), false);

const publicList = sw.split("const PUBLIC_ASSETS")[1].split("const STAFF_ASSETS")[0];
assert.equal(publicList.includes("/img/gi/"), false);
assert.ok(sw.includes('path.startsWith("/img/gi/")'));
assert.equal((sw.match(/"\/api\//g) || []).length, 1);
assert.ok(sw.includes('const VERSION = "20261023-41"'));

console.log("welcome gi checks passed");
