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

// MOTファイル名から対応する同期動画を探索する。
// 第一候補: 同じルート配下の Videos/Cam0/InputMedia/{base}/{base}_sync.mp4 への完全一致
// フォールバック: ZIP全体から */{base}_sync.mp4 を検索
export function findVideoForMot(zip, motPath) {
  const base = baseNameWithoutExt(motPath);
  const root = extractRootPrefix(motPath);
  const index = buildEntryIndex(zip);

  const primaryPath = `${root}videos/cam0/inputmedia/${base}/${base}_sync.mp4`.toLowerCase();
  if (index.has(primaryPath)) {
    return index.get(primaryPath).name;
  }

  const fallbackSuffix = `/${base}_sync.mp4`.toLowerCase();
  for (const [normPath, entry] of index) {
    if (normPath.endsWith(fallbackSuffix)) {
      return entry.name;
    }
  }

  return null;
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
