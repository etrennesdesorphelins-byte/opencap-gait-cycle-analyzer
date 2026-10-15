// OpenCap の MarkerData/*.trc（マーカー3次元位置）を読み込む。
// 形式: 3行目にUnits、4行目にマーカー名（Frame#, Time, 名前, 空, 空, ...）、6行目以降がデータ。

export function parseTrc(text) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length < 6) throw new Error('TRCファイルの形式が不正です。');

  const metaKeys = lines[1].split('\t').map((s) => s.trim());
  const metaValues = lines[2].split('\t').map((s) => s.trim());
  const unitIdx = metaKeys.findIndex((k) => k.toLowerCase() === 'units');
  const units = unitIdx >= 0 ? (metaValues[unitIdx] || 'm').toLowerCase() : 'm';
  const scale = units === 'mm' ? 0.001 : units === 'cm' ? 0.01 : 1;

  const nameCells = lines[3].split('\t');
  const markerNames = [];
  for (let c = 2; c < nameCells.length; c += 3) {
    const name = nameCells[c].trim();
    if (name) markerNames.push(name);
  }

  const time = [];
  const markers = Object.fromEntries(markerNames.map((n) => [n, []]));
  for (let i = 5; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const v = line.split(/\s+/).map(Number);
    time.push(v[1]);
    markerNames.forEach((name, k) => {
      const base = 2 + 3 * k;
      markers[name].push([v[base] * scale, v[base + 1] * scale, v[base + 2] * scale]);
    });
  }

  return { time, markers };
}

// 大文字・小文字を区別せずにマーカーの軌跡を取り出す
export function getMarker(trc, name) {
  const key = Object.keys(trc.markers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? trc.markers[key] : null;
}
