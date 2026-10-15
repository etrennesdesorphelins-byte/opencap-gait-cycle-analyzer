import { findMotFiles, findVideosForMot, extractMotText, extractVideoBlob } from './zipLoader.js';
import { parseMot } from './motParser.js';

export function buildTrialList(zip) {
  const motFiles = findMotFiles(zip);
  return motFiles.map((mot) => ({
    motPath: mot.path,
    motName: mot.name,
    videos: findVideosForMot(zip, mot.path),
  }));
}

// 選択された試行のMOTのみを展開する（大容量ZIP対策）。
// 動画は表示対象に選ばれたカメラ分だけ loadVideoBlob で個別に展開する。
export async function loadTrialData(zip, trial) {
  const motText = await extractMotText(zip, trial.motPath);
  const motData = parseMot(motText);
  return { motData };
}

export function loadVideoBlob(zip, video) {
  return extractVideoBlob(zip, video.path);
}
