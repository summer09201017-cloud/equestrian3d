# CLAUDE.md — equestrian3d(3D 馬術障礙賽=騎乘引擎的家)

> 2026-07-15 拍板:騎乘引擎首發=馬術(奧運皮);聖經皮佇列=騎驢進耶路撒冷(玩家=小驢駒,
> **不操控耶穌**)、巴蘭騎驢躲避天使(民22,玩家=驢)。GitHub 是唯一真相;帳號 summer09201017-cloud。

## 引擎核心(換皮時別動的)

- `buildCourse/posAt/tangentAt`:CatmullRom 閉環賽道,一切以「里程 dist」為域。
- `jump()` 判定=畫面:`err=|distToFence-TAKEOFF_D|/speed`,`quality=1-err/(window*2.2)`
  (skijump 綠區同款);按下當下定過欄/碰桿,桿子在馬過後才倒。
- `makeHorse`:四足=矩形身體鐵則(箱體軀幹+雙節腿+側置眼睛+鬃尾);
  `coatMat/maneMat` 共用材質 → `setHorseCoat` 改色不重建(HORSE_COATS 七色)。
- 騎手=`makePerson` 坐姿掛在 `horse.rig`;`updateHorsePose` 奔跑相位/騰躍收腿。
- 溫柔規則:沒按=auto weak jump(quality 0.18),永不淘汰。
- 騎手角色(07-15):`RIDERS`(gyro 傑洛/johnny 喬尼,SBR 致敬皮)+`RIDER_SKILLS` 技能系統——
  傑洛鋼球(K/E/觸控鈕,競速限定,黃煙尾跡+微追蹤,命中=對手落馬 `FALL_DUR` 秒後爬回;
  玩家選喬尼時 AI 傑洛會回敬,冷卻較長)。競速對手固定騎「另一位」。
- `this.running` 只給 RAF(athletics 撞名事故鐵則)。

## 換皮清單(騎驢版照這裡)

場景(_setupScene 的場地段)、坐騎外觀(makeHorse 參數/比例)、騎者(makePerson 或引擎控 NPC)、
GAME_MODES 文案、障礙類型(欄架→棕枝/衣服/天使站位)、voicePhrases(+SCRIPTURES 曉臻)、
identity 件組(manifest/sw cache/storage 鍵/title)。

## 本機地雷

- vite preview 接 `| head` 會被 SIGPIPE 收掉——背景跑不要接管線。
- 地面貼片要轉向:`rotation.order="YXZ"` 先 yaw 再倒平(XYZ 會鋸齒)。
- `[hidden]` 面板修正已內建(styles.css 底部)。
- 溝通一律繁體中文;聖經皮經文必先 cuv 查驗。

## 部署

Netlify 手動站 hfpc-equestrian3d(`--no-build --dir dist --site` 鐵則);
奧運頁/portfolio/gamefleet 同步照系列 HANDOFF。
