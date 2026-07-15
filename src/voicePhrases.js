// 播報詞庫(固定句,全部預烤 mp3)+key 函式——scripts/gen-voice.mjs 與 runtime voice.js 共用。
// ★字幕可以帶罰分/秒數等動態字,「唸出來的」一律用這裡的固定句(人聲鐵律:不用 Web Speech 機器聲)。
// ⚠ edge-tts 雷:太短的句子會斷流——句子保持完整、以驚嘆/句號收尾。
export function voiceKey(text) {
  const s = String(text).replace(/\s+/g, "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const PHRASES = [
  // 開賽/出發
  "歡迎來到馬術障礙賽!控好節奏,綠區起跳!",
  "出發!穩住節奏,盯住第一道欄!",
  // 過欄
  "漂亮!完美起跳,輕鬆飛過!",
  "好一跳!乾乾淨淨!",
  "過欄成功,節奏很穩!",
  // 碰桿/失誤
  "哎呀,碰桿了,加四個罰分。",
  "太早起跳了,穩住再來。",
  "來不及起跳,馬兒自己撐了一下!",
  // 終場
  "零罰分!完美的一輪,全場歡呼!",
  "全程完成!辛苦了,好騎士!",
  "決勝圈完賽!好快的速度!",
];

// 馬術=奧運皮,無經文(聖經皮「騎驢進耶路撒冷」換皮時再加)
export const SCRIPTURES = [];
