// equestrian3d 端到端驗證:標準賽全綠區跳完(Clear Round)→ 全程不按(碰桿罰分)→ 決勝圈模式切換
// 用法:node scripts/verify-equestrian.mjs <url> <outDir>
import { chromium } from "playwright";

const [url, outDir] = process.argv.slice(2);
const EXE = process.env.CHROME_EXE ||
  "C:/Users/agape250/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
const errors = [];
const results = {};
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load", timeout: 25000 });
await page.bringToFront();
await page.waitForTimeout(1200);

const G = "__equestrian3d";

// 掛一個「完美騎士」自動駕駛:每幀檢查,理想起跳點進綠區就 jump()
const runCourse = (mode, autopilot) => page.evaluate(async ([g, m, auto]) => {
  const game = window[g];
  // 走真 UI 選模式卡+開始
  document.querySelector(`.mode-card[data-mode="${m}"]`).click();
  document.querySelector("#startMatchButton").click();
  await new Promise((r) => setTimeout(r, 300));
  game.jump(); // 出發
  const t0 = performance.now();
  while (game.phase !== "ended" && performance.now() - t0 < 120000) {
    if (auto && game.phase === "riding") {
      const fence = game.fences[game.fenceIdx];
      if (fence) {
        const dtf = fence.dist - game.dist;
        const err = Math.abs(dtf - 2.6) / Math.max(game.speed, 1);
        if (dtf <= 14 && err <= 0.08) game.jump(); // 比最窄綠區還準
      }
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  return {
    phase: game.phase,
    faults: game.faults,
    clears: game.clears,
    elapsed: Math.round(game.elapsed * 10) / 10,
    overlay: { ...game.overlay },
    fenceCount: game.fences.length,
  };
}, [G, mode, autopilot]);

// —— 場景巡禮截圖(選單軌道鏡頭) ——
await page.waitForTimeout(800);
await page.screenshot({ path: outDir + "/eq-menu.png" });

// —— 標準賽:完美騎士 → 應 Clear Round ——
results.clearRun = await runCourse("standard", true);
await page.screenshot({ path: outDir + "/eq-finish-clear.png" });

// —— 回首頁,全程不按 → 馬自己弱跳,應吃罰分 ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
results.knockRun = await runCourse("standard", false);
await page.screenshot({ path: outDir + "/eq-finish-knock.png" });

// —— 決勝圈:模式切換+完賽 ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
results.jumpoffRun = await runCourse("jumpoff", true);

// —— 騎行中截圖(重新開一場,跑 4 秒抓跟隨視角+起跳) ——
await page.evaluate(() => document.querySelector("#overlayMenuButton").click());
await page.waitForTimeout(400);
// 換毛色(白馬)再開一場——驗 setHorseCoat 生效
await page.selectOption("#horseCoatSelect", "white");
results.coatAfterSelect = await page.evaluate((g) => window[g].coatId, G);
await page.evaluate((g) => {
  document.querySelector('.mode-card[data-mode="standard"]').click();
  document.querySelector("#startMatchButton").click();
  setTimeout(() => window[g].jump(), 200);
}, G);
await page.waitForTimeout(4200);
await page.screenshot({ path: outDir + "/eq-riding.png" });
// 抓騰空瞬間:等進 approach 再跳,於半空截圖
await page.evaluate(async (g) => {
  const game = window[g];
  const t0 = performance.now();
  while (game.phase === "riding" && performance.now() - t0 < 30000) {
    const fence = game.fences[game.fenceIdx];
    if (fence && fence.dist - game.dist <= 3.2) { game.jump(); break; }
    await new Promise((r) => setTimeout(r, 16));
  }
  await new Promise((r) => setTimeout(r, 180)); // 半空
}, G);
await page.screenshot({ path: outDir + "/eq-airborne.png" });

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
