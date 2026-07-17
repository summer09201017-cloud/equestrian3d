import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";

// —— 3D 馬術障礙賽(equestrian3d)——「騎乘引擎」首發(2026-07-15 拍板:馬術先建家,騎驢進耶路撒冷之後換皮)。
// 照 3d-game-kit:renderer/lights/makePerson 臉部鐵則、相機視角檔+lerp、量值可調、判定=畫面。
// 玩法核心:馬沿賽道自動尋路(CatmullRom 閉環),玩家只管兩件事——
//   ①節奏控速(按住 W/↑ 或「加速」鈕=快步,放開=收步)②綠區時機起跳(空白鍵/點畫面)。
// ★判定=畫面(鐵則4):按下起跳當下就用時機誤差算出「過欄/碰桿」,再把跳躍演出來;
//   桿子只在馬身經過後才落下——畫面說不通的罰分=bug。
// ★溫柔規則:不會摔、不會淘汰;沒按起跳=馬自己弱弱跳過(多半碰桿),永遠跑得完。

// ---------- 可調量值 ----------
// window=起跳時機窗(秒,skijump 綠區同款);boost=加速增量;timeAllowed=容許時間(超時每 4 秒+1 罰分)
export const DIFFICULTY_PRESETS = {
  // 07-15 使用者回報「太容易」→ 全檔收緊:窗更窄、馬更快、時間更緊(幼兒保持友善)
  kids: { baseSpeed: 7.0, boost: 2.5, window: 0.32, fences: 6, timeAllowed: 999, assist: 0.5 },
  child: { baseSpeed: 8.2, boost: 3.0, window: 0.21, fences: 7, timeAllowed: 105, assist: 0.3 },
  easy: { baseSpeed: 9.4, boost: 3.6, window: 0.15, fences: 8, timeAllowed: 82, assist: 0.12 },
  normal: { baseSpeed: 10.6, boost: 4.2, window: 0.105, fences: 9, timeAllowed: 66, assist: 0 },
  hard: { baseSpeed: 11.8, boost: 5.0, window: 0.075, fences: 11, timeAllowed: 56, assist: 0 },
};

export const DIFFICULTY_LABELS = {
  kids: "幼兒(超簡單)",
  child: "兒童(簡單)",
  easy: "入門",
  normal: "標準",
  hard: "職業",
};

export const GAME_MODES = {
  standard: {
    label: "標準賽",
    description: "跳完整條路線——碰桿 +4 罰分、超時再加罰;零罰分=Clear Round!",
    goal: "罰分越少越好",
  },
  jumpoff: {
    label: "決勝圈",
    jumpoff: true,
    description: "縮短路線拼速度:成績=時間+罰分換算秒數,敢加速才會贏。",
    goal: "總秒數越少越好",
  },
  race: {
    label: "雙騎競速",
    race: true,
    description: "跟 AI 藍騎士一人一馬同場飆——碰桿會踉蹌減速,先衝過終點的贏!",
    goal: "先到終點者勝",
  },
  sprint: {
    label: "自由奔跑賽",
    race: true,
    sprint: true,
    description: "沒有欄架——900 公尺地形全開放!左右自由跑位、按住加速衝,跟 AI 拼純速度,先衝線的贏!",
    goal: "先跑完 900m 者勝",
  },
  practice: {
    label: "練習場",
    endless: true,
    description: "無限圈數自由練——熟悉節奏與綠區起跳手感。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.standard;
}

// ---------- 馬的毛色(可換色,07-15 使用者點名) ----------
export const HORSE_COATS = {
  brown: { label: "棗棕", coat: 0x8a5a33, mane: 0x3a2a1c },
  white: { label: "白馬", coat: 0xe8e4da, mane: 0xcfc8b8 },
  black: { label: "黑馬", coat: 0x2e2a28, mane: 0x14110f },
  chestnut: { label: "紅棕(栗色)", coat: 0xa04528, mane: 0x5a2415 },
  grey: { label: "銀灰", coat: 0x9aa0a8, mane: 0x5f6670 },
  palomino: { label: "金黃", coat: 0xd8a850, mane: 0xf0e6d0 },
  pinto: { label: "花斑(棕白)", coat: 0xb08050, mane: 0xefe9da },
};

// 騎手角色(SBR 致敬皮):傑洛=綠寬簷帽+下顎鬍+金牙;喬尼=星星藍衣+馬蹄鐵毛帽。
// 競速模式對手自動騎「另一位」(兩人本來就是一起賽馬的搭檔)。
export const RIDERS = {
  gyro: { label: "傑洛·齊貝林", shirt: 0x7a4db8, pants: 0x4a3a2e, hair: 0xe6c95c }, // 紫上衣+棕帽+黃長髮+兩片綠披風(07-15 使用者拍板)
  johnny: { label: "喬尼·喬斯達", shirt: 0xf2f0ec, pants: 0xf2f0ec, hair: 0xe6c95c }, // 白衣白帽+帽上星星(07-15 使用者拍板)
  diego: { label: "迪亞哥·布蘭度", shirt: 0x2f8f8a, pants: 0x24404c, hair: 0xe6c95c }, // 青綠騎師服+騎師帽+金心(07-16 新增)
};

// 騎手技能(資料驅動,之後補喬尼的招照這格式加):傑洛=鋼球,雙騎競速限定
export const RIDER_SKILLS = {
  gyro: { label: "鋼球", cooldown: 7 },
  johnny: { label: "爪彈", cooldown: 7 }, // Tusk:藍色指甲彈+黃金迴旋(07-16 使用者點名)
  diego: { label: "THE WORLD", cooldown: 13 }, // 時停 5 秒:畫面復古泛黃、對手與飛行物全凍結(07-18 改 sepia)
};
const TIMESTOP_DUR = 5.0; // 玩家時停秒數
const TIMESTOP_AI_DUR = 3.5; // AI 對你時停的秒數(溫柔版,短一點)
const FALL_DUR = 2.4; // 落馬到爬回馬上的秒數(前 0.45s 摔、後 0.45s 爬回)
const BALL_SPEED = 26;

// ---------- 場地常數 ----------
const TAKEOFF_D = 2.6; // 理想起跳點:欄前 2.6m(判定用時間域 err=|distToFence-TAKEOFF_D|/speed)
const JUMP_SPAN = 4.4; // 一跳跨越的路徑長(m)
const APPROACH_M = 14; // 進入「備跳」提示的距離
const RACE_LANE = 0.95; // 競速:兩馬各偏路徑中線一側
// AI 競速對手(依難度):skill=起跳品質期望、boostRatio=全速時間比
// ---------- 賽段(07-16 使用者點名:第二賽段=沙漠長賽道,以天數計時) ----------
export const STAGES = {
  meadow: { label: "第一賽段・草原", len: 900, desert: false, days: false },
  desert: { label: "第二賽段・沙漠", len: 1800, desert: true, days: true },
  snow: { label: "第三賽段・雪山", len: 1400, desert: false, snow: true, days: false },
};
const DAY_SECONDS = 50; // 遊戲內一天=50 現實秒(沙漠賽段以天數計時)
const TURBO_BOOST = 4.0; // 高速奔跑額外速度(07-16 使用者點名:耗體力條)
const TURBO_DRAIN = 0.22; // 體力消耗/秒(全滿可衝 ~4.5 秒)
const TURBO_REGEN = 0.1; // 體力回復/秒(不衝刺時)
const SKY_KEYS = [ // [遊戲時刻, 天色, 光強] 日夜循環(夜=深藍,07-16 使用者點名)
  [0, 0x0a2050, 0.35], [5, 0x0a2050, 0.35], [6.5, 0xf0955f, 1.1],
  [9, 0xa8d4ec, 1.9], [16, 0xa8d4ec, 1.9], [18.5, 0xf0854f, 1.0],
  [20, 0x0a2050, 0.35], [24, 0x0a2050, 0.35],
];

const RACE_AI = { // 07-16 使用者點名 AI 要更快:全檔 boostRatio 上調
  kids: { skill: 0.35, boostRatio: 0.25 },
  child: { skill: 0.48, boostRatio: 0.45 },
  easy: { skill: 0.58, boostRatio: 0.62 },
  normal: { skill: 0.7, boostRatio: 0.78 },
  hard: { skill: 0.82, boostRatio: 0.92 },
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- 人物(照抄 archery3d makePerson:臉部鐵則+關節人物鐵則+長腿) ----------
function createLimb({ upperMaterial, lowerMaterial, endMaterial, upperLen, lowerLen, upperRadius, lowerRadius, end = "hand", thumbSide = 1 }) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperRadius, upperLen, 4, 8), upperMaterial);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  pivot.add(joint);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerRadius, lowerLen, 4, 8), lowerMaterial);
  lower.position.y = -lowerLen / 2;
  joint.add(lower);
  let endMesh;
  if (end === "foot") {
    endMesh = new THREE.Mesh(new THREE.BoxGeometry(lowerRadius * 2.1, lowerRadius, lowerRadius * 3.4), endMaterial);
    endMesh.position.set(0, -lowerLen - lowerRadius * 0.4, lowerRadius * 0.9);
  } else {
    const r = lowerRadius;
    endMesh = new THREE.Group();
    endMesh.position.y = -lowerLen - r * 0.2;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 1.7, r * 1.0), endMaterial);
    palm.position.y = -r * 0.85;
    endMesh.add(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 1.25, r * 0.55), endMaterial);
      finger.position.set((i - 1.5) * r * 0.54, -r * 2.1, 0);
      finger.rotation.x = 0.14;
      endMesh.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.0, r * 0.55), endMaterial);
    thumb.position.set(thumbSide * r * 1.3, -r * 0.95, r * 0.1);
    thumb.rotation.z = thumbSide * -0.55;
    endMesh.add(thumb);
  }
  joint.add(endMesh);
  return { pivot, upper, joint, lower, end: endMesh };
}

const HAIR_COLORS = [0x2b2119, 0x4a3120, 0x151515, 0x5e4630, 0x7a5636, 0x3a3a45];

function makePerson({ shirt = 0x2f6f4e, pants = 0x2a3550, skin = 0xf3cca6, hair = 0x2b2119, gender = "m", scale = 1 } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const shirtMat = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.72 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: pants, roughness: 0.8 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.32), shirtMat);
  chest.position.y = 1.42;
  rig.add(chest);
  // 身體結構(07-17):上胸肩線加寬=V 形軀幹;高度避開角色胸前配件(條紋/星)
  const upperChest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.3), shirtMat);
  upperChest.position.y = 1.7;
  rig.add(upperChest);
  for (const sx of [-1, 1]) {
    const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.088, 10, 8), shirtMat); // 肩三角肌
    deltoid.position.set(sx * 0.37, 1.73, 0);
    rig.add(deltoid);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = 1.88;
  rig.add(neck);
  const waist = new THREE.Group();
  waist.position.y = 1.16;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), shirtMat);
  belly.position.y = -0.05;
  waist.add(belly);
  const hip = new THREE.Mesh(
    gender === "f" ? new THREE.BoxGeometry(0.48, 0.22, 0.3) : new THREE.BoxGeometry(0.42, 0.2, 0.27),
    pantsMat,
  );
  hip.position.y = -0.26;
  waist.add(hip);
  const beltLine = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.06, 0.28), new THREE.MeshStandardMaterial({ color: 0x5a3d22, roughness: 0.6 }));
  beltLine.position.y = -0.15;
  waist.add(beltLine);
  rig.add(waist);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = 2.12;
  rig.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, 2.11, 0);
  rig.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  rig.add(earR);

  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), hairMat);
  hairCap.position.y = 2.13;
  hairCap.rotation.x = -0.22;
  rig.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.255, 16, 8, Math.PI, Math.PI, Math.PI * 0.35, Math.PI * (gender === "f" ? 0.38 : 0.22)),
    hairMat,
  );
  hairBack.position.y = 2.12;
  rig.add(hairBack);

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, 2.18, 0.21);
  rig.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  rig.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, 2.18, 0.25);
  rig.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  rig.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, 2.26, 0.22);
  browL.rotation.z = 0.16;
  rig.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  rig.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, 2.04, 0.21);
  smile.rotation.z = Math.PI;
  rig.add(smile);
  // smile 一併回傳:角色皮要換嘴(如金牙)時把原生嘴關掉,避免雙嘴

  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85 });
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: shirtMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, 1.72, 0);
    arm.joint.rotation.x = -0.18;
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), shirtMat); // 手肘
    elbow.position.set(0, -0.27, 0);
    arm.pivot.add(elbow);
    rig.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: pantsMat, endMaterial: shoeMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.09, lowerRadius: 0.072,
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    leg.pivot.rotation.x = -0.05;
    leg.joint.rotation.x = 0.1;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), pantsMat); // 膝蓋
    knee.position.set(0, -0.4, 0);
    leg.pivot.add(knee);
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, head, waist, leftArm, rightArm, leftLeg, rightLeg, smile };
}

// ---------- 騎手角色造型(掛在 makePerson 的 rig 上,座姿統一 poseRiderOnSaddle) ----------
function makeStar(radius, color) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? radius : radius * 0.45;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
}

// 傑洛的鋼球:綠色金屬球+深綠溝紋環(飛行時自旋+黃煙尾跡)
function makeSteelBall() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0x2f8f4f, roughness: 0.35, metalness: 0.55 }),
  );
  g.add(ball);
  const groove = new THREE.Mesh(
    new THREE.TorusGeometry(0.24, 0.035, 6, 20),
    new THREE.MeshStandardMaterial({ color: 0x1d5c33, roughness: 0.5 }),
  );
  g.add(groove);
  return g;
}

// 喬尼的爪彈:藍色長彈頭+青光環(高速旋轉=膛線感)
function makeNailBullet() {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.09, 0.34, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f7fe0, roughness: 0.3, metalness: 0.4, emissive: 0x1a4fa0, emissiveIntensity: 0.8 }),
  );
  core.rotation.x = Math.PI / 2; // 彈頭朝 +z
  g.add(core);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.03, 6, 14),
    new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.9 }),
  );
  g.add(ring);
  return g;
}

// 黃金迴旋:發射瞬間,馬身環繞一圈金色長方形面板旋轉(07-16 使用者點名的特效)
function makeGoldenSpin() {
  const group = new THREE.Group();
  const mats = [];
  for (let i = 0; i < 8; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2c14e, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    mats.push(mat);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.34), mat);
    const a = (i / 8) * Math.PI * 2;
    panel.position.set(Math.cos(a) * 1.45, 1.5 + (i % 2) * 0.45, Math.sin(a) * 1.45);
    panel.rotation.y = -a + Math.PI / 2; // 面沿切線=繞著馬轉的金框
    panel.rotation.x = 0.18;
    group.add(panel);
  }
  return { group, mats };
}

// 極光(07-16 使用者點名):三條波動光簾——底緣亮綠、頂緣淡紫,加法混色發光、不吃霧,只在夜間現身
function makeAurora(cx = 0, cz = 0, baseR = 700) {
  const group = new THREE.Group();
  const curtains = [];
  const SEGS = 96;
  const configs = [ // 光環半徑=賽道最遠點再往外(絕不切進賽道),高掛近地平線上方
    { r: baseR + 180, y: 105, h: 85, a0: -Math.PI, a1: Math.PI, phase: 0, speed: 0.5 },
    { r: baseR + 310, y: 140, h: 105, a0: -Math.PI * 0.9, a1: Math.PI * 0.35, phase: 2.1, speed: 0.38 },
    { r: baseR + 430, y: 120, h: 70, a0: -Math.PI * 0.1, a1: Math.PI * 0.95, phase: 4.2, speed: 0.66 },
  ];
  for (const cfg of configs) {
    const pos = new Float32Array((SEGS + 1) * 2 * 3);
    const col = new Float32Array((SEGS + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= SEGS; i += 1) {
      const a = cfg.a0 + (cfg.a1 - cfg.a0) * (i / SEGS);
      const x = cx + Math.cos(a) * cfg.r;
      const z = cz + Math.sin(a) * cfg.r;
      // 底緣(亮綠;加法混色下亮=顯)
      pos[(i * 2) * 3] = x;
      pos[(i * 2) * 3 + 1] = cfg.y;
      pos[(i * 2) * 3 + 2] = z;
      col[(i * 2) * 3] = 0.15; col[(i * 2) * 3 + 1] = 0.85; col[(i * 2) * 3 + 2] = 0.45;
      // 頂緣(近黑帶紫;加法混色下黑=自然淡出)
      pos[(i * 2 + 1) * 3] = x;
      pos[(i * 2 + 1) * 3 + 1] = cfg.y + cfg.h;
      pos[(i * 2 + 1) * 3 + 2] = z;
      col[(i * 2 + 1) * 3] = 0.09; col[(i * 2 + 1) * 3 + 1] = 0.02; col[(i * 2 + 1) * 3 + 2] = 0.16;
      if (i < SEGS) {
        const b = i * 2;
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
    curtains.push({ mesh, base: pos.slice(), phase: cfg.phase, speed: cfg.speed });
  }
  group.visible = false;
  return { group, curtains };
}

function makeRiderCharacter(riderId) {
  const spec = RIDERS[riderId] || RIDERS.gyro;
  const rider = makePerson({
    shirt: spec.shirt,
    pants: spec.pants,
    hair: spec.hair,
    gender: "f", // 兩位都是長髮(借長髮版後腦髮)
    scale: 0.95,
  });
  // 兩側垂髮(兩位都是金色長髮)
  const hairSideMat = new THREE.MeshStandardMaterial({ color: spec.hair, roughness: 0.85 });
  for (const x of [-0.21, 0.21]) {
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.32, 0.14), hairSideMat);
    lock.position.set(x, 1.97, -0.03);
    rider.rig.add(lock);
  }
  if (riderId === "johnny") {
    // 白色毛帽+帽上幾顆星+正面金馬蹄鐵+胸前藍星(白衣要用深色星才看得見)
    // 帽=罩在頭髮上的圓頂,下緣停在眉上(y2.2)——蓋到眼睛高度眼珠會「長到帽子上」(07-15 踩過)
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.7 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.268, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat);
    cap.position.y = 2.2;
    rider.rig.add(cap);
    const horseshoe = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.016, 6, 12, Math.PI), new THREE.MeshBasicMaterial({ color: 0xd8a83c }));
    horseshoe.position.set(0, 2.24, 0.28);
    horseshoe.rotation.x = -0.15;
    rider.rig.add(horseshoe);
    // 帽上星星:沿帽面繞一圈貼幾顆藍星,面朝外(正前方留給馬蹄鐵);半徑要比帽面突出,埋進去就看不見(07-15 踩過)
    for (const a of [-1.1, -0.55, 0.55, 1.1, Math.PI]) {
      const s = makeStar(0.05, 0x2f4fa8);
      const r = 0.28;
      s.position.set(Math.sin(a) * r, 2.24, Math.cos(a) * r);
      s.rotation.order = "YXZ";
      s.rotation.y = a;
      s.rotation.x = -0.15;
      rider.rig.add(s);
    }
    const chestStar = makeStar(0.1, 0x2f4fa8);
    chestStar.position.set(0, 1.54, 0.171);
    rider.rig.add(chestStar);
  } else if (riderId === "diego") {
    // 迪亞哥:青綠騎師帽(圓頂+前簷)+胸前金心+恐龍化隱藏件(獸化時才現形)
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2f8f8a, roughness: 0.6 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.268, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), capMat);
    cap.position.y = 2.2;
    rider.rig.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.035, 0.2), capMat);
    brim.position.set(0, 2.2, 0.3);
    rider.rig.add(brim);
    // 雙向橫條黃條紋(07-16 使用者點名):兩組斜向條紋交叉成 X,前後都看得到
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf6d743, roughness: 0.65 });
    for (const tilt of [Math.PI / 4, -Math.PI / 4]) { // ±45°=正菱形;條紋短一點,別爬到臉上(07-16)
      for (const sy of [1.16, 1.34, 1.52]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.016, 0.345), stripeMat);
        stripe.position.set(0, sy, 0);
        stripe.rotation.z = tilt;
        rider.rig.add(stripe);
      }
    }
    // 帽上黃色立體 DIO 標字(07-16 使用者點名):D=豎桿+半圓環、I=豎桿、O=圓環,貼帽前坡
    const dioMat = new THREE.MeshStandardMaterial({ color: 0xf6d743, roughness: 0.4, emissive: 0x6a5a10, emissiveIntensity: 0.5 });
    const dio = new THREE.Group();
    const dBar = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.11, 0.03), dioMat);
    dBar.position.set(-0.105, 0, 0);
    dio.add(dBar);
    const dArc = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.015, 8, 12, Math.PI), dioMat);
    dArc.rotation.z = -Math.PI / 2; // 右半圓
    dArc.position.set(-0.098, 0, 0);
    dio.add(dArc);
    const iBar = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.11, 0.03), dioMat);
    iBar.position.set(0, 0, 0);
    dio.add(iBar);
    const oRing = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.016, 8, 14), dioMat);
    oRing.position.set(0.098, 0, 0);
    dio.add(oRing);
    dio.position.set(0, 2.315, 0.235);
    dio.rotation.x = -0.42; // 貼著帽前坡
    rider.rig.add(dio);
  } else {
    // 棕寬簷帽+深帽帶+下顎環鬍+一口金牙的笑(原生嘴關掉,不然變雙嘴)
    rider.smile.visible = false;
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x6b4526, roughness: 0.75 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x3e2a18, roughness: 0.6 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.03, 18), hatMat);
    brim.position.y = 2.26;
    rider.rig.add(brim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.218, 0.218, 0.07, 14), bandMat);
    band.position.y = 2.3;
    rider.rig.add(band);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.215, 0.22, 14), hatMat);
    crown.position.y = 2.4;
    rider.rig.add(crown);
    const beard = new THREE.Mesh(new THREE.TorusGeometry(0.195, 0.028, 6, 14, Math.PI), new THREE.MeshStandardMaterial({ color: 0x3a2a16, roughness: 0.9 }));
    beard.position.set(0, 1.95, 0); // 貼著下顎線,壓低避免看起來像第二張嘴
    beard.rotation.x = Math.PI / 2; // 半環轉到臉前方
    rider.rig.add(beard);
    const grill = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 8, 14, Math.PI), new THREE.MeshBasicMaterial({ color: 0xd8a83c }));
    grill.position.set(0, 2.045, 0.218);
    grill.rotation.z = Math.PI;
    rider.rig.add(grill);
    // 分成兩塊的大綠披風:左右各一片,樞紐掛在肩上、布面垂下——updateHorsePose 會依馬速讓它揚起飄動
    const capeMat = new THREE.MeshStandardMaterial({ color: 0x3f8f5a, roughness: 0.8, side: THREE.DoubleSide });
    rider.capes = [];
    for (const x of [-0.21, 0.21]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.8, -0.17);
      const cape = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.0, 0.03), capeMat);
      cape.position.y = -0.5;
      pivot.add(cape);
      pivot.rotation.x = 0.3; // 靜止時披在馬背上
      rider.rig.add(pivot);
      rider.capes.push(pivot);
    }
  }
  // 騎士靴(07-17 身體結構):長筒靴罩住小腿,掛 joint 跟著跨鞍彎曲
  const bootMat = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.5 });
  for (const leg of [rider.leftLeg, rider.rightLeg]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.3, 0.17), bootMat);
    boot.position.set(0, -0.2, 0.01);
    leg.joint.add(boot);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.088, 0.08, 10), bootMat); // 靴口
    cuff.position.set(0, -0.06, 0);
    leg.joint.add(cuff);
  }
  return rider;
}

function poseRiderOnSaddle(rider) {
  rider.leftLeg.pivot.rotation.x = -1.25;
  rider.leftLeg.pivot.rotation.z = 0.5;
  rider.leftLeg.joint.rotation.x = 1.5;
  rider.rightLeg.pivot.rotation.x = -1.25;
  rider.rightLeg.pivot.rotation.z = -0.5;
  rider.rightLeg.joint.rotation.x = 1.5;
  rider.leftArm.pivot.rotation.x = -0.95;
  rider.leftArm.joint.rotation.x = -0.5;
  rider.rightArm.pivot.rotation.x = -0.95;
  rider.rightArm.joint.rotation.x = -0.5;
  rider.group.position.set(0, 1.02, 0.12);
  rider.group.scale.setScalar(0.95);
}

// ---------- 馬(矩形身體鐵則的四足版:箱體軀幹+雙節腿+有臉[眼睛]+鬃毛尾巴) ----------
function makeHorse({ coat = 0x8a5a33, mane = 0x3a2a1c } = {}) {
  const group = new THREE.Group(); // 原點=地面、+z 朝前
  const coatMat = new THREE.MeshStandardMaterial({ color: coat, roughness: 0.7 });
  const maneMat = new THREE.MeshStandardMaterial({ color: mane, roughness: 0.85 });
  // 材質共用:setHorseCoat 只要改這兩個材質的 color,全身(含頸/頭/腿)一起換
  const sockMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });
  const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 });

  const rig = new THREE.Group();
  group.add(rig);

  // 軀幹:矩形箱體(胸腔+臀段),不用圓筒
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 1.7), coatMat);
  body.position.set(0, 1.58, 0);
  rig.add(body);
  const chestCap = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.4), coatMat);
  chestCap.position.set(0, 1.62, 0.95);
  rig.add(chestCap);
  const rump = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.5, 0.42), coatMat);
  rump.position.set(0, 1.6, -0.95);
  rig.add(rump);
  // 身體結構(07-17 使用者點名):肩肌/臀肌/圓腹/鬐甲/胸肌——箱體軀幹上加圓弧肌群,馬味立刻出來
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), coatMat);
    shoulder.position.set(side * 0.22, 1.5, 0.74);
    shoulder.scale.set(1.0, 1.1, 1.35);
    rig.add(shoulder);
    const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 10), coatMat); // 後臀大肌
    haunch.position.set(side * 0.19, 1.52, -0.8);
    haunch.scale.set(1.05, 1.15, 1.3);
    rig.add(haunch);
    const pec = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), coatMat); // 胸前肌(兩瓣,塞在胸口不下垂)
    pec.position.set(side * 0.12, 1.5, 1.1);
    pec.scale.set(1, 1.25, 1);
    rig.add(pec);
  }
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), coatMat); // 圓腹(箱體下緣的弧線)
  belly.position.set(0, 1.4, -0.05);
  belly.scale.set(1.02, 0.82, 1.8);
  rig.add(belly);
  const withers = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.46), coatMat); // 鬐甲(肩隆)
  withers.position.set(0, 1.92, 0.62);
  withers.rotation.x = -0.14;
  rig.add(withers);
  const girth = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.68, 0.09), new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.55 })); // 肚帶(鞍的束帶)
  girth.position.set(0, 1.56, 0.12);
  rig.add(girth);

  // 頸(斜上)+頭(兩側眼睛=臉部鐵則動物版)+雙耳+鬃毛
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.82, 1.05);
  rig.add(neckPivot);
  // 雙節斜頸(07-17 身體結構):下段寬、上段窄,接出天鵝頸的弧
  const neckLower = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.42), coatMat);
  neckLower.rotation.x = 0.55;
  neckLower.position.set(0, 0.1, 0.1);
  neckPivot.add(neckLower);
  const neckUpper = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.46, 0.3), coatMat);
  neckUpper.rotation.x = 0.85;
  neckUpper.position.set(0, 0.42, 0.32);
  neckPivot.add(neckUpper);
  const head = new THREE.Group();
  head.position.set(0, 0.62, 0.5);
  neckPivot.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.52), coatMat);
  skull.rotation.x = 0.35;
  head.add(skull);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.3), maneMat);
  muzzle.position.set(0, -0.12, 0.34);
  muzzle.rotation.x = 0.35;
  head.add(muzzle);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.13, 0.3), coatMat); // 下顎線
  jaw.position.set(0, -0.21, 0.1);
  jaw.rotation.x = 0.35;
  head.add(jaw);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), coatMat); // 腮(顴肌)
    cheek.position.set(side * 0.11, -0.03, 0.02);
    head.add(cheek);
    const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1c1712 })); // 鼻孔
    nostril.position.set(side * 0.052, -0.175, 0.47);
    head.add(nostril);
  }
  const faceWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const faceDarkMat = new THREE.MeshBasicMaterial({ color: 0x1c1712 });
  for (const side of [-1, 1]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhiteMat);
    eyeWhite.position.set(side * 0.14, 0.06, 0.14);
    head.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), faceDarkMat);
    pupil.position.set(side * 0.165, 0.06, 0.15);
    head.add(pupil);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 6), coatMat);
    ear.position.set(side * 0.09, 0.24, -0.05);
    ear.rotation.x = -0.2;
    head.add(ear);
  }
  // 鬃毛(07-15 使用者點名要明顯):頸背鬃冠+垂右側鬃髮+額前瀏海,三件套
  const maneCrest = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.88, 0.24), maneMat);
  maneCrest.rotation.x = 0.7;
  maneCrest.position.set(0, 0.36, -0.04); // 沿頸背露出來,不再埋進脖子
  neckPivot.add(maneCrest);
  const maneSide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.74, 0.34), maneMat);
  maneSide.rotation.x = 0.7;
  maneSide.position.set(0.17, 0.24, 0.08); // 垂在頸右側(真馬鬃髮倒一邊)
  neckPivot.add(maneSide);
  const forelock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.12), maneMat);
  forelock.position.set(0, 0.24, 0.08);
  head.add(forelock);

  // 雙節漸細尾(group=動畫契約不變:anim 設 tail.rotation.x)
  const tail = new THREE.Group();
  tail.position.set(0, 1.62, -1.14);
  tail.rotation.x = 0.55;
  const tailUpper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.4, 0.15), maneMat);
  tailUpper.position.set(0, -0.16, 0);
  tail.add(tailUpper);
  const tailLower = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.11), maneMat);
  tailLower.position.set(0, -0.46, -0.07);
  tailLower.rotation.x = 0.22;
  tail.add(tailLower);
  rig.add(tail);

  // 四腿(雙節+蹄;前腿白襪):pivot=肩/髖
  const mkLeg = (x, z, sock) => {
    const leg = createLimb({
      upperMaterial: coatMat,
      lowerMaterial: sock ? sockMat : coatMat,
      endMaterial: hoofMat,
      upperLen: 0.62, lowerLen: 0.6, upperRadius: 0.085, lowerRadius: 0.062, // 長腿 v3(07-15 再點名) // 長腿 v2(07-15 點名:馬腿再長)
      end: "foot",
    });
    leg.pivot.position.set(x, 1.35, z);
    const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), sock ? sockMat : coatMat); // 膝/飛節
    kneeCap.position.set(0, -0.62, 0);
    leg.pivot.add(kneeCap);
    rig.add(leg.pivot);
    return leg;
  };
  const legs = [
    mkLeg(-0.22, 0.72, true),
    mkLeg(0.22, 0.72, true),
    mkLeg(-0.22, -0.78, false),
    mkLeg(0.22, -0.78, false),
  ];

  // 鞍+紅鞍墊+韁繩
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.62), new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.5 }));
  saddle.position.set(0, 1.95, 0.12);
  rig.add(saddle);
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.06, 0.78), new THREE.MeshStandardMaterial({ color: 0xb03030, roughness: 0.85 }));
  pad.position.set(0, 1.9, 0.12);
  rig.add(pad);
  const rein = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1.15), new THREE.MeshStandardMaterial({ color: 0x33241a }));
  rein.position.set(0, 2.25, 0.75);
  rein.rotation.x = -0.35;
  rig.add(rein);

  return { group, rig, body, neckPivot, head, tail, legs, saddle, coatMat, maneMat };
}

export class EquestrianGame {
  constructor({ canvas, touchRoot }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;

    const settings = loadSettings();
    this.difficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "normal";
    this.modeId = GAME_MODES[settings.modeId] ? settings.modeId : "standard";
    this.mode = getModeConfig(this.modeId);
    this.coatId = HORSE_COATS[settings.horseCoat] ? settings.horseCoat : "brown";
    this.stageId = STAGES[settings.stage] ? settings.stage : "meadow";
    this.stage = STAGES[this.stageId];
    this.opponentId = settings.opponent === "random" || RIDERS[settings.opponent] ? settings.opponent : "random";
    this.riderId = RIDERS[settings.riderCharacter] ? settings.riderCharacter : "gyro";

    // 技能系統(鋼球):飛行中的球、煙霧粒子、冷卻、雙方落馬計時(>=FALL_DUR=在馬上)
    this.balls = [];
    this.smokePuffs = [];
    this.spinFx = [];
    this.skillCd = 0;
    this.aiSkillCd = 9;
    this.meFall = 9;
    this.aiFall = 9;
    this.timeStop = 0;
    this.aiTimeStop = 0;
    this.aiRiderId = "johnny";
    this.playerLane = -RACE_LANE; // 自由奔跑賽:左右鍵自由跑位(±3.2m)
    this.steerVis = 0;
    this.stamina = 1; // 體力條(高速奔跑消耗)
    this.tired = false; // 見底後要回到 25% 才能再衝(遲滯)
    this.aiStamina = 1;
    this.aiTurbo = false;
    this.aiTired = false;
    this.blizzard = 0; // 暴風雪強度(第三賽段)
    this.blizzardWarned = false;

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用(athletics this.running 撞名事故鐵則)
    this.time = 0;
    this.phase = "menu"; // menu | gate | riding | jumping | ended
    this.message = "在首頁選擇模式與難度後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播 2 高空 3 馬上視角
    this.autoSaveTimer = 0;

    // 賽況
    this.dist = 0;
    this.speed = 0;
    this.elapsed = 0;
    this.faults = 0;
    this.clears = 0;
    this.fenceIdx = 0;
    this.lastResult = null; // 'clear' | 'knock' | 'early' | null
    this.jumpAnim = null; // {t, dur, quality, height, fence}
    this.gallopT = 0;
    this.finishDist = 0;
    this.lap = 1;
    this.knockAnims = [];

    this.overlay = { visible: false, eyebrow: "", title: "", text: "", canResume: false };

    // ---- three ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8fc4e8);
    this.scene.fog = new THREE.Fog(0x8fc4e8, 260, 1050); // 900m 賽道:遠景入霧,配大遠平面
    this.scene.fog = new THREE.Fog(0x9fd0ee, 60, 160);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 2600); // 大賽道+外圈極光都要看得到
    this.camPos = new THREE.Vector3(0, 6, -14);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();

    this.rebuildWorld();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // 換賽段=整個世界重建(新 Scene+新賽道+新場景;馬/騎手/欄架全部重生)
  setStage(stageId) {
    if (!STAGES[stageId] || stageId === this.stageId) return;
    this.stageId = stageId;
    this.stage = STAGES[stageId];
    this.rebuildWorld();
    this.placeHorse();
  }

  rebuildWorld() {
    this.scene = new THREE.Scene();
    this.applySkyBase();
    this.balls = [];
    this.smokePuffs = [];
    this.spinFx = [];
    this.rider = null;
    this.aiRider = null;
    this.buildCourse();
    this.setupScene();
  }

  applySkyBase() {
    const sky = this.stage.snow ? 0xcfd8e4 : this.stage.desert ? 0xa8d4ec : 0x8fc4e8;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 260, 1050);
  }

  // 天數計時(沙漠賽段):第 1 天 06 時起跑
  dayHours() {
    return 6 + this.elapsed * (24 / DAY_SECONDS);
  }

  dayText() {
    const h = this.dayHours();
    const d = Math.floor(h / 24) + 1;
    const hh = String(Math.floor(h % 24)).padStart(2, "0");
    return `第${d}天 ${hh}時`;
  }

  // 暴風雪(第三賽段):常態飄雪;每 ~50 秒一波強陣風(白茫濃霧+雪片橫飛+雙方減速)
  updateBlizzard(delta) {
    if (!this.snowFx) return;
    const gust = clamp((Math.sin(this.time * 0.12) - 0.55) / 0.45, 0, 1);
    this.blizzard = gust;
    if (gust > 0.5 && !this.blizzardWarned) {
      this.blizzardWarned = true;
      this.message = "暴風雪來了——白茫一片,看緊路線!";
      this.pushHud();
    }
    if (gust < 0.2) this.blizzardWarned = false;
    // 濃霧收窄視野(白矇天)
    if (this.scene.fog) {
      this.scene.fog.near = 260 - 205 * gust;
      this.scene.fog.far = 1050 - 800 * gust;
    }
    // 雪粒子:跟著馬走的 70m 盒;下落+風向橫飄(陣風加倍)
    const hp = this.horse.group.position;
    const attr = this.snowFx.pts.geometry.getAttribute("position");
    const windX = (1.5 + 9 * gust) * delta;
    for (let i = 0; i < attr.count; i += 1) {
      attr.array[i * 3 + 1] -= this.snowFx.speeds[i] * (1 + gust * 1.6) * delta;
      attr.array[i * 3] += windX * (0.6 + (i % 5) * 0.2);
      if (attr.array[i * 3 + 1] < hp.y - 2) attr.array[i * 3 + 1] = hp.y + 24;
      if (attr.array[i * 3] > hp.x + 35) attr.array[i * 3] = hp.x - 35;
      if (attr.array[i * 3] < hp.x - 35) attr.array[i * 3] = hp.x + 35;
      if (attr.array[i * 3 + 2] > hp.z + 35) attr.array[i * 3 + 2] = hp.z - 35;
      if (attr.array[i * 3 + 2] < hp.z - 35) attr.array[i * 3 + 2] = hp.z + 35;
    }
    attr.needsUpdate = true;
    this.snowFx.pts.material.opacity = 0.7 + 0.3 * gust;
  }

  // 日夜循環:天色/霧色/主光強度照遊戲時刻輪轉
  // THE WORLD 世界抽復古黃(07-18:時停=老照片泛黃,只有迪亞哥有顏色)——
  // CSS filter 會把施放者一起變灰,改成材質級抽色:全場材質轉灰階、只跳過 keepGroup(施放者)。
  _setWorldGray(on, keepGroup) {
    const lum = (hex) => { // 復古泛黃 sepia(07-18 使用者拍板:時停從黑白改成老照片黃)
      const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
      const v = r * 0.299 + g * 0.587 + b * 0.114;
      const tr = Math.min(255, Math.round(v * 1.25));
      const tg = Math.min(255, Math.round(v * 1.06));
      const tb = Math.round(v * 0.66);
      return (tr << 16) | (tg << 8) | tb;
    };
    if (on) {
      if (this._tsGray) return; // 已抽色(雙方連放保險)
      this._tsGray = { mats: [], inst: [], vtx: [], bg: null, fog: null };
      const seen = new Set();
      this.scene.traverse((o) => {
        let keep = false;
        for (let q = o; q; q = q.parent) if (q === keepGroup) { keep = true; break; }
        if (keep || !o.isMesh || !o.material) return;
        if (o.isInstancedMesh && o.instanceColor) { // 觀眾等 instanced 色也要抽
          this._tsGray.inst.push({ mesh: o, orig: o.instanceColor.array.slice() });
          const a = o.instanceColor.array;
          for (let i = 0; i < a.length; i += 3) {
            const v = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
            a[i] = Math.min(1, v * 1.25); a[i + 1] = Math.min(1, v * 1.06); a[i + 2] = v * 0.66;
          }
          o.instanceColor.needsUpdate = true;
        }
        if (o.geometry?.attributes?.color) { // 地形帶/彩帶等 vertex colors 也要抽
          this._tsGray.vtx.push({ geo: o.geometry, orig: o.geometry.attributes.color.array.slice() });
          const c = o.geometry.attributes.color.array;
          const n = o.geometry.attributes.color.itemSize; // 3 或 4(RGBA 只動前三)
          for (let i = 0; i < c.length; i += n) {
            const v = c[i] * 0.299 + c[i + 1] * 0.587 + c[i + 2] * 0.114;
            c[i] = Math.min(1, v * 1.25); c[i + 1] = Math.min(1, v * 1.06); c[i + 2] = v * 0.66;
          }
          o.geometry.attributes.color.needsUpdate = true;
        }
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          if (seen.has(m)) continue;
          seen.add(m);
          const rec = { m, color: m.color ? m.color.getHex() : null, emissive: m.emissive ? m.emissive.getHex() : null };
          this._tsGray.mats.push(rec);
          if (m.color) m.color.setHex(lum(rec.color));
          if (m.emissive) m.emissive.setHex(lum(rec.emissive));
        }
      });
      if (this.scene.background && this.scene.background.isColor) {
        this._tsGray.bg = this.scene.background.getHex();
        this.scene.background.setHex(lum(this._tsGray.bg));
      }
      if (this.scene.fog) {
        this._tsGray.fog = this.scene.fog.color.getHex();
        this.scene.fog.color.setHex(lum(this._tsGray.fog));
      }
    } else {
      if (!this._tsGray) return;
      for (const rec of this._tsGray.mats) {
        if (rec.color !== null) rec.m.color.setHex(rec.color);
        if (rec.emissive !== null) rec.m.emissive.setHex(rec.emissive);
      }
      for (const it of this._tsGray.inst) {
        it.mesh.instanceColor.array.set(it.orig);
        it.mesh.instanceColor.needsUpdate = true;
      }
      for (const it of this._tsGray.vtx) {
        it.geo.attributes.color.array.set(it.orig);
        it.geo.attributes.color.needsUpdate = true;
      }
      if (this._tsGray.bg !== null && this.scene.background?.isColor) this.scene.background.setHex(this._tsGray.bg);
      if (this._tsGray.fog !== null && this.scene.fog) this.scene.fog.color.setHex(this._tsGray.fog);
      this._tsGray = null;
    }
  }

  updateSky() {
    if (this._tsGray) return; // THE WORLD 時停中:天空凍結(日夜 lerp 會蓋掉世界抽色)
    if (!this.stage.days || !this.keyLight) return;
    const h = this.dayHours() % 24;
    let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
    for (let i = 0; i < SKY_KEYS.length - 1; i += 1) {
      if (h >= SKY_KEYS[i][0] && h <= SKY_KEYS[i + 1][0]) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
    }
    const t = (h - a[0]) / (b[0] - a[0] || 1);
    const ca = new THREE.Color(a[1]), cb = new THREE.Color(b[1]);
    ca.lerp(cb, t);
    this.scene.background = ca;
    if (this.scene.fog) this.scene.fog.color.copy(ca);
    this.keyLight.intensity = a[2] + (b[2] - a[2]) * t;

    // 極光:入夜漸現(19.5→20.5 淡入,4.5→5.5 淡出),頂點沿光簾波動=流動感
    if (this.aurora) {
      let nf = 0;
      if (h >= 20.5 || h <= 4.5) nf = 1;
      else if (h > 19.5 && h < 20.5) nf = h - 19.5;
      else if (h > 4.5 && h < 5.5) nf = 5.5 - h;
      this.aurora.group.visible = nf > 0.02;
      if (this.aurora.group.visible) {
        for (const c of this.aurora.curtains) {
          c.mesh.material.opacity = nf * 0.65;
          const attr = c.mesh.geometry.getAttribute("position");
          for (let i = 0; i < attr.count / 2; i += 1) {
            const sway = Math.sin(i * 0.32 + this.time * c.speed + c.phase) * 12;
            const swayTop = Math.sin(i * 0.32 + this.time * c.speed * 1.35 + c.phase + 0.9) * 22;
            attr.array[(i * 2) * 3] = c.base[(i * 2) * 3] + sway;
            attr.array[(i * 2 + 1) * 3] = c.base[(i * 2 + 1) * 3] + swayTop;
            attr.array[(i * 2 + 1) * 3 + 1] = c.base[(i * 2 + 1) * 3 + 1] + Math.sin(i * 0.5 + this.time * 0.9 + c.phase) * 6;
          }
          attr.needsUpdate = true;
        }
      }
    }
  }

  // ---------- 賽道:地形大環(草原 900m/沙漠 1800m;07-16 使用者點名) ----------
  // 分區(以里程比例 u):0~0.30 平原 → 0.30~0.42 上坡 → 0.42~0.64 樹林高原 → 0.64~0.80 陡下坡 → 0.80~1 平地衝線
  buildCourse() {
    const raw = [
      [0, 0], [60, -14], [110, 10], [150, -10], [185, 25], [170, 80], [120, 105],
      [60, 90], [10, 120], [-50, 130], [-95, 95], [-120, 40], [-95, -15], [-50, -18],
    ].map(([x, z]) => new THREE.Vector3(x, 0, z));
    let curve = new THREE.CatmullRomCurve3(raw, true, "catmullrom", 0.5);
    const scale = this.stage.len / curve.getLength(); // 精確縮放到賽段全長
    for (const v of raw) { v.x *= scale; v.z *= scale; }
    this.curve = new THREE.CatmullRomCurve3(raw, true, "catmullrom", 0.5);
    this.courseLen = this.curve.getLength();

    // 高度剖面(u→公尺):草原=平原→高原→陡下坡;沙漠=連綿沙丘
    this.heightKeys = this.stage.snow
      ? [
          [0, 0], [0.08, 4], [0.16, 10], [0.24, 8], [0.34, 18], [0.42, 15],
          [0.52, 28], [0.6, 24], [0.7, 12], [0.82, 4], [0.92, 0], [1, 0],
        ]
      : this.stage.desert
      ? [
          [0, 0], [0.07, 3], [0.14, 1], [0.21, 6], [0.29, 2], [0.37, 8], [0.45, 3],
          [0.54, 13], [0.61, 6], [0.69, 9], [0.77, 3], [0.87, 0], [1, 0],
        ]
      : [
          [0, 0], [0.1, 0.8], [0.2, 1.2], [0.3, 3.5], [0.42, 12], [0.5, 13],
          [0.58, 12.5], [0.64, 12], [0.72, 6], [0.8, 0], [0.9, 0], [1, 0],
        ];
    this.buildTerrainRibbon();
  }

  heightAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    const k = this.heightKeys;
    for (let i = 0; i < k.length - 1; i += 1) {
      if (u >= k[i][0] && u <= k[i + 1][0]) {
        const t = (u - k[i][0]) / (k[i + 1][0] - k[i][0] || 1);
        const sm = t * t * (3 - 2 * t); // smoothstep=坡頂坡底圓滑
        return k[i][1] + (k[i + 1][1] - k[i][1]) * sm;
      }
    }
    return 0;
  }

  slopePitch(dist) { // 沿途俯仰角(下坡=正值鼻朝下;YXZ 序配 yaw)
    return Math.atan2(-(this.heightAt(dist + 2.5) - this.heightAt(dist - 2.5)), 5);
  }

  allowedTime(preset) { // 900m 長賽道:容許時間=航程/基速×1.35+8(幼兒不限時照舊)
    if (preset.timeAllowed >= 999) return 999;
    return Math.round((this.courseLen / preset.baseSpeed) * 1.35 + 8);
  }

  inForest(dist) {
    if (this.stage.desert) return false;
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return u >= 0.42 && u <= 0.64;
  }

  // 路面帶狀網格(頂點色分區)+兩側邊坡裙+樹林段路肩種樹
  buildTerrainRibbon() {
    const SEG = 340;
    const pos = [], col = [], idx = [];
    const skirtPos = [], skirtIdx = [];
    const zoneColor = this.stage.snow
      ? (u) => {
          if (u < 0.3) return [0.92, 0.94, 0.97]; // 新雪
          if (u < 0.6) return [0.78, 0.85, 0.93]; // 壓實冰路(爬升段)
          if (u < 0.82) return [0.68, 0.78, 0.9]; // 峰頂藍冰
          return [0.92, 0.94, 0.97];
        }
      : this.stage.desert
      ? (u) => {
          if (u < 0.3) return [0.93, 0.82, 0.58]; // 淺沙
          if (u < 0.55) return [0.88, 0.72, 0.46]; // 金沙丘
          if (u < 0.78) return [0.82, 0.6, 0.4]; // 紅沙段
          return [0.93, 0.82, 0.58];
        }
      : (u) => {
          if (u < 0.3) return [0.85, 0.78, 0.6]; // 平原沙路
          if (u < 0.42) return [0.74, 0.72, 0.5]; // 上坡草土
          if (u < 0.64) return [0.45, 0.55, 0.34]; // 樹林蔭路
          if (u < 0.8) return [0.78, 0.76, 0.7]; // 下坡碎石
          return [0.85, 0.78, 0.6];
        };
    for (let i = 0; i <= SEG; i += 1) {
      const u = i / SEG;
      const d = u * this.courseLen;
      const c = this.curve.getPointAt(u % 1);
      const y = this.heightAt(d);
      const t = this.curve.getTangentAt(u % 1);
      const nx = -t.z, nz = t.x;
      const nl = Math.hypot(nx, nz) || 1;
      const w = this.inForest(d) ? 5.2 : 3.8; // 樹林段路面加寬(樹種在路肩不懸空)
      const lx = c.x + (nx / nl) * w, lz = c.z + (nz / nl) * w;
      const rx = c.x - (nx / nl) * w, rz = c.z - (nz / nl) * w;
      pos.push(lx, y + 0.02, lz, rx, y + 0.02, rz);
      const cc = zoneColor(u);
      col.push(...cc, ...cc);
      skirtPos.push(lx, y + 0.02, lz, lx, -0.05, lz, rx, y + 0.02, rz, rx, -0.05, rz);
      if (i < SEG) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        const b = i * 4;
        skirtIdx.push(b, b + 4, b + 1, b + 1, b + 4, b + 5); // 左裙
        skirtIdx.push(b + 2, b + 3, b + 6, b + 3, b + 7, b + 6); // 右裙
      }
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    roadGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    roadGeo.setIndex(idx);
    roadGeo.computeVertexNormals();
    this.roadMesh = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    this.scene.add(this.roadMesh);
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(skirtPos, 3));
    skirtGeo.setIndex(skirtIdx);
    skirtGeo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1, side: THREE.DoubleSide })));

    if (this.stage.snow) {
      // 雪山沿線:掛雪松樹+雪岩交錯(站在路肩上)
      const pineMat = new THREE.MeshStandardMaterial({ color: 0x2a4d38, roughness: 1 });
      const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.9 });
      const iceRockMat = new THREE.MeshStandardMaterial({ color: 0xaebfd0, roughness: 0.8 });
      for (let d = 24; d < this.courseLen; d += 34) {
        const side = Math.round(d / 34) % 2 === 0 ? 1 : -1;
        const c = this.posAt(d);
        const t = this.tangentAt(d);
        const nl = Math.hypot(t.z, t.x) || 1;
        const ox = (-t.z / nl) * 4.6 * side, oz = (t.x / nl) * 4.6 * side;
        if (Math.round(d / 34) % 4 === 3) {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85), iceRockMat);
          rock.position.set(c.x + ox, c.y + 0.35, c.z + oz);
          this.scene.add(rock);
        } else {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.9 }));
          trunk.position.set(c.x + ox, c.y + 0.7, c.z + oz);
          this.scene.add(trunk);
          const pine = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.4, 7), pineMat);
          pine.position.set(c.x + ox, c.y + 3.0, c.z + oz);
          this.scene.add(pine);
          const cap = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.6, 7), snowCapMat);
          cap.position.set(c.x + ox, c.y + 4.2, c.z + oz);
          this.scene.add(cap);
        }
      }
    } else if (this.stage.desert) {
      // 沙漠沿線:仙人掌+岩石交錯(站在路肩上)
      const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f8a4a, roughness: 0.85 });
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x9a7d5f, roughness: 1 });
      for (let d = 30; d < this.courseLen; d += 46) {
        const side = Math.round(d / 46) % 2 === 0 ? 1 : -1;
        const c = this.posAt(d);
        const t = this.tangentAt(d);
        const nl = Math.hypot(t.z, t.x) || 1;
        const ox = (-t.z / nl) * 4.6 * side, oz = (t.x / nl) * 4.6 * side;
        if (Math.round(d / 46) % 3 === 2) {
          const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9), rockMat);
          rock.position.set(c.x + ox, c.y + 0.4, c.z + oz);
          this.scene.add(rock);
        } else {
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 2.2, 8), cactusMat);
          trunk.position.set(c.x + ox, c.y + 1.1, c.z + oz);
          this.scene.add(trunk);
          for (const ax of [-1, 1]) {
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.0, 8), cactusMat);
            arm.rotation.z = ax * 0.9;
            arm.position.set(c.x + ox + ax * 0.42, c.y + 1.5, c.z + oz);
            this.scene.add(arm);
          }
        }
      }
    } else {
      // 樹林段:路肩兩側交錯種樹(站在加寬的路肩上,不懸空)
      const treeMat = new THREE.MeshStandardMaterial({ color: 0x2e5f2a, roughness: 1 });
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d24, roughness: 0.9 });
      for (let d = this.courseLen * 0.42; d < this.courseLen * 0.64; d += 7) {
        const side = Math.round(d / 7) % 2 === 0 ? 1 : -1;
        const c = this.posAt(d);
        const t = this.tangentAt(d);
        const nl = Math.hypot(t.z, t.x) || 1;
        const ox = (-t.z / nl) * 4.4 * side, oz = (t.x / nl) * 4.4 * side;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 6), trunkMat);
        trunk.position.set(c.x + ox, c.y + 1.2, c.z + oz);
        this.scene.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.6, 7), treeMat);
        crown.position.set(c.x + ox, c.y + 4.0, c.z + oz);
        this.scene.add(crown);
      }
    }
  }

  posAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    const p = this.curve.getPointAt(u);
    p.y = this.heightAt(dist); // 地形高度接在樣條上:全引擎(馬/欄/鏡頭)自動跟高度
    return p;
  }

  tangentAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return this.curve.getTangentAt(u);
  }

  rebuildFences() {
    if (this.fenceGroup) this.scene.remove(this.fenceGroup);
    this.fenceGroup = new THREE.Group();
    this.fences = [];
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const n = this.mode.sprint ? 0 : (this.mode.jumpoff ? Math.max(5, preset.fences - 2) : preset.fences) * 2; // 900m:欄門加倍;自由奔跑賽=零欄架
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });
    const railColors = [0xd8433c, 0x3f7be0, 0xf6d743, 0x4fae6a];
    for (let i = 0; i < n; i += 1) {
      let d = this.courseLen * ((i + 1) / (n + 1));
      for (let tries = 0; tries < 4 && Math.abs(this.slopePitch(d)) > 0.1; tries += 1) d += 9; // 最陡段不放欄
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const yaw = Math.atan2(t.x, t.z);
      const g = new THREE.Group();
      g.position.copy(p);
      g.rotation.y = yaw;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.16), woodMat);
        post.position.set(side * 1.7, 0.95, 0);
        g.add(post);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(0.3, 0.2),
          new THREE.MeshStandardMaterial({ color: side < 0 ? 0xd8433c : 0xf5f5f5, side: THREE.DoubleSide }),
        );
        flag.position.set(side * 1.7, 2.05, 0);
        g.add(flag);
      }
      const railMat = new THREE.MeshStandardMaterial({ color: railColors[i % railColors.length], roughness: 0.6 });
      const lowRail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.3, 10), railMat);
      lowRail.rotation.z = Math.PI / 2;
      lowRail.position.y = 0.8;
      g.add(lowRail);
      const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.3, 10), railMat);
      topRail.rotation.z = Math.PI / 2;
      topRail.position.y = 1.35;
      g.add(topRail);
      const numPlate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.05), new THREE.MeshStandardMaterial({ color: 0xf6d743 }));
      numPlate.position.set(-2.1, 0.5, 0);
      g.add(numPlate);
      this.fenceGroup.add(g);
      this.fences.push({ dist: d, group: g, topRail, knocked: false, resolved: false });
    }
    this.scene.add(this.fenceGroup);
    this.knockAnims = [];
  }

  // ---------- 場景 ----------
  setupScene() {
    const sun = new THREE.HemisphereLight(0xffffff, this.stage.desert ? 0x8a6a45 : 0x557040, 1.3);
    this.scene.add(sun);
    this.hemiLight = sun;
    const key = new THREE.DirectionalLight(0xfff2d4, 1.9);
    key.position.set(30, 50, -20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ccbff, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);
    this.keyLight = key;

    this.snowFx = null;
    if (this.stage.snow) { // 暴風雪:雪粒子盒跟著馬走(常態飄雪+陣風加強)
      const N = 750;
      const pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i += 1) {
        pos[i * 3] = (Math.random() - 0.5) * 70;
        pos[i * 3 + 1] = Math.random() * 26;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.32, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
      this.snowFx = { pts: new THREE.Points(geo, mat), speeds: Float32Array.from({ length: N }, () => 4 + Math.random() * 4) };
      this.scene.add(this.snowFx.pts);
      this.blizzard = 0;
      this.blizzardWarned = false;
    }

    this.aurora = null;
    if (this.stage.days) { // 夜間極光(第二賽段):環繞賽道質心
      let cx = 0, cz = 0;
      const pts = [];
      for (let i = 0; i < 32; i += 1) {
        const cp = this.posAt((i / 32) * this.courseLen);
        pts.push(cp);
        cx += cp.x / 32;
        cz += cp.z / 32;
      }
      let maxR = 0;
      for (const cp of pts) maxR = Math.max(maxR, Math.hypot(cp.x - cx, cp.z - cz));
      this.aurora = makeAurora(cx, cz, maxR);
      this.scene.add(this.aurora.group);
    }

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(this.stage.len * 2.2, this.stage.len * 2.2), new THREE.MeshStandardMaterial({ color: this.stage.snow ? 0xe8eef4 : this.stage.desert ? 0xe3c17f : 0x4f8a44, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    this.scene.add(grass);
    if (this.stageId === "meadow") {
      const sand = new THREE.Mesh(new THREE.PlaneGeometry(96, 72), new THREE.MeshStandardMaterial({ color: 0xd9c9a0, roughness: 1 }));
      sand.rotation.x = -Math.PI / 2;
      this.scene.add(sand);
    }

    // 場邊白欄(上下兩條)
    const railMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });
    const mkRail = (w, x, z, rot = 0) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.1), railMat);
      r.position.set(x, 1.0, z);
      r.rotation.y = rot;
      this.scene.add(r);
      const r2 = r.clone();
      r2.position.y = 0.55;
      this.scene.add(r2);
    };
    mkRail(96, 0, 36);
    mkRail(96, 0, -36);
    mkRail(72, 48, 0, Math.PI / 2);
    mkRail(72, -48, 0, Math.PI / 2);

    // 賽道白沙帶(把路線畫在地上,孩子一眼看懂要跑哪)
    const laneMat = new THREE.MeshBasicMaterial({ color: 0xe8dcbc });
    for (let i = 0; i < 120; i += 1) {
      const d = (i / 120) * this.courseLen;
      const p = this.posAt(d);
      const t = this.tangentAt(d);
      const dot = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.6), laneMat);
      dot.rotation.order = "YXZ"; // 先繞 y 對齊路徑方向,再倒平到地面(XYZ 順序會變鋸齒)
      dot.rotation.y = Math.atan2(t.x, t.z);
      dot.rotation.x = -Math.PI / 2 + this.slopePitch(d); // 貼坡
      dot.position.set(p.x, p.y + 0.06, p.z);
      this.scene.add(dot);
    }

    // 馬+騎手(角色可選:傑洛/喬尼);毛色照設定
    const coat = HORSE_COATS[this.coatId] || HORSE_COATS.brown;
    this.horse = makeHorse({ coat: coat.coat, mane: coat.mane });
    this.scene.add(this.horse.group);

    // 競速模式的 AI 對手:銀灰馬(非競速模式隱藏);騎手=玩家沒選的那位
    this.aiHorse = makeHorse({ coat: 0x9aa0a8, mane: 0x5f6670 });
    this.scene.add(this.aiHorse.group);
    this.aiHorse.group.visible = false;

    this.applyRiderCharacter();

    this.buildCrowd();
    this.rebuildFences();

    // 觀賽台+樹
    const standMat = new THREE.MeshStandardMaterial({ color: 0x6b7687, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(60, 3.2, 5), standMat);
      stand.position.set(0, 1.6, side * 41.5);
      this.scene.add(stand);
    }
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 1 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.9 });
    for (const [x, z] of [[-62, 20], [-58, -18], [60, 24], [64, -10], [-30, 55], [25, 58], [0, -60], [40, -55]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 3, 8), trunkMat);
      trunk.position.set(x, 1.5, z);
      this.scene.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 10), treeMat);
      crown.position.set(x, 4.6, z);
      this.scene.add(crown);
    }

    this.placeHorse();
  }

  buildCrowd() {
    // 兩側觀賽台前的有臉觀眾(臉朝場內;07-11 鐵則:觀眾要有臉、男女各半)
    this.crowd = new THREE.Group();
    const shirts = [0xd98a3d, 0x3d78d9, 0xc94f8f, 0x4fae6a, 0xb0552f, 0x8a5ac0];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i += 1) {
        const p = makePerson({
          shirt: shirts[(i + (side > 0 ? 3 : 0)) % shirts.length],
          pants: 0x2c3340,
          hair: HAIR_COLORS[(i * 2 + (side > 0 ? 1 : 0)) % HAIR_COLORS.length],
          gender: (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "m" : "f",
          scale: 0.92,
        });
        p.group.position.set(-27 + i * 9, 0, side * 38.2);
        p.group.rotation.y = side > 0 ? Math.PI : 0;
        this.crowd.add(p.group);
      }
    }
    this.scene.add(this.crowd);
  }

  placeHorse() {
    const p = this.posAt(this.dist);
    const t = this.tangentAt(this.dist);
    let ox = 0, oz = 0;
    if (this.mode.sprint) { // 自由奔跑:玩家自由跑位
      ox = -t.z * this.playerLane;
      oz = t.x * this.playerLane;
    } else if (this.mode.race) { // 我方靠內線,AI 外線
      ox = -t.z * RACE_LANE;
      oz = t.x * RACE_LANE;
    }
    this.horse.group.position.set(p.x + ox, p.y + this.jumpY(), p.z + oz);
    this.horse.group.rotation.order = "YXZ"; // 先 yaw 再俯仰(貼片鐵則同款)
    this.horse.group.rotation.y = Math.atan2(t.x, t.z);
    this.horse.group.rotation.x = this.slopePitch(this.dist) * 0.8; // 下坡鼻朝下
    this.horse.group.rotation.z = -(this.steerVis || 0) * 0.12; // 跑位側傾
    if (this.mode.race && this.aiHorse && this.aiHorse.group.visible) {
      const ap = this.posAt(this.aiDist);
      const at = this.tangentAt(this.aiDist);
      const ay = this.aiJumpAnim ? Math.sin(Math.PI * clamp(this.aiJumpAnim.t, 0, 1)) * this.aiJumpAnim.height : 0;
      this.aiHorse.group.position.set(ap.x + at.z * RACE_LANE, ap.y + ay, ap.z - at.x * RACE_LANE);
      this.aiHorse.group.rotation.order = "YXZ";
      this.aiHorse.group.rotation.y = Math.atan2(at.x, at.z);
      this.aiHorse.group.rotation.x = this.slopePitch(this.aiDist) * 0.8;
    }
  }

  jumpY() {
    if (!this.jumpAnim) return 0;
    const k = clamp(this.jumpAnim.t, 0, 1);
    return Math.sin(Math.PI * k) * this.jumpAnim.height;
  }

  // ---------- 輸入 ----------
  setupInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.jump();
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId, horseCoat, riderCharacter, stage, opponent }) {
    if (stage && STAGES[stage]) this.setStage(stage);
    if (opponent) this.setOpponent(opponent);
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    if (horseCoat && HORSE_COATS[horseCoat]) this.setHorseCoat(horseCoat);
    if (riderCharacter && RIDERS[riderCharacter]) this.setRiderCharacter(riderCharacter);
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId, riderCharacter: this.riderId, stage: this.stageId, opponent: this.opponentId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} · ${RIDERS[this.riderId].label} 騎 ${HORSE_COATS[this.coatId].label} 已設定。`;
    this.pushHud();
  }

  // 換騎手角色:整組重掛(帽/鬍/星星是結構件,不能只換材質色);對手騎另一位
  applyRiderCharacter() {
    if (this.rider) this.horse.rig.remove(this.rider.group);
    this.rider = makeRiderCharacter(this.riderId);
    poseRiderOnSaddle(this.rider);
    this.horse.rig.add(this.rider.group);
    if (this.aiHorse) {
      if (this.aiRider) this.aiHorse.rig.remove(this.aiRider.group);
      if (this.opponentId !== "random" && RIDERS[this.opponentId]) {
        this.aiRiderId = this.opponentId; // 指定對手(可鏡像對決)
      } else {
        const pool = Object.keys(RIDERS).filter((k) => k !== this.riderId);
        this.aiRiderId = pool[Math.floor(Math.random() * pool.length)]; // 隨機騎另外兩位之一
      }
      this.aiRider = makeRiderCharacter(this.aiRiderId);
      poseRiderOnSaddle(this.aiRider);
      this.aiHorse.rig.add(this.aiRider.group);
    }
  }

  setRiderCharacter(riderId) {
    if (!RIDERS[riderId] || riderId === this.riderId) return;
    this.riderId = riderId;
    if (this.horse) this.applyRiderCharacter();
  }

  setOpponent(opponentId) {
    if (opponentId !== "random" && !RIDERS[opponentId]) return;
    if (opponentId === this.opponentId) return;
    this.opponentId = opponentId;
    if (this.horse) this.applyRiderCharacter(); // 重生對手騎手
  }

  // ---------- 技能:傑洛的鋼球 ----------
  tryUseSkill() {
    if (this.phase !== "riding" && this.phase !== "jumping") return;
    if (this.aiTimeStop > 0) return; // 你的時間被停了,動不了
    const skill = RIDER_SKILLS[this.riderId];
    if (!skill) {
      this.message = "這位騎手沒有技能!";
      this.pushHud();
      return;
    }
    if (!this.mode.race) {
      this.message = skill.label + "要在「雙騎競速」對決時才派得上用場!";
      this.pushHud();
      return;
    }
    if (this.skillCd > 0) {
      this.message = `${skill.label}回轉中……還要 ${this.skillCd.toFixed(1)} 秒`;
      this.pushHud();
      return;
    }
    if (this.aiFall < FALL_DUR + 1) {
      this.message = "對手還在爬起來——等他上馬再出招!";
      this.pushHud();
      return;
    }
    this.skillCd = skill.cooldown;
    if (this.riderId === "diego") {
      this.timeStop = TIMESTOP_DUR;
      this._setWorldGray(true, this.horse.group); // 世界抽色,只有我(迪亞哥)有顏色
      this.message = "迪亞哥:THE WORLD!時間停止 5 秒——只有你能動!";
    } else {
      this.throwSteelBall("me", this.riderId);
      this.message = this.riderId === "johnny" ? "喬尼射出爪彈——黃金迴旋!" : "傑洛擲出鋼球!";
    }
    this.emitEvent("skill", { who: "me" });
    this.pushHud();
  }

  throwSteelBall(from, kind = "gyro") {
    const srcHorse = from === "me" ? this.horse : this.aiHorse;
    if (!srcHorse) return;
    const isNail = kind === "johnny";
    const mesh = isNail ? makeNailBullet() : makeSteelBall();
    const sp = srcHorse.group.position;
    mesh.position.set(sp.x, sp.y + 1.7, sp.z); // 跟地形高度(寫死 2.3 在高原=生成在地底,07-17 修)
    this.scene.add(mesh);
    this.balls.push({
      mesh,
      vel: new THREE.Vector3(0, 2.5, 0),
      t: 0,
      from,
      smokeT: 0,
      dead: false,
      speed: isNail ? 38 : BALL_SPEED, // 爪彈快、鋼球重
      trailColor: isNail ? 0x7fd4ff : 0xf2d24a,
      spinZ: isNail ? 26 : 5, // 爪彈膛線高速迴旋
    });
    if (isNail) this.spawnGoldenSpin(srcHorse); // 發射瞬間:馬身黃金長方形迴旋
  }

  spawnGoldenSpin(horse) {
    const fx = makeGoldenSpin();
    horse.rig.add(fx.group);
    this.spinFx.push({ group: fx.group, mats: fx.mats, t: 0, host: horse });
  }

  spawnSmokePuff(pos, big = false, color = 0xf2d24a) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(big ? 0.22 : 0.13, 8, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
    );
    puff.position.copy(pos);
    if (big) {
      puff.position.x += (Math.random() - 0.5) * 0.8;
      puff.position.y += (Math.random() - 0.5) * 0.8;
      puff.position.z += (Math.random() - 0.5) * 0.8;
    }
    this.scene.add(puff);
    this.smokePuffs.push({ mesh: puff, t: 0 });
  }

  updateSkills(delta) {
    this.meFall = (this.meFall ?? 9) + delta;
    this.aiFall = (this.aiFall ?? 9) + delta;
    if (this.skillCd > 0) this.skillCd = Math.max(0, this.skillCd - delta);

    // THE WORLD 時停:計時+復原(畫面回彩色);時停期間飛行物/煙霧全凍結(見下)
    if (this.timeStop > 0) {
      this.timeStop -= delta;
      if (this.timeStop <= 0) {
        this._setWorldGray(false);
        this.message = "時間再次流動。";
        this.pushHud();
      }
    }
    if (this.aiTimeStop > 0) {
      this.aiTimeStop -= delta;
      if (this.aiTimeStop <= 0) {
        this._setWorldGray(false);
        this.message = "時間再次流動——追回來!";
        this.pushHud();
      }
    }
    const frozenWorld = this.timeStop > 0 || this.aiTimeStop > 0; // 時停中:投擲物懸停在半空

    for (const b of this.balls) {
      if (frozenWorld) break; // THE WORLD:子彈/鋼球凍結在半空
      b.t += delta;
      const targetHorse = b.from === "me" ? this.aiHorse : this.horse;
      if (!targetHorse) {
        b.dead = true;
        continue;
      }
      const tp = targetHorse.group.position;
      const aim = new THREE.Vector3(tp.x, tp.y + 1.8, tp.z).sub(b.mesh.position); // 目標高度跟地形
      const distTo = aim.length();
      aim.normalize().multiplyScalar(b.speed || BALL_SPEED);
      b.vel.lerp(aim, Math.min(1, delta * 8)); // 微追蹤:會轉彎咬住目標
      b.mesh.position.addScaledVector(b.vel, delta);
      if (b.spinZ >= 20 && b.vel.lengthSq() > 0.01) {
        b.mesh.lookAt(b.mesh.position.clone().add(b.vel)); // 爪彈頭朝飛行方向
        b.mesh.rotation.z += b.t * b.spinZ; // 膛線迴旋
      } else {
        b.mesh.rotation.x += 15 * delta; // 鋼球高速自旋
        b.mesh.rotation.z += 5 * delta;
      }
      // 尾跡(鋼球=黃煙、爪彈=青光)
      b.smokeT += delta;
      while (b.smokeT > 0.035) {
        b.smokeT -= 0.035;
        this.spawnSmokePuff(b.mesh.position, false, b.trailColor);
      }
      if (b.t > 3.2) b.dead = true; // 長射程:鋼球 ~83m、爪彈 ~121m 內都咬得到
      if (!b.dead && b.mesh.position.y < tp.y - 1.0 && distTo > 2.5) { // 觸地=收掉,不鑽土(07-17 修)
        b.dead = true;
        for (let i = 0; i < 5; i += 1) this.spawnSmokePuff(b.mesh.position, false, b.trailColor);
      }
      if (distTo < 1.4 && !b.dead) {
        b.dead = true;
        for (let i = 0; i < 12; i += 1) this.spawnSmokePuff(b.mesh.position, true, b.trailColor); // 命中爆開(同彈色)
        const fallOk = b.from === "me" ? this.aiFall >= FALL_DUR : this.meFall >= FALL_DUR;
        if (fallOk) {
          if (b.from === "me") {
            this.aiFall = 0;
            const other = RIDERS[this.riderId === "gyro" ? "johnny" : "gyro"].label;
            this.message = `鋼球命中!${other} 被打下馬!`;
          } else {
            this.meFall = 0;
            this.message = "被鋼球打下馬了!馬兒停下等你——馬上爬回去!";
          }
          this.emitEvent("skill-hit", { from: b.from });
          this.pushHud();
        }
      }
    }
    this.balls = this.balls.filter((b) => {
      if (b.dead) this.scene.remove(b.mesh);
      return !b.dead;
    });

    for (const p of this.smokePuffs) {
      if (frozenWorld) break;
      p.t += delta;
      p.mesh.scale.setScalar(1 + p.t * 3.2);
      p.mesh.material.opacity = Math.max(0, 0.75 * (1 - p.t / 0.6));
    }
    this.smokePuffs = this.smokePuffs.filter((p) => {
      if (p.t >= 0.6) {
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });

    // 黃金迴旋:繞馬旋轉+末段淡出(1.4s)
    for (const fx of this.spinFx) {
      fx.t += delta;
      fx.group.rotation.y += 7 * delta;
      const fade = fx.t > 1.0 ? Math.max(0, 1 - (fx.t - 1.0) / 0.4) : 1;
      for (const m of fx.mats) m.opacity = 0.9 * fade;
    }
    this.spinFx = this.spinFx.filter((fx) => {
      if (fx.t >= 1.4) {
        fx.host.rig.remove(fx.group);
        return false;
      }
      return true;
    });
  }

  // 換毛色:全身共用 coatMat/maneMat,改材質色即可(不重建馬)
  setHorseCoat(coatId) {
    if (!HORSE_COATS[coatId]) return;
    this.coatId = coatId;
    if (this.horse) {
      this.horse.coatMat.color.setHex(HORSE_COATS[coatId].coat);
      this.horse.maneMat.color.setHex(HORSE_COATS[coatId].mane);
    }
  }

  openHomeMenu() {
    this.phase = "menu";
    if (this.confetti) {
      for (const c of this.confetti) this.scene.remove(c.mesh);
      this.confetti = [];
    }
    this.message = "在首頁選擇模式與難度後開始。";
    this.overlay.visible = false;
    this.pushHud();
  }

  startSelectedMatch() {
    this.dist = 0;
    this.speed = 0;
    this.elapsed = 0;
    this.faults = 0;
    this.clears = 0;
    this.fenceIdx = 0;
    this.lastResult = null;
    this.jumpAnim = null;
    this.lap = 1;
    this.rebuildFences();
    this.finishDist = this.fences.length ? this.fences[this.fences.length - 1].dist + 22 : this.courseLen;
    // 競速 AI 重置
    this.aiDist = -2.5;
    this.aiSpeed = 0;
    this.aiGallopT = 0;
    this.aiFenceIdx = 0;
    this.aiJumpAnim = null;
    this.aiKnockSlowT = 9;
    this.knockSlowT = 9;
    this.aiFinished = false;
    // 技能重置
    for (const b of this.balls) this.scene.remove(b.mesh);
    for (const p of this.smokePuffs) this.scene.remove(p.mesh);
    for (const fx of this.spinFx) fx.host.rig.remove(fx.group);
    this.balls = [];
    this.smokePuffs = [];
    this.spinFx = [];
    this.skillCd = 0;
    this.aiSkillCd = 6 + Math.random() * 4;
    this.meFall = 9;
    this.aiFall = 9;
    this.timeStop = 0;
    this.aiTimeStop = 0;
    this._setWorldGray(false);
    this.canvas.style.filter = "";
    this.playerLane = -RACE_LANE;
    this.steerVis = 0;
    this.stamina = 1;
    this.tired = false;
    this.aiStamina = 1;
    this.aiTurbo = false;
    this.aiTired = false;
    if (this.aiHorse) this.aiHorse.group.visible = !!this.mode.race;
    this.placeHorse();
    // 起跑鏡頭直接切到馬後方(joash 教訓:lerp 穿場=整幀糊掉)
    const t0 = this.tangentAt(0);
    const p0 = this.posAt(0);
    this.camPos.set(p0.x - t0.x * 9, 4.6, p0.z - t0.z * 9);
    this.camLook.set(p0.x, 1.4, p0.z);
    this.phase = "gate";
    this.message = "按「起跳鍵」出發!沿白沙路線跑,接近欄架時抓綠區起跳!";
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  // 出發/起跳共用(空白鍵/點畫面/觸控跳鍵)
  jump() {
    if (this.overlay.visible) return;
    if (this.aiTimeStop > 0) return; // 你的時間被停了
    if ((this.meFall ?? 9) < FALL_DUR) return; // 人還在地上,先爬回馬再說
    if (this.phase === "gate") {
      this.phase = "riding";
      this.speed = DIFFICULTY_PRESETS[this.difficulty].baseSpeed * 0.6;
      this.message = "出發!按住「加速」提速,放開收步穩節奏。";
      this.emitEvent("gate", {});
      this.pushHud();
      return;
    }
    if (this.phase !== "riding") return;
    const fence = this.fences[this.fenceIdx];
    if (!fence) return;
    const distToFence = fence.dist - this.dist;
    if (distToFence > APPROACH_M) {
      // 離欄還遠就按=小跳一下,不罰但提示(溫柔)
      this.startJump(fence, 0.35, true);
      this.lastResult = "early";
      this.message = "太早起跳了——等靠近欄架、時機條進綠區再跳!";
      this.emitEvent("fence-early", {});
      this.pushHud();
      return;
    }
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const err = Math.abs(distToFence - TAKEOFF_D) / Math.max(this.speed, 1);
    let quality = clamp(1 - err / (preset.window * 2.2), 0, 1); // skijump 綠區同款判定式
    quality = clamp(quality + preset.assist * (1 - quality), 0, 1); // 幼兒輔助:往綠區拉
    this.startJump(fence, quality, false);
  }

  startJump(fence, quality, hop) {
    const dur = (hop ? JUMP_SPAN * 0.6 : JUMP_SPAN) / Math.max(this.speed, 3);
    this.jumpAnim = {
      t: 0,
      dur,
      quality,
      height: hop ? 0.6 : 1.1 + quality * 0.8,
      fence: hop ? null : fence,
    };
    this.phase = "jumping";
    this.emitEvent("jump", { quality, hop });
  }

  resolveFence(fence, quality) {
    fence.resolved = true;
    const clean = quality >= 0.5; // 07-15 加難:過欄門檻 0.45→0.5
    if (clean) {
      this.clears += 1;
      this.lastResult = "clear";
      const perfect = quality >= 0.88;
      this.message = perfect ? "完美起跳!輕鬆飛過!" : "過欄!繼續盯下一道。";
      this.emitEvent("fence-clear", { idx: this.fenceIdx + 1, perfect });
    } else {
      fence.knocked = true;
      this.faults += 4;
      this.lastResult = "knock";
      if (this.mode.race) {
        this.knockSlowT = 0; // 競速:碰桿=踉蹌減速 1.4 秒
        this.message = "碰桿!馬兒踉蹌減速——穩住追回來!";
      } else {
        this.message = "碰桿!+4 罰分——穩住,下一道抓準綠區。";
      }
      this.knockAnims.push({ fence, t: 0 });
      this.emitEvent("fence-knock", { idx: this.fenceIdx + 1, faults: this.faults });
    }
    this.fenceIdx += 1;
    // 練習場:跳完一輪重置欄架再來一圈(欄架里程推進到下一圈)
    if (this.mode.endless && this.fenceIdx >= this.fences.length) {
      this.fenceIdx = 0;
      this.lap += 1;
      for (const f of this.fences) {
        f.resolved = false;
        if (f.knocked) {
          f.knocked = false;
          f.topRail.position.set(0, 1.35, 0);
          f.topRail.rotation.set(0, 0, Math.PI / 2);
        }
        f.dist += this.courseLen;
      }
      this.finishDist += this.courseLen;
    }
  }

  // 零罰分慶祝(07-15 使用者提議:天上掉彩花/花瓣/彩帶):
  // 尊重 prefers-reduced-motion;彩紙+花瓣+彩帶三種形狀,7 秒自然落完
  spawnConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!this.confetti) this.confetti = [];
    const colors = [0xffd24a, 0xff6b81, 0x7de08c, 0x6ec6ff, 0xc890ff, 0xffa050, 0xf5f0e0];
    const p = this.posAt(this.dist);
    for (let i = 0; i < 160; i += 1) {
      const kind = i % 3; // 0 彩紙方片 1 花瓣圓片 2 彩帶長條
      const geo = kind === 0
        ? new THREE.PlaneGeometry(0.16, 0.16)
        : kind === 1
          ? new THREE.CircleGeometry(0.1, 6)
          : new THREE.PlaneGeometry(0.06, 0.5);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      }));
      mesh.position.set(p.x + (Math.random() * 2 - 1) * 14, 8 + Math.random() * 7, p.z + (Math.random() * 2 - 1) * 14);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      this.confetti.push({
        mesh,
        vy: 1.2 + Math.random() * 1.6,
        swayA: Math.random() * Math.PI * 2,
        swayF: 1.5 + Math.random() * 2,
        spin: (Math.random() * 2 - 1) * 3,
        t: 0,
      });
    }
  }

  finishCourse() {
    this.phase = "ended";
    if (this.mode.race) {
      const win = !this.aiFinished; // 我方先觸發完賽=贏;AI 先到觸發=輸
      const timeText = this.stage.days ? this.dayText() : this.elapsed.toFixed(1) + " 秒";
      if (win) this.spawnConfetti();
      this.overlay = {
        visible: true,
        eyebrow: win ? "勝利!" : "惜敗",
        title: win ? "第一個衝線!" : "AI 先到了……",
        text: win
          ? timeText + " 衝過終點,把藍騎士甩在後面!(碰桿 " + this.faults / 4 + " 次)"
          : "差一點!穩住節奏、少碰桿,再來一場追回來!(用時 " + timeText + ")",
        canResume: false,
      };
      this.emitEvent("race-end", { win, elapsed: this.elapsed });
      this.message = win ? "勝利!" + timeText + " 先馳得點!" : "AI 先衝線——再來一場!";
      this.saveGame(true);
      this.pushHud();
      return;
    }
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const allowed = this.allowedTime(preset);
    const overTime = Math.max(0, this.elapsed - allowed);
    const timeFaults = allowed >= 999 ? 0 : Math.ceil(overTime / 4);
    const total = this.faults + timeFaults;
    const timeText = this.stage.days ? this.dayText() : `${this.elapsed.toFixed(1)} 秒`;
    if (this.mode.jumpoff) {
      const score = this.elapsed + this.faults;
      this.overlay = {
        visible: true,
        eyebrow: "決勝圈完賽",
        title: `${score.toFixed(1)} 秒`,
        text: `騎行 ${timeText}+罰分 ${this.faults}(換算秒)。敢加速、又穩得住,才是決勝圈之王!`,
        canResume: false,
      };
      if (this.faults === 0) this.spawnConfetti();
      this.emitEvent("finish", { faults: this.faults, elapsed: this.elapsed, clearRound: this.faults === 0 });
    } else {
      const clearRound = total === 0;
      this.overlay = {
        visible: true,
        eyebrow: clearRound ? "零罰分!" : "完賽",
        title: clearRound ? "Clear Round!" : `罰分 ${total}`,
        text: clearRound
          ? `完美的一輪!${timeText} 跳完全程、一桿未碰。`
          : `碰桿 ${this.faults}${timeFaults ? ` + 超時 ${timeFaults}` : ""} 罰分,用時 ${timeText}。再來一場,朝零罰分前進!`,
        canResume: false,
      };
      if (clearRound) this.spawnConfetti();
      this.emitEvent("finish", { faults: total, elapsed: this.elapsed, clearRound });
    }
    this.message = `完賽——罰分 ${total},${timeText}。`;
    this.saveGame(true);
    this.pushHud();
  }

  togglePause() {
    if (this.phase === "menu" || this.phase === "ended") return;
    if (this.overlay.visible) {
      this.resume();
    } else {
      this.overlay = { visible: true, eyebrow: "暫停中", title: "喘口氣", text: "馬兒也歇歇蹄,準備好再繼續。", canResume: true };
      this.pushHud();
    }
  }

  resume() {
    if (!this.overlay.canResume) return;
    this.overlay.visible = false;
    this.pushHud();
  }

  cycleCameraView() {
    this.cameraView = (this.cameraView + 1) % 4;
    const names = ["跟隨視角", "側面轉播", "高空俯瞰", "馬上視角"];
    this.message = `視角:${names[this.cameraView]}。`;
    this.pushHud();
  }

  // ---------- 主迴圈 ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(delta);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height || 1.6;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(delta) {
    this.time += delta;
    const paused = this.overlay.visible;

    if (!paused && (this.phase === "riding" || this.phase === "jumping")) {
      this.elapsed += delta;
      const preset = DIFFICULTY_PRESETS[this.difficulty];
      const boosting = this.input.isDown("up");
      const slowing = this.input.isDown("down");
      let target = preset.baseSpeed + (boosting ? preset.boost : 0) - (slowing ? 2.2 : 0);
      // 高速奔跑(Shift/⚡):最高速再+4,但燒體力;見底要回到 25% 才能再衝
      if (this.tired && this.stamina > 0.25) this.tired = false;
      const turbo = this.input.isDown("sprint") && !this.tired && this.stamina > 0;
      if (turbo) {
        target = preset.baseSpeed + preset.boost + TURBO_BOOST - (slowing ? 2.2 : 0);
        this.stamina = Math.max(0, this.stamina - TURBO_DRAIN * delta);
        if (this.stamina <= 0) {
          this.tired = true;
          this.message = "馬兒喘了——體力見底,收一收等牠回氣!";
        }
      } else {
        this.stamina = Math.min(1, this.stamina + TURBO_REGEN * delta);
      }
      this.turboVis = turbo;
      this.knockSlowT = (this.knockSlowT ?? 9) + delta;
      if (this.mode.race && this.knockSlowT < 1.4) target *= 0.5; // 碰桿踉蹌
      const meFrozen = this.aiTimeStop > 0; // 被 THE WORLD 停住
      if (meFrozen) target = 0;
      // 技能鍵(K/E/觸控「鋼球」)
      if (this.input.consumePress("action")) this.tryUseSkill();
      if (this.mode.sprint && !meFrozen) { // 自由奔跑:左右鍵橫移(A/D 或 ←→)
        const steer = (this.input.isDown("right") ? 1 : 0) - (this.input.isDown("left") ? 1 : 0);
        this.playerLane = clamp(this.playerLane + steer * 5 * delta, -3.2, 3.2);
        this.steerVis = steer;
      } else {
        this.steerVis = 0;
      }
      const meDown = this.meFall < FALL_DUR || meFrozen; // 落馬或被 THE WORLD 停住:馬停下
      if (meDown) target = 0;
      this.speed += (Math.max(meDown ? 0 : 3, target) - this.speed) * Math.min(1, delta * (meDown ? 6 : 1.8));
      this.dist += this.speed * delta;
      this.gallopT += delta * (this.speed / 8);

      if (this.phase === "jumping" && this.jumpAnim) {
        this.jumpAnim.t += delta / this.jumpAnim.dur;
        if (this.jumpAnim.t >= 1) {
          const jump = this.jumpAnim;
          this.jumpAnim = null;
          this.phase = "riding";
          if (jump.fence) this.resolveFence(jump.fence, jump.quality);
        }
      } else if (this.phase === "riding") {
        // 沒按起跳就衝到欄前=馬自己弱弱一跳(溫柔:不停不摔,但多半碰桿)
        const fence = this.fences[this.fenceIdx];
        if (fence && fence.dist - this.dist <= 0.5 && !fence.resolved) {
          this.startJump(fence, 0.18, false);
          this.message = "來不及起跳——馬兒自己撐了一下!";
        }
      }

      if (!this.mode.endless && this.dist >= this.finishDist && this.phase !== "ended") {
        this.finishCourse();
      }

      // —— 競速 AI(同賽道外線):控速+起跳品質依難度,碰桿一樣踉蹌 ——
      if (this.mode.race && this.phase !== "ended" && this.timeStop <= 0) { // 玩家 THE WORLD 期間 AI 整段凍結
        const ai = RACE_AI[this.difficulty];
        this.aiKnockSlowT += delta;
        // AI 體力統一模型(07-16 修:原本加速免費=無限快跑):
        // 加速也燒體力(0.08/s)、衝刺更兇(0.22/s);見底=只剩基礎速慢跑,回到 30% 才能再快
        if (this.aiTired && this.aiStamina > 0.3) this.aiTired = false;
        const aiBoosting = !this.aiTired && Math.sin(this.time * 0.7 + 1.3) * 0.5 + 0.5 < ai.boostRatio;
        let aiTarget = preset.baseSpeed + (aiBoosting ? preset.boost : 0);
        if (this.aiKnockSlowT < 1.4) aiTarget *= 0.5;
        if (!this.aiTurbo && !this.aiTired && this.aiDist < this.dist - 5 && this.aiStamina > 0.5) this.aiTurbo = true;
        if (this.aiTurbo && (this.aiTired || this.aiStamina <= 0.05 || this.aiDist > this.dist + 2)) this.aiTurbo = false;
        if (this.aiTurbo) {
          aiTarget = preset.baseSpeed + preset.boost + TURBO_BOOST * 0.9;
          this.aiStamina = Math.max(0, this.aiStamina - TURBO_DRAIN * delta);
        } else if (aiBoosting) {
          this.aiStamina = Math.max(0, this.aiStamina - 0.08 * delta);
        } else {
          this.aiStamina = Math.min(1, this.aiStamina + TURBO_REGEN * delta);
        }
        if (this.aiStamina <= 0 && !this.aiTired) this.aiTired = true;
        const aiDown = this.aiFall < FALL_DUR;
        if (aiDown) aiTarget = 0;
        this.aiSpeed += (Math.max(aiDown ? 0 : 3, aiTarget) - this.aiSpeed) * Math.min(1, delta * (aiDown ? 4 : 1.8));
        this.aiDist += this.aiSpeed * delta;
        this.aiGallopT += delta * (this.aiSpeed / 8);
        // AI 回敬:對手隨機騎另外兩位之一,各用各的招——冷卻長、有預告,溫柔版
        if (!aiDown) {
          const aiKind = this.aiRiderId || "johnny";
          this.aiSkillCd -= delta;
          const gap = Math.abs(this.aiDist - this.dist);
          // 發招距離依招式:時停不吃距離;投擲系=彈道壽命內追得到的範圍
          const range = aiKind === "diego" ? Infinity : aiKind === "johnny" ? 100 : 70;
          if (this.aiSkillCd <= 0 && gap > 2 && gap < range && this.meFall >= FALL_DUR + 1) {
            this.aiSkillCd = 14 + Math.random() * 5;
            if (aiKind === "diego") {
              this.aiTimeStop = TIMESTOP_AI_DUR;
              this._setWorldGray(true, this.aiHorse.group); // 世界抽色,只有對面迪亞哥有顏色
              this.message = "對面的迪亞哥:THE WORLD!你被時停了!";
            } else {
              this.throwSteelBall("ai", aiKind);
              this.message = aiKind === "johnny" ? "對面的喬尼射出爪彈——小心!" : "對面的傑洛擲出鋼球——小心!";
            }
            this.pushHud();
          }
        }

        if (this.aiJumpAnim) {
          this.aiJumpAnim.t += delta / this.aiJumpAnim.dur;
          if (this.aiJumpAnim.t >= 1) {
            const q = this.aiJumpAnim.quality;
            this.aiJumpAnim = null;
            if (q < 0.5) this.aiKnockSlowT = 0; // AI 碰桿踉蹌(不動桿子,桿子演出留給玩家欄)
            this.aiFenceIdx += 1;
          }
        } else if (!aiDown) {
          const aiFence = this.fences[this.aiFenceIdx];
          if (aiFence && aiFence.dist - this.aiDist <= TAKEOFF_D + 0.3) {
            const q = clamp(ai.skill + (Math.random() * 2 - 1) * 0.22, 0, 1);
            this.aiJumpAnim = { t: 0, dur: JUMP_SPAN / Math.max(this.aiSpeed, 3), quality: q, height: 1.1 + q * 0.8 };
          }
        }
        if (this.aiDist >= this.finishDist && !this.aiFinished) {
          this.aiFinished = true;
          if (this.phase !== "ended") this.finishCourse(); // AI 先到=直接結算(我方輸)
        }
      }
    }

    if (!paused) this.updateSkills(delta);

    // 撞落的頂桿:往前滾落到地
    for (const k of this.knockAnims) {
      k.t += delta;
      const kt = clamp(k.t / 0.7, 0, 1);
      k.fence.topRail.position.y = 1.35 - kt * 1.15;
      k.fence.topRail.position.z = kt * 0.5;
      k.fence.topRail.rotation.x = kt * 0.5;
    }
    this.knockAnims = this.knockAnims.filter((k) => k.t < 0.9);

    // 彩花飄落(零罰分慶祝):左右搖曳+自旋,7 秒淡出回收
    if (this.confetti && this.confetti.length) {
      for (const c of this.confetti) {
        c.t += delta;
        c.mesh.position.y -= c.vy * delta;
        c.mesh.position.x += Math.sin(c.swayA + c.t * c.swayF) * delta * 1.2;
        c.mesh.rotation.x += c.spin * delta;
        c.mesh.rotation.z += c.spin * 0.7 * delta;
        if (c.t > 5.5) c.mesh.material.opacity = Math.max(0, 0.95 * (1 - (c.t - 5.5) / 1.5));
      }
      this.confetti = this.confetti.filter((c) => {
        if (c.t >= 7 || c.mesh.position.y < -0.5) {
          this.scene.remove(c.mesh);
          return false;
        }
        return true;
      });
    }

    this.handleKeys();
    this.updateHorsePose();
    this.placeHorse();
    this.updateBlizzard(delta);
    this.updateSky();
    this.updateCamera(delta);

    this.autoSaveTimer += delta;
    if (this.autoSaveTimer > 5) {
      this.autoSaveTimer = 0;
      this.saveGame(true);
    }

    this.input.endFrame();
    this.pushHud();
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot")) this.jump();
  }

  updateHorsePose() {
    const h = this.horse;
    if (!h) return;
    // 披風飄動(傑洛):靜止微垂,馬越快揚得越高、抖動越大;左右兩片相位錯開
    const animCapes = (rider, speed, tt) => {
      if (!rider || !rider.capes) return;
      const lift = clamp(speed / 12, 0, 1);
      rider.capes.forEach((p, i) => {
        p.rotation.x = 0.3 + lift * 0.7 + Math.sin(tt + i * 0.9) * (0.05 + lift * 0.2);
        p.rotation.z = (i === 0 ? 1 : -1) * (0.04 + Math.sin(tt * 0.8 + i * 1.7) * 0.06) * (0.4 + lift * 0.9);
      });
    };
    animCapes(this.rider, this.phase === "riding" || this.phase === "jumping" ? this.speed : 0, this.gallopT * Math.PI * 2.4);
    animCapes(this.aiRider, this.aiSpeed || 0, (this.aiGallopT || 0) * Math.PI * 2.4);
    // 被鋼球打下馬:騎手往側邊滑落到地,停一拍再爬回鞍上(卡通式,不猙獰)
    const animFall = (rider, t, side) => {
      if (!rider) return;
      let k = 0;
      if (t < FALL_DUR) k = t < 0.45 ? t / 0.45 : t > FALL_DUR - 0.45 ? (FALL_DUR - t) / 0.45 : 1;
      k = clamp(k, 0, 1);
      rider.group.rotation.z = side * 1.2 * k;
      rider.group.position.y = 1.02 - 0.85 * k;
      rider.group.position.x = side * 0.65 * k;
    };
    animFall(this.rider, this.meFall ?? 9, -1);
    animFall(this.aiRider, this.aiFall ?? 9, 1);
    if (this.phase === "jumping" && this.jumpAnim) {
      // 起跳:前腿收、後腿蹬、身體沿弧線俯仰;騎手前傾(two-point 跳姿)
      const k = clamp(this.jumpAnim.t, 0, 1);
      const pitch = Math.cos(Math.PI * k) * 0.35;
      h.rig.rotation.x = -pitch;
      h.rig.position.y = 0;
      const tuck = Math.sin(Math.PI * k);
      h.legs[0].pivot.rotation.x = -1.3 * tuck;
      h.legs[1].pivot.rotation.x = -1.3 * tuck;
      h.legs[0].joint.rotation.x = 1.8 * tuck;
      h.legs[1].joint.rotation.x = 1.8 * tuck;
      h.legs[2].pivot.rotation.x = 0.85 * tuck;
      h.legs[3].pivot.rotation.x = 0.85 * tuck;
      h.legs[2].joint.rotation.x = 0.5 * tuck;
      h.legs[3].joint.rotation.x = 0.5 * tuck;
      h.neckPivot.rotation.x = -0.25 + pitch * 0.4;
      if (this.rider) this.rider.rig.rotation.x = 0.4 * tuck;
      return;
    }
    // 奔跑循環:相位錯開的四腿擺動(簡化 canter)
    const sp = this.phase === "riding" ? this.speed : 0;
    const amp = clamp(sp / 14, 0, 0.62);
    const t = this.gallopT * Math.PI * 2;
    const phases = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    h.legs.forEach((leg, i) => {
      leg.pivot.rotation.x = Math.sin(t + phases[i]) * amp;
      leg.joint.rotation.x = Math.max(0, Math.sin(t + phases[i] + 0.8)) * amp * 1.3;
    });
    h.rig.rotation.x = 0;
    h.rig.position.y = Math.abs(Math.sin(t)) * amp * 0.14;
    h.neckPivot.rotation.x = Math.sin(t) * amp * 0.12;
    h.tail.rotation.x = 0.55 + Math.sin(t * 0.9) * 0.15;
    if (this.rider) this.rider.rig.rotation.x = amp * 0.18;

    // AI 馬動畫(競速)
    if (this.mode.race && this.aiHorse && this.aiHorse.group.visible) {
      const ah = this.aiHorse;
      if (this.aiJumpAnim) {
        const k = clamp(this.aiJumpAnim.t, 0, 1);
        const tuck = Math.sin(Math.PI * k);
        ah.rig.rotation.x = -Math.cos(Math.PI * k) * 0.35;
        ah.legs.forEach((leg, i) => {
          leg.pivot.rotation.x = (i < 2 ? -1.3 : 0.85) * tuck;
          leg.joint.rotation.x = (i < 2 ? 1.8 : 0.5) * tuck;
        });
      } else {
        const aamp = clamp(this.aiSpeed / 14, 0, 0.62);
        const at2 = this.aiGallopT * Math.PI * 2;
        const phases2 = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
        ah.rig.rotation.x = 0;
        ah.legs.forEach((leg, i) => {
          leg.pivot.rotation.x = Math.sin(at2 + phases2[i]) * aamp;
          leg.joint.rotation.x = Math.max(0, Math.sin(at2 + phases2[i] + 0.8)) * aamp * 1.3;
        });
        ah.rig.position.y = Math.abs(Math.sin(at2)) * aamp * 0.14;
        ah.neckPivot.rotation.x = Math.sin(at2) * aamp * 0.12;
        ah.tail.rotation.x = 0.55 + Math.sin(at2 * 0.9) * 0.15;
      }
    }
  }

  updateCamera(delta) {
    const p = this.posAt(this.dist);
    const t = this.tangentAt(this.dist);
    const y = this.jumpY();
    let desiredPos;
    let desiredLook;
    if (this.phase === "menu") {
      // 選單:慢速繞場巡禮
      const a = this.time * 0.08;
      desiredPos = new THREE.Vector3(Math.cos(a) * 40, 12, Math.sin(a) * 40);
      desiredLook = new THREE.Vector3(0, 1, 0);
    } else if (this.cameraView === 0) {
      const backH = this.heightAt(this.dist - 8.6);
      desiredPos = new THREE.Vector3(p.x - t.x * 8.6, backH + 4.4 + y * 0.5, p.z - t.z * 8.6);
      desiredLook = new THREE.Vector3(p.x + t.x * 7, p.y + 1.3 + y, p.z + t.z * 7);
    } else if (this.cameraView === 1) {
      const side = new THREE.Vector3(t.z, 0, -t.x);
      desiredPos = new THREE.Vector3(p.x + side.x * 13, p.y + 3.6, p.z + side.z * 13);
      desiredLook = new THREE.Vector3(p.x, p.y + 1.2 + y, p.z);
    } else if (this.cameraView === 2) {
      desiredPos = new THREE.Vector3(p.x + 3, p.y + 26, p.z + 3);
      desiredLook = new THREE.Vector3(p.x + t.x * 6, p.y + 0.5, p.z + t.z * 6);
    } else {
      const aheadH = this.heightAt(this.dist + 12);
      desiredPos = new THREE.Vector3(p.x - t.x * 0.6, p.y + 2.5 + y, p.z - t.z * 0.6);
      desiredLook = new THREE.Vector3(p.x + t.x * 12, aheadH + 1.2 + y, p.z + t.z * 12);
    }
    const k = 1 - Math.exp(-delta * 3.2);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // 小地圖資料(競速模式;path 取樣一次快取)
  getMinimapData() {
    if (!this._miniPath) {
      this._miniPath = [];
      for (let i = 0; i <= 100; i += 1) {
        const p = this.posAt((this.courseLen * i) / 100);
        this._miniPath.push([p.x, p.z]);
      }
    }
    const me = this.posAt(this.dist);
    const ai = this.mode.race && this.aiHorse && this.aiHorse.group.visible ? this.posAt(this.aiDist) : null;
    return {
      path: this._miniPath,
      me: [me.x, me.z],
      ai: ai ? [ai.x, ai.z] : null,
      fences: (this.fences || []).map((f) => {
        const p = this.posAt(f.dist % this.courseLen);
        return [p.x, p.z];
      }),
    };
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const fence = this.fences && this.fences[this.fenceIdx];
    const distToFence = fence ? Math.max(0, fence.dist - this.dist) : null;
    // 起跳時機條:進 APPROACH_M 內開始充,到理想起跳點=滿;err<window=綠區
    let approach01 = 0;
    let inWindow = false;
    if ((this.phase === "riding" || this.phase === "jumping") && fence && distToFence !== null && distToFence <= APPROACH_M) {
      approach01 = clamp(1 - (distToFence - TAKEOFF_D) / (APPROACH_M - TAKEOFF_D), 0, 1);
      const err = Math.abs(distToFence - TAKEOFF_D) / Math.max(this.speed, 1);
      inWindow = err <= preset.window;
    }
    const phaseLabels = { menu: "主選單", gate: "出發線", riding: "騎行", jumping: "騰空", ended: "完賽" };
    const mins = Math.floor(this.elapsed / 60);
    const secs = (this.elapsed % 60).toFixed(1).padStart(4, "0");
    const clockText = this.stage.days ? this.dayText() : `${mins}:${secs}`;
    this.onHudUpdate({
      faults: this.faults,
      clears: this.clears,
      fenceIdx: this.fences && this.fences.length ? Math.min(this.fenceIdx + 1, this.fences.length) : 1,
      fenceCount: this.fences ? this.fences.length : 0,
      lap: this.lap,
      endless: !!this.mode.endless,
      timeText: clockText,
      timeAllowed: this.mode.race
        ? (this.phase === "riding" || this.phase === "jumping"
          ? (this.dist >= this.aiDist ? "領先 " + (this.dist - this.aiDist).toFixed(0) + " m" : "落後 " + (this.aiDist - this.dist).toFixed(0) + " m")
          : "先到終點者勝")
        : this.allowedTime(preset) >= 999 ? "不限時" : this.allowedTime(preset) + " 秒",
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.speed / (preset.baseSpeed + preset.boost), 0, 1),
      speedText: `${(this.speed * 3.6).toFixed(0)} km/h`,
      stamina01: this.stamina,
      turbo: !!this.turboVis,
      approach01,
      inWindow,
      nextFenceText: distToFence === null ? "—" : distToFence > 90 ? "衝線!" : `${distToFence.toFixed(0)} m`,
      lastResult: this.lastResult,
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(記最佳成績,不存賽中進度) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = { difficulty: this.difficulty, modeId: this.modeId, bestFaults: prev.bestFaults, bestTime: prev.bestTime };
    if (this.phase === "ended" && !this.mode.endless) {
      const better =
        prev.bestFaults === undefined ||
        this.faults < prev.bestFaults ||
        (this.faults === prev.bestFaults && this.elapsed < (prev.bestTime ?? Infinity));
      if (better) {
        snapshot.bestFaults = this.faults;
        snapshot.bestTime = this.elapsed;
      }
    }
    saveGameState(snapshot);
    if (!silent) {
      this.message = "已存檔。";
      this.pushHud();
    }
  }

  loadGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    if (DIFFICULTY_PRESETS[snap.difficulty]) this.difficulty = snap.difficulty;
    if (GAME_MODES[snap.modeId]) {
      this.modeId = snap.modeId;
      this.mode = getModeConfig(snap.modeId);
    }
    this.openHomeMenu();
    this.message = snap.bestFaults !== undefined
      ? `最佳成績:罰分 ${snap.bestFaults}、${(snap.bestTime || 0).toFixed(1)} 秒——挑戰它!`
      : "尚無最佳成績,先跑一場吧!";
    this.pushHud();
    return true;
  }
}
