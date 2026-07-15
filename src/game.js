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
  kids: { baseSpeed: 6.5, boost: 2.5, window: 0.34, fences: 6, timeAllowed: 999, assist: 0.5 },
  child: { baseSpeed: 7.5, boost: 3.0, window: 0.26, fences: 7, timeAllowed: 120, assist: 0.3 },
  easy: { baseSpeed: 8.5, boost: 3.6, window: 0.2, fences: 8, timeAllowed: 95, assist: 0.15 },
  normal: { baseSpeed: 9.5, boost: 4.2, window: 0.15, fences: 8, timeAllowed: 80, assist: 0 },
  hard: { baseSpeed: 10.5, boost: 5.0, window: 0.11, fences: 10, timeAllowed: 72, assist: 0 },
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

// ---------- 場地常數 ----------
const TAKEOFF_D = 2.6; // 理想起跳點:欄前 2.6m(判定用時間域 err=|distToFence-TAKEOFF_D|/speed)
const JUMP_SPAN = 4.4; // 一跳跨越的路徑長(m)
const APPROACH_M = 14; // 進入「備跳」提示的距離
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

  const shoeMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.85 });
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: shirtMat, lowerMaterial: skinMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, 1.72, 0);
    arm.joint.rotation.x = -0.18;
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
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, head, waist, leftArm, rightArm, leftLeg, rightLeg };
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

  // 頸(斜上)+頭(兩側眼睛=臉部鐵則動物版)+雙耳+鬃毛
  const neckPivot = new THREE.Group();
  neckPivot.position.set(0, 1.82, 1.05);
  rig.add(neckPivot);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.72, 0.34), coatMat);
  neck.rotation.x = 0.7;
  neck.position.set(0, 0.26, 0.2);
  neckPivot.add(neck);
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

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.66, 0.14), maneMat);
  tail.position.set(0, 1.45, -1.22);
  tail.rotation.x = 0.55;
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
    this.scene.fog = new THREE.Fog(0x9fd0ee, 60, 160);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 240);
    this.camPos = new THREE.Vector3(0, 6, -14);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();

    this.buildCourse();
    this.setupScene();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // ---------- 賽道(閉環樣條)+障礙 ----------
  buildCourse() {
    const pts = [];
    const RX = 30, RZ = 21;
    for (let i = 0; i < 10; i += 1) {
      const a = (i / 10) * Math.PI * 2;
      const w = i % 2 === 0 ? 1.0 : 1.14; // 交錯外凸=直線與彎道交替的有機環
      pts.push(new THREE.Vector3(Math.cos(a) * RX * w, 0, Math.sin(a) * RZ * w));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5);
    this.courseLen = this.curve.getLength();
  }

  posAt(dist) {
    const u = (((dist % this.courseLen) + this.courseLen) % this.courseLen) / this.courseLen;
    return this.curve.getPointAt(u);
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
    const n = this.mode.jumpoff ? Math.max(5, preset.fences - 2) : preset.fences;
    const woodMat = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 });
    const railColors = [0xd8433c, 0x3f7be0, 0xf6d743, 0x4fae6a];
    for (let i = 0; i < n; i += 1) {
      const d = this.courseLen * ((i + 1) / (n + 1));
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
    const sun = new THREE.HemisphereLight(0xffffff, 0x557040, 1.3);
    this.scene.add(sun);
    const key = new THREE.DirectionalLight(0xfff2d4, 1.9);
    key.position.set(30, 50, -20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ccbff, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);

    const grass = new THREE.Mesh(new THREE.PlaneGeometry(320, 320), new THREE.MeshStandardMaterial({ color: 0x4f8a44, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    this.scene.add(grass);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(96, 72), new THREE.MeshStandardMaterial({ color: 0xd9c9a0, roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    this.scene.add(sand);

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
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(p.x, 0.012, p.z);
      this.scene.add(dot);
    }

    // 馬+騎手(紅衣白褲黑帽,經典馬術裝);毛色照設定
    const coat = HORSE_COATS[this.coatId] || HORSE_COATS.brown;
    this.horse = makeHorse({ coat: coat.coat, mane: coat.mane });
    this.scene.add(this.horse.group);
    this.rider = makePerson({ shirt: 0xb03030, pants: 0xe9e2d2, hair: 0x2b2119, scale: 0.95 });
    this.rider.leftLeg.pivot.rotation.x = -1.25;
    this.rider.leftLeg.pivot.rotation.z = 0.5;
    this.rider.leftLeg.joint.rotation.x = 1.5;
    this.rider.rightLeg.pivot.rotation.x = -1.25;
    this.rider.rightLeg.pivot.rotation.z = -0.5;
    this.rider.rightLeg.joint.rotation.x = 1.5;
    this.rider.leftArm.pivot.rotation.x = -0.95;
    this.rider.leftArm.joint.rotation.x = -0.5;
    this.rider.rightArm.pivot.rotation.x = -0.95;
    this.rider.rightArm.joint.rotation.x = -0.5;
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.4 });
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), helmetMat);
    helmet.position.y = 2.16;
    this.rider.rig.add(helmet);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.18), helmetMat);
    brim.position.set(0, 2.14, 0.24);
    this.rider.rig.add(brim);
    // 騎手掛在馬鞍上(座姿:人物髖 ~1.0,鞍面 ~1.6 → group 上移 0.62)
    this.rider.group.position.set(0, 1.02, 0.12);
    this.rider.group.scale.setScalar(0.95);
    this.horse.rig.add(this.rider.group);

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
    this.horse.group.position.set(p.x, this.jumpY(), p.z);
    this.horse.group.rotation.y = Math.atan2(t.x, t.z);
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
  applyPresentation({ difficulty, modeId, horseCoat }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    if (horseCoat && HORSE_COATS[horseCoat]) this.setHorseCoat(horseCoat);
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId, horseCoat: this.coatId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} · ${HORSE_COATS[this.coatId].label} 已設定。`;
    this.pushHud();
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
    const clean = quality >= 0.45;
    if (clean) {
      this.clears += 1;
      this.lastResult = "clear";
      const perfect = quality >= 0.85;
      this.message = perfect ? "完美起跳!輕鬆飛過!" : "過欄!繼續盯下一道。";
      this.emitEvent("fence-clear", { idx: this.fenceIdx + 1, perfect });
    } else {
      fence.knocked = true;
      this.faults += 4;
      this.lastResult = "knock";
      this.message = "碰桿!+4 罰分——穩住,下一道抓準綠區。";
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

  finishCourse() {
    this.phase = "ended";
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const overTime = Math.max(0, this.elapsed - preset.timeAllowed);
    const timeFaults = preset.timeAllowed >= 999 ? 0 : Math.ceil(overTime / 4);
    const total = this.faults + timeFaults;
    const timeText = `${this.elapsed.toFixed(1)} 秒`;
    if (this.mode.jumpoff) {
      const score = this.elapsed + this.faults;
      this.overlay = {
        visible: true,
        eyebrow: "決勝圈完賽",
        title: `${score.toFixed(1)} 秒`,
        text: `騎行 ${timeText}+罰分 ${this.faults}(換算秒)。敢加速、又穩得住,才是決勝圈之王!`,
        canResume: false,
      };
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
      const boosting = this.input.isDown("up") || this.input.isDown("sprint");
      const slowing = this.input.isDown("down");
      const target = preset.baseSpeed + (boosting ? preset.boost : 0) - (slowing ? 2.2 : 0);
      this.speed += (Math.max(3, target) - this.speed) * Math.min(1, delta * 1.8);
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
    }

    // 撞落的頂桿:往前滾落到地
    for (const k of this.knockAnims) {
      k.t += delta;
      const kt = clamp(k.t / 0.7, 0, 1);
      k.fence.topRail.position.y = 1.35 - kt * 1.15;
      k.fence.topRail.position.z = kt * 0.5;
      k.fence.topRail.rotation.x = kt * 0.5;
    }
    this.knockAnims = this.knockAnims.filter((k) => k.t < 0.9);

    this.handleKeys();
    this.updateHorsePose();
    this.placeHorse();
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
      desiredPos = new THREE.Vector3(p.x - t.x * 8.6, 4.4 + y * 0.5, p.z - t.z * 8.6);
      desiredLook = new THREE.Vector3(p.x + t.x * 7, 1.3 + y, p.z + t.z * 7);
    } else if (this.cameraView === 1) {
      const side = new THREE.Vector3(t.z, 0, -t.x);
      desiredPos = new THREE.Vector3(p.x + side.x * 13, 3.6, p.z + side.z * 13);
      desiredLook = new THREE.Vector3(p.x, 1.2 + y, p.z);
    } else if (this.cameraView === 2) {
      desiredPos = new THREE.Vector3(p.x + 3, 26, p.z + 3);
      desiredLook = new THREE.Vector3(p.x + t.x * 6, 0.5, p.z + t.z * 6);
    } else {
      desiredPos = new THREE.Vector3(p.x - t.x * 0.6, 2.5 + y, p.z - t.z * 0.6);
      desiredLook = new THREE.Vector3(p.x + t.x * 12, 1.2 + y, p.z + t.z * 12);
    }
    const k = 1 - Math.exp(-delta * 3.2);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
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
    this.onHudUpdate({
      faults: this.faults,
      clears: this.clears,
      fenceIdx: this.fences && this.fences.length ? Math.min(this.fenceIdx + 1, this.fences.length) : 1,
      fenceCount: this.fences ? this.fences.length : 0,
      lap: this.lap,
      endless: !!this.mode.endless,
      timeText: `${mins}:${secs}`,
      timeAllowed: preset.timeAllowed >= 999 ? "不限時" : `${preset.timeAllowed} 秒`,
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.speed / (preset.baseSpeed + preset.boost), 0, 1),
      speedText: `${(this.speed * 3.6).toFixed(0)} km/h`,
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
