import JSZip from 'jszip';

function normalizePath(path) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

export async function loadZip(file) {
  try {
    return await JSZip.loadAsync(file);
  } catch (err) {
    throw new Error('ZIPファイルを読み込めませんでした。OpenCapからダウンロードしたZIPファイルか確認してください。');
  }
}

// ZIP内の全ファイルを { normalizedPath: entry } の形で取得する
function buildEntryIndex(zip) {
  const index = new Map();
  zip.forEach((relativePath, entry) => {
    if (!entry.dir) {
      index.set(normalizePath(relativePath), entry);
    }
  });
  return index;
}

// OpenCap ZIPはセッションID等のルートフォルダ（例: OpenCapData_<uuid>/）で
// OpenSimData / Videos をまとめて包んでいる場合があるため、
// "OpenSimData/Kinematics/" は先頭一致ではなく任意の階層で一致させる。
const KINEMATICS_SEGMENT_RE = /(^|\/)opensimdata\/kinematics\/([^/]+\.mot)$/;

export function findMotFiles(zip) {
  const index = buildEntryIndex(zip);
  const results = [];
  for (const [normPath, entry] of index) {
    if (KINEMATICS_SEGMENT_RE.test(normPath)) {
      const name = entry.name.split(/[\\/]/).pop();
      results.push({ path: entry.name, name });
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

function baseNameWithoutExt(fileName) {
  const name = fileName.split(/[\\/]/).pop();
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

// motPathが属するルートフォルダ（OpenSimData/Kinematics/の手前部分）を取り出す
function extractRootPrefix(motPath) {
  const normalizedSlashes = motPath.replace(/\\/g, '/');
  const match = normalizedSlashes.match(/^(.*?\/)?OpenSimData\/Kinematics\//i);
  return match ? match[1] || '' : '';
}

const CAMERA_SEGMENT_RE = /(^|\/)(cam\d+)\//i;

function cameraNumber(camera) {
  const match = camera.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

// MOTファイル名から対応する同期動画を全カメラ分探索する。
// 第一候補: 同じルート配下の Videos/Cam{N}/InputMedia/{base}/{base}_sync.mp4
// フォールバック: 第一候補が1件もない場合のみ、ZIP全体から */{base}_sync.mp4 を検索
// 戻り値は [{ camera: 'Cam0', path }] をカメラ番号順に並べたもの。
export function findVideosForMot(zip, motPath) {
  const base = baseNameWithoutExt(motPath).toLowerCase();
  const root = extractRootPrefix(motPath).toLowerCase();
  const index = buildEntryIndex(zip);
  const fileName = `${base}_sync.mp4`;

  const toVideo = (entry, idx) => {
    const camMatch = entry.name.replace(/\\/g, '/').match(CAMERA_SEGMENT_RE);
    return { camera: camMatch ? camMatch[2] : `Video${idx + 1}`, path: entry.name };
  };

  let entries = [];
  for (const [normPath, entry] of index) {
    if (!normPath.startsWith(`${root}videos/`)) continue;
    const rest = normPath.slice(`${root}videos/`.length);
    if (/^cam\d+\/inputmedia\/[^/]+\/[^/]+$/.test(rest) && rest.endsWith(`/${base}/${fileName}`)) {
      entries.push(entry);
    }
  }

  if (entries.length === 0) {
    for (const [normPath, entry] of index) {
      if (normPath === fileName || normPath.endsWith(`/${fileName}`)) {
        entries.push(entry);
      }
    }
  }

  const videos = entries.map(toVideo);
  videos.sort((a, b) => cameraNumber(a.camera) - cameraNumber(b.camera) || a.path.localeCompare(b.path));

  // 同名カメララベルの重複（フォールバック時）を避ける
  const seen = new Map();
  for (const v of videos) {
    const count = seen.get(v.camera) || 0;
    seen.set(v.camera, count + 1);
    if (count > 0) v.camera = `${v.camera} (${count + 1})`;
  }
  return videos;
}

// MOTに対応するスケーリング済みOpenSimモデル(.osim)を探す。
// 通常: {root}OpenSimData/Model/*.osim
// 単眼(mono)セッション: {root}OpenSimData/Model/{trial}/*.osim
export function findModelForMot(zip, motPath) {
  const base = baseNameWithoutExt(motPath).toLowerCase();
  const modelDir = `${extractRootPrefix(motPath).toLowerCase()}opensimdata/model/`;
  const index = buildEntryIndex(zip);
  let shared = null;
  for (const [normPath, entry] of index) {
    if (!normPath.startsWith(modelDir) || !normPath.endsWith('.osim')) continue;
    const rest = normPath.slice(modelDir.length);
    if (rest.startsWith(`${base}/`) && !rest.slice(base.length + 1).includes('/')) {
      return entry.name;
    }
    if (!rest.includes('/') && !shared) shared = entry.name;
  }
  return shared;
}

// MOTに対応するマーカーデータ {root}MarkerData/{trial}.trc を探す
export function findTrcForMot(zip, motPath) {
  const base = baseNameWithoutExt(motPath).toLowerCase();
  const target = `${extractRootPrefix(motPath).toLowerCase()}markerdata/${base}.trc`;
  const entry = buildEntryIndex(zip).get(target);
  return entry ? entry.name : null;
}

export async function extractText(zip, path) {
  const entry = zip.file(path);
  if (!entry) {
    throw new Error(`ファイルが見つかりません: ${path}`);
  }
  return entry.async('text');
}

export async function extractMotText(zip, motPath) {
  const entry = zip.file(motPath);
  if (!entry) {
    throw new Error(`MOTファイルが見つかりません: ${motPath}`);
  }
  return entry.async('text');
}

export async function extractVideoBlob(zip, videoPath) {
  const entry = zip.file(videoPath);
  if (!entry) {
    throw new Error(`動画ファイルが見つかりません: ${videoPath}`);
  }
  return entry.async('blob');
}
