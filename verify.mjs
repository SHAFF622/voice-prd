// Headless verification: load the dashboard in real Chrome, capture console
// errors + failed requests, exercise the fallback panel, screenshot the result.
import puppeteer from "puppeteer-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = "http://localhost:8000/?s=verify";

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle",
         "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 820, deviceScaleFactor: 1 });

const errors = [], failed = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));
page.on("requestfailed", r => failed.push(`${r.url()} :: ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));

// reset, then run the full fallback script through the real UI
await page.evaluate(() => fetch("/api/reset/verify", { method: "POST" }));
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => document.getElementById("runAll").click());
await new Promise(r => setTimeout(r, 7000)); // let all 5 steps fire + animate

// The card column was removed (structured data lives in export.md now); assert the captured
// PRD via the API + the header counter instead of counting card DOM nodes.
const state = await page.evaluate(async () => {
  const prd = await fetch("/api/prd/verify").then(r => r.json());
  return {
    reqs: prd.requirements.length,
    models: prd.data_models.length,
    integrations: prd.integrations.length,
    gates: prd.compliance.length,
    counter: document.getElementById("count")?.textContent,
    stage: document.getElementById("stage")?.textContent,
    canvasHasGL: (() => { const c = document.getElementById("scene");
      return !!(c && (c.getContext("webgl2") || c.getContext("webgl"))); })(),
    threeNodes: window.SCENE ? "SCENE present" : "SCENE MISSING",
    vapiLoaded: typeof window.Vapi,
    gsapLoaded: typeof window.gsap,
  };
});

await page.evaluate(() => document.getElementById("panel").classList.add("open"));
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: "verify.png" });

console.log("=== CONSOLE ERRORS ===", errors.length ? errors : "none");
console.log("=== FAILED REQUESTS ===", failed.length ? failed : "none");
console.log("=== DOM STATE ===", JSON.stringify(state, null, 2));

await browser.close();
