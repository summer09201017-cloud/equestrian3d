# 3D 馬術障礙賽(equestrian3d)

> HFPC 3D 系列「騎乘引擎」首發(2026-07-15)——馬沿賽道自動尋路,玩家只管
> **控速節奏**與**綠區時機起跳**。之後的聖經皮(騎驢進耶路撒冷、巴蘭騎驢)都 fork 這裡。

## 玩法

- **標準賽**:跳完整條路線(標準 8 欄)。碰桿 +4 罰分、超時每 4 秒 +1;零罰分=Clear Round!
- **決勝圈**:縮短路線拼速度,成績=時間+罰分換算秒。
- **練習場**:無限圈數自由練。

馬會沿白沙路線自己跑——按住「加速」(W/↑)拿捏節奏,接近欄架時在**綠區**按「起跳」
(空白鍵/點畫面)。時機誤差決定過欄品質(判定=畫面:按下當下就定結果,桿子在馬身過後才落)。
不會摔、不會淘汰:來不及按=馬自己弱弱一跳(多半碰桿),永遠跑得完。

- **七種馬毛色可選**:棗棕/白/黑/紅棕/銀灰/金黃/花斑(首頁選單即時換色)。
- 五難度(幼兒不限時+強輔助 → 職業 10 欄窄綠區)。

## 開發

```bash
npm install
npm run dev                      # 本機試玩(dev 不註冊 SW)
npm run build                    # 產物在 dist/
node scripts/gen-voice.mjs       # 烤人聲(雲哲 11 句;產物進 git,離線可玩)
node scripts/verify-equestrian.mjs <url> <outDir>  # Playwright 端到端(完美騎士/全碰桿/決勝圈/換色)
```

引擎重點:CatmullRom 閉環賽道(`posAt/tangentAt` 里程域)、skijump 同款綠區判定式
`quality = 1 - err/(window*2.2)`、四足馬 makeHorse(矩形身體+雙節腿+有臉)、
騎手=系列 makePerson 坐姿。人聲鐵律:預烤 mp3,缺檔只出字幕。

## 部署

Netlify 手動站:`npx netlify deploy --prod --dir dist --no-build --site hfpc-equestrian3d`
