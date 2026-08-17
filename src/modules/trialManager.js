import { findMotFiles, findVideoForMot, extractMotText, extractVideoBlob } from './zipLoader.js';
import { parseMot } from './motParser.js';

export function buildTrialList(zip) {
  const motFiles = findMotFiles(zip);
  return motFiles.map((mot) => ({
    motPath: mot.path,
    motName: mot.name,
    videoPath: findVideoForMot(zip, mot.path),
  }));
}

// 選択された試行のみを展開する（大容量ZIP対策）
export async function loadTrialData(zip, trial) {
  const motText = await extractMotText(zip, trial.motPath);
  const motData = parseMot(motText);

  let videoBlob = null;
  if (trial.videoPath) {
    videoBlob = await extractVideoBlob(zip, trial.videoPath);
  }

  return { motData, videoBlob };
}
