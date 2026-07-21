// equestrian3d「idle 生動」獨立 Playwright 驗證(07-21):
// ①採樣數秒證實騎手 headGroup 會轉頭、觀眾手臂會舉放(人浪) ②0 pageerror / 0 console error
// ③截圖:臉部特寫 / 觀眾舉手人浪 / 全景 → scripts/shots/
// 用法:先起 `npx vite preview --port 5425 --strictPort`,再 `node scripts/verify-idle.mjs`
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = "http://localhost:5425/";
const OUT = new globalThis.URL("./shots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(URL, { waitUntil: "load", timeout: 25000 });
await page.bringToFront(); // 背景分頁 RAF 掉到 1fps,採樣會像凍結
await page.waitForTimeout(1500);

const G = "__equestrian3d";

// —— 選單巡禮鏡頭下採樣 6 秒:騎手 headGroup.rotation.y 與觀眾手臂 pivot.rotation.x 要有變化 ——
const sample = await page.evaluate(async (g) => {
  const game = window[g];
  const heads = [];
  const arms = [];
  const rigs = [];
  // 用「遊戲時間」計採樣長度:headless RAF 低於 60fps 時 delta 被 0.05 夾住,
  // 遊戲時間走得比真實時間慢——採到 game.time 前進 ≥6s(手臂正弦週期 2.62s 的兩倍多)為止
  const gt0 = game.time;
  const t0 = performance.now();
  while (game.time - gt0 < 6 && performance.now() - t0 < 30000) {
    heads.push(game.rider.headGroup.rotation.y);
    arms.push(game.crowdFigures.map((c) => c.fig.leftArm.pivot.rotation.x));
    rigs.push(game.crowdFigures.map((c) => c.fig.rig.position.y));
    await new Promise((r) => setTimeout(r, 120));
  }
  const span = (a) => Math.max(...a) - Math.min(...a);
  const colSpan = (rows, i) => span(rows.map((row) => row[i]));
  const n = game.crowdFigures.length;
  const armSpans = Array.from({ length: n }, (_, i) => colSpan(arms, i));
  // 人浪錯開:同一瞬間各觀眾手臂角度不該一致(取中間一幀的離散度)
  const mid = arms[Math.floor(arms.length / 2)];
  return {
    crowdCount: n,
    headSpan: span(heads), // 騎手轉頭幅度(rad)
    armSpanMin: Math.min(...armSpans), // 每位觀眾手臂擺動幅度最小值
    armSpread: span(mid), // 同一瞬間人浪相位差
    hopSpan: colSpan(rigs, 0), // 觀眾踮腳
    headGroupOk: !!(game.rider.headGroup && game.aiRider && game.aiRider.headGroup),
  };
}, G);

// —— 開一場標準賽(收掉首頁選單,canvas 才看得到),之後鏡頭全手動 ——
await page.evaluate(() => {
  document.querySelector('.mode-card[data-mode="standard"]').click();
  document.querySelector("#startMatchButton").click();
});
await page.waitForTimeout(600);
await page.evaluate((g) => { window[g].updateCamera = () => {}; }, G); // 凍結內建鏡頭(僅本頁生命週期)

// —— 截圖①臉部特寫:等到 idle「看一下」視窗(headGroup 轉出 >0.25 rad)再把鏡頭湊到臉前 2.2m ——
await page.evaluate(async (g) => {
  const game = window[g];
  const t0 = performance.now();
  while (Math.abs(game.rider.headGroup.rotation.y) < 0.25 && performance.now() - t0 < 20000) {
    await new Promise((r) => setTimeout(r, 60));
  }
  // 騎手頭中心 ≈ 馬原點上方 3.03m(鞍座 1.02 + 頭 2.12×0.95);鏡頭在臉前 2.2m 同高
  const p = game.horse.group.position;
  const yaw = game.horse.group.rotation.y;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  game.camera.position.set(p.x + fx * 2.2, p.y + 3.1, p.z + fz * 2.2);
  game.camera.lookAt(p.x, p.y + 3.0, p.z);
}, G);
await page.screenshot({ path: OUT + "face-closeup.png" });

// —— 截圖②觀眾舉手人浪:鏡頭對準 -z 側看台前排 ——
await page.evaluate((g) => {
  const game = window[g];
  game.camera.position.set(-14, 2.8, -28); // 斜角看整排看台,一次收多位觀眾
  game.camera.lookAt(-2, 1.6, -38.2);
}, G);
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "crowd-wave.png" });

// —— 截圖③全景 ——
await page.evaluate((g) => {
  const game = window[g];
  game.camera.position.set(40, 18, 40);
  game.camera.lookAt(0, 1, 0);
}, G);
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "overview.png" });

const pass =
  errors.length === 0 &&
  sample.headGroupOk &&
  sample.headSpan > 0.15 && // 騎手確實轉頭(預設 yaw 0.6)
  sample.armSpanMin > 0.8 && // 每位觀眾都在舉放手臂(armDown -0.5 ↔ armUp -2.9)
  sample.armSpread > 0.3 && // 人浪相位確實錯開
  sample.crowdCount === 14;

console.log(JSON.stringify({ pass, sample, errors }, null, 2));
await browser.close();
process.exit(pass ? 0 : 1);
