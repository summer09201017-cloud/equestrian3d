import "./styles.css";
import { EquestrianGame, GAME_MODES } from "./game.js";
import { AudioManager } from "./audio.js";
import { speakLine, setVoiceEnabled } from "./voice.js";
import { hasSavedGame, loadSettings, saveSettings } from "./storage.js";

const ui = {
  canvas: document.querySelector("#gameCanvas"),
  cameraButton: document.querySelector("#cameraButton"),
  faultsLabel: document.querySelector("#faultsLabel"),
  clearsLabel: document.querySelector("#clearsLabel"),
  modeCode: document.querySelector("#modeCode"),
  fenceLabel: document.querySelector("#fenceLabel"),
  timeLabel: document.querySelector("#timeLabel"),
  lastFenceLabel: document.querySelector("#lastFenceLabel"),
  phaseLabel: document.querySelector("#phaseLabel"),
  statusMessage: document.querySelector("#statusMessage"),
  modeLabel: document.querySelector("#modeLabel"),
  difficultyLabel: document.querySelector("#difficultyLabel"),
  timeAllowedLabel: document.querySelector("#timeAllowedLabel"),
  nextFenceLabel: document.querySelector("#nextFenceLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  audioStatus: document.querySelector("#audioStatus"),
  saveStatus: document.querySelector("#saveStatus"),
  installButton: document.querySelector("#installButton"),
  installHint: document.querySelector("#installHint"),
  loadButton: document.querySelector("#loadButton"),
  menuButton: document.querySelector("#menuButton"),
  audioButton: document.querySelector("#audioButton"),
  pauseButton: document.querySelector("#pauseButton"),
  touchControls: document.querySelector("#touchControls"),
  speedMeterFill: document.querySelector("#speedMeterFill"),
  staminaFill: document.querySelector("#staminaFill"),
  staminaValue: document.querySelector("#staminaValue"),
  speedMeterText: document.querySelector("#speedMeterText"),
  approachFill: document.querySelector("#approachFill"),
  approachValue: document.querySelector("#approachValue"),
  matchOverlay: document.querySelector("#matchOverlay"),
  overlayEyebrow: document.querySelector("#overlayEyebrow"),
  overlayTitle: document.querySelector("#overlayTitle"),
  overlayText: document.querySelector("#overlayText"),
  resumeButton: document.querySelector("#resumeButton"),
  overlayMenuButton: document.querySelector("#overlayMenuButton"),
  homeScreen: document.querySelector("#homeScreen"),
  modeCardGrid: document.querySelector("#modeCardGrid"),
  modeDescription: document.querySelector("#modeDescription"),
  menuDifficultySelect: document.querySelector("#menuDifficultySelect"),
  horseCoatSelect: document.querySelector("#horseCoatSelect"),
  riderSelect: document.querySelector("#riderSelect"),
  stageSelect: document.querySelector("#stageSelect"),
  opponentSelect: document.querySelector("#opponentSelect"),
  audioSelect: document.querySelector("#audioSelect"),
  modeMetaTitle: document.querySelector("#modeMetaTitle"),
  modeMetaGoal: document.querySelector("#modeMetaGoal"),
  startMatchButton: document.querySelector("#startMatchButton"),
  commentaryBar: document.querySelector("#commentaryBar"),
  continueSavedButton: document.querySelector("#continueSavedButton"),
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setEnabled(settings.audioEnabled !== false);

const game = new EquestrianGame({
  canvas: ui.canvas,
  touchRoot: ui.touchControls,
});
window.__equestrian3d = game; // dev hook:Playwright 凍結畫面/數值驗證用
window.__game = game; // /smoke3d 通用鉤子

let selectedModeId = game.modeId;
let selectedDifficulty = game.difficulty;
let selectedCoat = game.coatId;
let selectedRider = game.riderId;
let selectedStage = game.stageId;
let selectedOpponent = game.opponentId;
let audioEnabled = settings.audioEnabled !== false;

function persistSettings() {
  saveSettings({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
    riderCharacter: selectedRider,
    stage: selectedStage,
    opponent: selectedOpponent,
    audioEnabled,
  });
}

function setMeterFill(element, value) {
  element.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
}

function setAudioState(enabled) {
  audioEnabled = enabled;
  audio.setEnabled(enabled);
  setVoiceEnabled(enabled);
  ui.audioStatus.textContent = enabled ? "開啟" : "靜音";
  ui.audioButton.textContent = enabled ? "音效開啟" : "音效靜音";
  ui.audioSelect.value = enabled ? "on" : "off";
  persistSettings();
}

function syncMenuCards() {
  for (const button of ui.modeCardGrid.querySelectorAll(".mode-card")) {
    button.classList.toggle("selected", button.dataset.mode === selectedModeId);
  }
  const mode = GAME_MODES[selectedModeId];
  ui.modeDescription.textContent = mode.description;
  ui.modeMetaTitle.textContent = mode.label;
  ui.modeMetaGoal.textContent = mode.goal;
}

function syncMenuControls() {
  ui.menuDifficultySelect.value = selectedDifficulty;
  ui.horseCoatSelect.value = selectedCoat;
  ui.riderSelect.value = selectedRider;
  ui.stageSelect.value = selectedStage;
  ui.opponentSelect.value = selectedOpponent;
  syncMenuCards();
}

function syncGameConfigurationToMenu() {
  selectedModeId = game.modeId;
  selectedDifficulty = game.difficulty;
  selectedCoat = game.coatId;
  selectedRider = game.riderId;
  selectedStage = game.stageId;
  selectedOpponent = game.opponentId;
  syncMenuControls();
}

function syncOverlay(overlay) {
  ui.matchOverlay.classList.toggle("visible", overlay.visible);
  ui.overlayEyebrow.textContent = overlay.eyebrow;
  ui.overlayTitle.textContent = overlay.title;
  ui.overlayText.textContent = overlay.text;
  ui.resumeButton.hidden = !overlay.canResume;
}

function openHomeScreen() {
  game.openHomeMenu();
  audio.stopCrowd();
  syncGameConfigurationToMenu();
  ui.homeScreen.classList.add("visible");
}

function closeHomeScreen() {
  ui.homeScreen.classList.remove("visible");
}

function unlockAudio() {
  audio.unlock();
}

// —— 中文播報:畫面字幕條+預烤 mp3 人聲同步唸(人聲鐵律:沒烤過的句子只出字幕) ——
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function pushCommentary(text, tone = "info", spoken = text) {
  const bar = ui.commentaryBar;
  if (!bar || !text) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = text;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  speakLine(spoken);
}

function handleGameEvent(event) {
  switch (event.type) {
    case "match-start": {
      audio.whistle();
      audio.startCrowd(); // 馬術是滿場觀眾的競技場——環境音照鐵則開
      audio.vibrate(18);
      pushCommentary("歡迎來到馬術障礙賽!控好節奏,綠區起跳!");
      break;
    }
    case "gate": {
      audio.buzzer();
      audio.vibrate(14);
      pushCommentary("出發!穩住節奏,盯住第一道欄!");
      break;
    }
    case "jump":
      audio.swish();
      audio.vibrate(12);
      break;
    case "fence-clear": {
      audio.scoreSting();
      audio.crowdCheer(event.perfect ? 0.8 : 0.4);
      audio.vibrate([25, 15, 35]);
      const line = event.perfect
        ? { sub: `第 ${event.idx} 欄——完美起跳!輕鬆飛過!`, say: "漂亮!完美起跳,輕鬆飛過!" }
        : pick([
            { sub: `第 ${event.idx} 欄——乾淨過欄!`, say: "好一跳!乾乾淨淨!" },
            { sub: `第 ${event.idx} 欄——過了,節奏很穩!`, say: "過欄成功,節奏很穩!" },
          ]);
      pushCommentary(line.sub, event.perfect ? "hot" : "info", line.say);
      break;
    }
    case "fence-knock": {
      audio.thud(0.8);
      audio.vibrate([50, 30, 50]);
      pushCommentary(`第 ${event.idx} 欄碰桿!罰分 ${event.faults}。`, "cool", "哎呀,碰桿了,加四個罰分。");
      break;
    }
    case "fence-early": {
      audio.rebound();
      pushCommentary("太早起跳了——等時機條進綠區再跳!", "cool", "太早起跳了,穩住再來。");
      break;
    }
    case "race-end": {
      try { if (!['localhost','127.0.0.1'].includes(location.hostname)) {   // -done:玩完一局(t=本局秒數,/stats 使用次數與平均停留吃這個)
        var __dt = Math.round((Date.now() - (window.__matchT0 || Date.now())) / 1000);
        navigator.sendBeacon?.('https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=equestrian3d-done&t=' + __dt);
      } } catch (_) {}
      audio.horn();
      audio.crowdCheer(event.win ? 1 : 0.5);
      audio.vibrate([110, 50, 120]);
      pushCommentary(
        event.win ? "第一個衝線!" + event.elapsed.toFixed(1) + " 秒!" : "AI 先到了——再來一場!",
        event.win ? "hot" : "cool",
        event.win ? "零罰分!完美的一輪,全場歡呼!" : "全程完成!辛苦了,好騎士!",
      );
      break;
    }
    case "finish": {
      audio.horn();
      audio.crowdCheer(event.clearRound ? 1 : 0.6);
      audio.vibrate([110, 50, 120]);
      pushCommentary(
        event.clearRound
          ? `Clear Round!零罰分,${event.elapsed.toFixed(1)} 秒!`
          : `完賽!罰分 ${event.faults},${event.elapsed.toFixed(1)} 秒。`,
        event.clearRound ? "hot" : "info",
        event.clearRound ? "零罰分!完美的一輪,全場歡呼!" : "全程完成!辛苦了,好騎士!",
      );
      ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";
      break;
    }
    default:
      break;
  }
}

game.onEvent = handleGameEvent;

game.onHudUpdate = (state) => {
  ui.faultsLabel.textContent = String(state.faults);
  ui.clearsLabel.textContent = String(state.clears);
  ui.modeCode.textContent = ({ 標準賽: "標準", 決勝圈: "決勝", 雙騎競速: "競速", 自由奔跑賽: "奔跑", 練習場: "練習" })[state.modeLabel] || state.modeLabel;
  ui.fenceLabel.textContent = state.endless ? `${state.fenceIdx}/${state.fenceCount}·圈${state.lap}` : `${state.fenceIdx}/${state.fenceCount}`;
  ui.timeLabel.textContent = state.timeText;
  ui.lastFenceLabel.textContent =
    state.lastResult === null ? "—" : state.lastResult === "clear" ? "過!" : state.lastResult === "knock" ? "碰桿" : "早跳";
  ui.phaseLabel.textContent = state.phaseLabel;
  ui.statusMessage.textContent = state.message;
  ui.modeLabel.textContent = state.modeLabel;
  ui.difficultyLabel.textContent = state.difficultyLabel;
  ui.timeAllowedLabel.textContent = state.timeAllowed;
  ui.nextFenceLabel.textContent = state.nextFenceText;
  ui.speedLabel.textContent = state.speedText;
  ui.speedMeterText.textContent = state.speedText;
  setMeterFill(ui.speedMeterFill, state.speed01);
  if (ui.staminaFill && state.stamina01 !== undefined) {
    setMeterFill(ui.staminaFill, state.stamina01);
    ui.staminaValue.textContent = `${Math.round(state.stamina01 * 100)}%${state.turbo ? " ⚡" : ""}`;
  }
  ui.approachValue.textContent = state.approach01 > 0 ? (state.inWindow ? "綠區!跳!" : "接近中…") : "—";
  setMeterFill(ui.approachFill, state.approach01);
  { // 中下方大時機條(07-14 拍板規格):接近欄架才顯示;進綠區=full 發光
    const bp = document.getElementById("bigPower"), bf = document.getElementById("bigPowerFill");
    if (bp) {
      bp.hidden = !(state.approach01 > 0);
      bf.style.transform = `scaleX(${Math.min(1, state.approach01)})`;
      bf.classList.toggle("full", state.inWindow);
    }
  }
  // 競速小地圖:路線灰線+欄架白點+我(紅)+AI(藍)
  {
    const mm = document.getElementById("miniMap");
    const showMap = state.modeLabel === "雙騎競速" && state.phaseLabel !== "主選單";
    mm.hidden = !showMap;
    if (showMap) {
      const ctx = mm.getContext("2d");
      const d = game.getMinimapData();
      ctx.clearRect(0, 0, mm.width, mm.height);
      const sx = (x) => ((x + 38) / 76) * mm.width;
      const sy = (z) => ((z + 28) / 56) * mm.height;
      ctx.strokeStyle = "rgba(255,255,255,.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      d.path.forEach(([x, z], i) => (i ? ctx.lineTo(sx(x), sy(z)) : ctx.moveTo(sx(x), sy(z))));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,.8)";
      for (const [x, z] of d.fences) {
        ctx.fillRect(sx(x) - 1.5, sy(z) - 1.5, 3, 3);
      }
      if (d.ai) {
        ctx.fillStyle = "#4d9fff";
        ctx.beginPath();
        ctx.arc(sx(d.ai[0]), sy(d.ai[1]), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ff5544";
      ctx.beginPath();
      ctx.arc(sx(d.me[0]), sy(d.me[1]), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // 領先/落後字
      ctx.fillStyle = "#ffe9ad";
      ctx.font = "bold 12px system-ui";
      ctx.fillText(state.timeAllowed, 8, 16);
    }
  }
  syncOverlay(state.overlay);
};

syncGameConfigurationToMenu();
setAudioState(audioEnabled);
ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";

ui.modeCardGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".mode-card");
  if (!button) return;
  unlockAudio();
  audio.uiTap();
  selectedModeId = button.dataset.mode;
  syncMenuCards();
  persistSettings();
});

ui.menuDifficultySelect.addEventListener("change", (event) => {
  selectedDifficulty = event.target.value;
  persistSettings();
});

ui.horseCoatSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedCoat = event.target.value;
  game.setHorseCoat(selectedCoat); // 立即換色(選單背景就看得到)
  persistSettings();
});

ui.riderSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedRider = event.target.value;
  game.setRiderCharacter(selectedRider); // 立即換人(選單背景就看得到)
  persistSettings();
});

ui.stageSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedStage = event.target.value;
  game.setStage(selectedStage); // 立即換賽段(選單背景就看得到新世界)
  persistSettings();
});

ui.opponentSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  selectedOpponent = event.target.value;
  game.setOpponent(selectedOpponent); // 立即換對手(選單背景就看得到)
  persistSettings();
});

ui.audioSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  setAudioState(event.target.value === "on");
});

ui.startMatchButton.addEventListener("click", () => {
  window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間
  unlockAudio();
  audio.uiTap();
  game.applyPresentation({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    horseCoat: selectedCoat,
    riderCharacter: selectedRider,
    stage: selectedStage,
    opponent: selectedOpponent,
  });
  game.startSelectedMatch();
  closeHomeScreen();
});

function loadIntoUi() {
  const loaded = game.loadGame();
  syncGameConfigurationToMenu();
  ui.saveStatus.textContent = loaded && hasSavedGame() ? "已記錄" : "尚無";
}

ui.continueSavedButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  loadIntoUi();
});

ui.loadButton.addEventListener("click", loadIntoUi);

ui.menuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.overlayMenuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.cameraButton.addEventListener("click", () => {
  game.cycleCameraView();
});

ui.audioButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  setAudioState(!audioEnabled);
});

ui.pauseButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.togglePause();
});

ui.resumeButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.resume();
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio, { passive: true });

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  ui.installButton.hidden = false;
  ui.installHint.textContent = "已偵測到可安裝版本，點一下就能加入主畫面。";
});

ui.installButton.addEventListener("click", async () => {
  unlockAudio();
  audio.uiTap();
  if (!deferredInstallPrompt) {
    ui.installHint.textContent = "如果是 iPhone，請用分享選單的「加入主畫面」。";
    return;
  }
  deferredInstallPrompt.prompt();
  const outcome = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  ui.installButton.hidden = true;
  ui.installHint.textContent =
    outcome.outcome === "accepted" ? "安裝要求已送出。" : "你可以之後再安裝。";
});

window.addEventListener("appinstalled", () => {
  ui.installButton.hidden = true;
  ui.installHint.textContent = "已安裝到裝置。";
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.saveGame(true);
  }
});

// dev(localhost)不註冊 SW——SW 快取會讓每次改動都吃到「上一版」(07-11 踩雷)
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      ui.installHint.textContent = "Service Worker 註冊失敗，但仍可直接遊玩。";
    });
  });
}

game.start();
