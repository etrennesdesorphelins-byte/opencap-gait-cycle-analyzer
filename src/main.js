import './styles/main.css';

import { loadZip } from './modules/zipLoader.js';
import { buildTrialList, loadTrialData, loadVideoBlob } from './modules/trialManager.js';
import { getColumn } from './modules/motParser.js';
import { VideoGrid } from './modules/videoGrid.js';
import { createICState, setIC, resetIC, isICValid, gaitCycleDuration } from './modules/icSelector.js';
import { checkAnalysisReady, checkRequiredColumns, SIDE_VARIABLES } from './modules/validators.js';
import { normalizeGaitCycle, normalizeAllVariables } from './modules/normalizer.js';
import { renderChart, chartToPngDataUrl } from './modules/chartRenderer.js';
import { buildWorkbook, downloadWorkbook } from './modules/excelExporter.js';
import { buildExportFilename } from './utils/filename.js';
import { clamp, round } from './utils/numbers.js';

const APP_VERSION = '1.0.0';

const el = {
  dropZone: document.getElementById('drop-zone'),
  btnSelectZip: document.getElementById('btn-select-zip'),
  inputZip: document.getElementById('input-zip'),
  zipStatus: document.getElementById('zip-status'),
  zipError: document.getElementById('zip-error'),

  sectionSelection: document.getElementById('section-selection'),
  selectTrial: document.getElementById('select-trial'),
  selectionError: document.getElementById('selection-error'),

  sectionVideo: document.getElementById('section-video'),
  cameraSelectRow: document.getElementById('camera-select-row'),
  cameraSelect: document.getElementById('camera-select'),
  videoGrid: document.getElementById('video-grid'),
  videoStatus: document.getElementById('video-status'),

  sectionControls: document.getElementById('section-controls'),
  btnBack10: document.getElementById('btn-step-back-10'),
  btnBack1: document.getElementById('btn-step-back-1'),
  btnFwd1: document.getElementById('btn-step-fwd-1'),
  btnFwd10: document.getElementById('btn-step-fwd-10'),
  timeSlider: document.getElementById('time-slider'),
  sampleInfo: document.getElementById('sample-info'),
  timeInfo: document.getElementById('time-info'),

  sectionIC: document.getElementById('section-ic'),
  btnSetIC1: document.getElementById('btn-set-ic1'),
  btnSetIC2: document.getElementById('btn-set-ic2'),
  ic1Info: document.getElementById('ic1-info'),
  ic2Info: document.getElementById('ic2-info'),
  gaitDurationInfo: document.getElementById('gait-duration-info'),
  icError: document.getElementById('ic-error'),

  sectionAnalyze: document.getElementById('section-analyze'),
  btnAnalyze: document.getElementById('btn-analyze'),
  analyzeError: document.getElementById('analyze-error'),

  sectionResult: document.getElementById('section-result'),
  chartHip: document.getElementById('chart-hip'),
  chartKnee: document.getElementById('chart-knee'),
  chartAnkle: document.getElementById('chart-ankle'),

  sectionDownload: document.getElementById('section-download'),
  btnDownloadExcel: document.getElementById('btn-download-excel'),
  downloadStatus: document.getElementById('download-status'),
};

const videoGrid = new VideoGrid(el.videoGrid);

const state = {
  zipFile: null,
  zipInstance: null,
  trials: [],
  selectedTrial: null,
  motData: null,
  timeArray: null,
  // 表示中のカメラ名。試行を切り替えても、同じカメラがあれば選択を引き継ぐ
  selectedCameras: new Set(['Cam0']),
  // 選択中の試行で展開済みの動画Blob（path → Blob）。カメラの再選択時に再展開しない
  videoBlobCache: new Map(),
  selectedSide: 'R',
  currentSampleIndex: 0,
  icState: createICState(),
  analysisResult: null,
  charts: null,
};

function showSection(sectionEl, visible) {
  sectionEl.hidden = !visible;
}

function resetDownstreamOfTrialChange() {
  resetIC(state.icState);
  state.analysisResult = null;
  state.charts = null;
  showSection(el.sectionResult, false);
  showSection(el.sectionDownload, false);
  el.icError.textContent = '';
  el.analyzeError.textContent = '';
  updateICDisplay();
  updateAnalyzeButtonState();
}

// ---------- Section 1: ZIP upload ----------

async function handleZipFile(file) {
  el.zipError.textContent = '';
  el.zipStatus.textContent = 'ZIPを読み込み中...';

  try {
    const zip = await loadZip(file);
    const trials = buildTrialList(zip);

    if (trials.length === 0) {
      throw new Error('OpenSimData/Kinematics 内にMOTファイルが見つかりません。');
    }

    state.zipFile = file;
    state.zipInstance = zip;
    state.trials = trials;

    el.selectTrial.innerHTML = '';
    trials.forEach((trial, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = trial.motName;
      el.selectTrial.appendChild(opt);
    });

    el.zipStatus.textContent = `${trials.length} 件のMOTファイルを検出しました。`;
    showSection(el.sectionSelection, true);

    await selectTrial(0);
  } catch (err) {
    el.zipStatus.textContent = '';
    el.zipError.textContent = err.message || 'ZIPファイルを読み込めませんでした。';
  }
}

el.btnSelectZip.addEventListener('click', () => el.inputZip.click());
el.inputZip.addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) handleZipFile(file);
});

['dragenter', 'dragover'].forEach((evt) => {
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropZone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  el.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    el.dropZone.classList.remove('drag-over');
  });
});
el.dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleZipFile(file);
});

// ---------- Section 2: Trial / Side selection ----------

async function selectTrial(index) {
  const trial = state.trials[index];
  state.selectedTrial = trial;
  el.selectionError.textContent = '';

  try {
    const { motData } = await loadTrialData(state.zipInstance, trial);
    state.motData = motData;
    state.timeArray = getColumn(motData, 'time');
    state.currentSampleIndex = 0;

    if (!state.timeArray) {
      throw new Error('MOTファイルに time 列が見つかりません。');
    }

    state.videoBlobCache = new Map();
    renderCameraSelect(trial);
    await updateDisplayedVideos();

    el.timeSlider.min = '0';
    el.timeSlider.max = String(state.timeArray.length - 1);
    el.timeSlider.value = '0';

    resetDownstreamOfTrialChange();
    checkColumnsForSide();

    showSection(el.sectionVideo, true);
    showSection(el.sectionControls, true);
    showSection(el.sectionIC, true);
    showSection(el.sectionAnalyze, true);

    await goToSample(0);
  } catch (err) {
    el.selectionError.textContent = err.message || '試行の読み込みに失敗しました。';
  }
}

el.selectTrial.addEventListener('change', (e) => {
  selectTrial(Number(e.target.value));
});

function getSelectedSide() {
  const checked = document.querySelector('input[name="side"]:checked');
  return checked ? checked.value : 'R';
}

function checkColumnsForSide() {
  if (!state.motData) return;
  const side = getSelectedSide();
  state.selectedSide = side;
  const { ok, missing } = checkRequiredColumns(state.motData, side);
  if (!ok) {
    el.selectionError.textContent = `解析に必要な列が見つかりません。Missing: ${missing.join(', ')}`;
  } else {
    el.selectionError.textContent = '';
  }
  updateAnalyzeButtonState();
}

document.querySelectorAll('input[name="side"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    state.analysisResult = null;
    showSection(el.sectionResult, false);
    showSection(el.sectionDownload, false);
    checkColumnsForSide();
  });
});

// ---------- Section 3: Video / camera selection ----------

function renderCameraSelect(trial) {
  el.cameraSelect.innerHTML = '';
  const cameras = trial.videos.map((v) => v.camera);

  // 前の試行で選んだカメラがこの試行に1つもなければ、先頭のカメラを表示する
  if (!cameras.some((c) => state.selectedCameras.has(c)) && cameras.length > 0) {
    state.selectedCameras = new Set([cameras[0]]);
  }

  for (const video of trial.videos) {
    const label = document.createElement('label');
    label.title = video.path;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = video.camera;
    checkbox.checked = state.selectedCameras.has(video.camera);
    checkbox.addEventListener('change', onCameraToggle);
    label.append(checkbox, ` ${video.camera}`);
    el.cameraSelect.appendChild(label);
  }
  el.cameraSelectRow.hidden = trial.videos.length === 0;
}

async function onCameraToggle(e) {
  const camera = e.target.value;
  if (e.target.checked) {
    state.selectedCameras.add(camera);
  } else {
    state.selectedCameras.delete(camera);
  }
  try {
    const applied = await updateDisplayedVideos();
    if (applied) await goToSample(state.currentSampleIndex);
  } catch (err) {
    el.videoStatus.textContent = err.message || '動画の読み込みに失敗しました。';
  }
}

async function getVideoBlob(video) {
  if (!state.videoBlobCache.has(video.path)) {
    state.videoBlobCache.set(video.path, await loadVideoBlob(state.zipInstance, video));
  }
  return state.videoBlobCache.get(video.path);
}

// チェックボックスを連続で切り替えた場合に、古い展開結果で表示を上書きしないための世代カウンタ
let videoLoadRequestId = 0;

// 選択中のカメラの動画を展開して表示する。後続の呼び出しに追い越された場合は false を返す
async function updateDisplayedVideos() {
  const requestId = ++videoLoadRequestId;
  const trial = state.selectedTrial;
  const selected = trial.videos.filter((v) => state.selectedCameras.has(v.camera));

  if (selected.length > 0) {
    el.videoStatus.textContent = '動画を読み込み中...';
  }
  const loaded = await Promise.all(selected.map(async (v) => ({ ...v, blob: await getVideoBlob(v) })));
  if (requestId !== videoLoadRequestId) return false;

  videoGrid.setVideos(loaded);

  if (trial.videos.length === 0) {
    el.videoStatus.textContent =
      '選択したMOTに対応する同期動画が見つかりません。動画なしでも解析は可能ですが、IC選択を動画で確認できません。';
  } else if (loaded.length === 0) {
    el.videoStatus.textContent = '表示するカメラが選択されていません。動画なしでも解析は可能です。';
  } else if (loaded.length > 1) {
    el.videoStatus.textContent = `全ての動画は同じMOT時刻に同期して表示されます。Video Time は ${videoGrid.primary.camera}（基準）の値です。`;
  } else {
    el.videoStatus.textContent = '';
  }
  return true;
}

// 基準動画（先頭パネル）の現在時刻。動画がなければMOT時刻を返す
function primaryVideoTime(motTime) {
  return videoGrid.hasVideo() ? videoGrid.primary.video.currentTime : motTime;
}

// ---------- Section 4: Sample stepping ----------

// 連続してgoToSampleが呼ばれた場合、動画シークの完了順が呼び出し順と
// 入れ替わることがある（例: IC1設定直後にIC2へ素早く移動する等）。
// 世代カウンタで「最後に呼ばれた要求」だけが画面表示を更新するようにする。
let goToSampleRequestId = 0;

async function goToSample(idx) {
  if (!state.timeArray) return;
  const requestId = ++goToSampleRequestId;

  const clamped = clamp(idx, 0, state.timeArray.length - 1);
  state.currentSampleIndex = clamped;
  const motTime = state.timeArray[clamped];

  el.timeSlider.value = String(clamped);

  await videoGrid.seekAll(motTime);

  if (requestId !== goToSampleRequestId) return; // 後続の呼び出しに追い越された

  const videoTime = primaryVideoTime(motTime);

  el.sampleInfo.textContent = `Sample: ${clamped + 1} / ${state.timeArray.length}`;
  el.timeInfo.textContent = `MOT Time: ${round(motTime, 4)} s / Video Time: ${round(videoTime, 4)} s`;
}

el.btnBack10.addEventListener('click', () => goToSample(state.currentSampleIndex - 10));
el.btnBack1.addEventListener('click', () => goToSample(state.currentSampleIndex - 1));
el.btnFwd1.addEventListener('click', () => goToSample(state.currentSampleIndex + 1));
el.btnFwd10.addEventListener('click', () => goToSample(state.currentSampleIndex + 10));
el.timeSlider.addEventListener('input', (e) => goToSample(Number(e.target.value)));

// ---------- Section 5: IC selection ----------

function currentICPoint() {
  const motTime = state.timeArray[state.currentSampleIndex];
  const videoTime = primaryVideoTime(motTime);
  return { sampleIndex: state.currentSampleIndex, motTime, videoTime };
}

function updateICDisplay() {
  const { first, second } = state.icState;
  el.ic1Info.textContent =
    first.sampleIndex !== null
      ? `1st IC: sample ${first.sampleIndex + 1} / time ${round(first.motTime, 4)} s`
      : '1st IC: 未設定';
  el.ic2Info.textContent =
    second.sampleIndex !== null
      ? `2nd IC: sample ${second.sampleIndex + 1} / time ${round(second.motTime, 4)} s`
      : '2nd IC: 未設定';

  const duration = gaitCycleDuration(state.icState);
  el.gaitDurationInfo.textContent =
    duration !== null ? `Gait cycle duration: ${round(duration, 4)} s` : 'Gait cycle duration: -';
}

el.btnSetIC1.addEventListener('click', () => {
  setIC(state.icState, 'first', currentICPoint());
  el.icError.textContent = '';
  updateICDisplay();
  updateAnalyzeButtonState();
});

el.btnSetIC2.addEventListener('click', () => {
  setIC(state.icState, 'second', currentICPoint());
  el.icError.textContent = '';
  updateICDisplay();
  updateAnalyzeButtonState();
});

// ---------- Section 6: Analyze ----------

function updateAnalyzeButtonState() {
  const { ok } = checkAnalysisReady({
    motData: state.motData,
    side: getSelectedSide(),
    firstIC: state.icState.first,
    secondIC: state.icState.second,
  });
  el.btnAnalyze.disabled = !ok;
}

el.btnAnalyze.addEventListener('click', () => {
  const side = getSelectedSide();
  state.selectedSide = side;

  const { ok, errors } = checkAnalysisReady({
    motData: state.motData,
    side,
    firstIC: state.icState.first,
    secondIC: state.icState.second,
  });

  if (!ok) {
    el.analyzeError.textContent = errors.join(' ');
    return;
  }
  el.analyzeError.textContent = '';

  const result = normalizeGaitCycle(state.motData, side, state.icState.first, state.icState.second);
  result.allNormalized = normalizeAllVariables(state.motData, state.icState.first, state.icState.second);
  state.analysisResult = result;

  const charts = {
    hip: renderChart(el.chartHip, 'Hip Flexion Angle', result.normalized.hip),
    knee: renderChart(el.chartKnee, 'Knee Flexion Angle', result.normalized.knee),
    ankle: renderChart(el.chartAnkle, 'Ankle Angle', result.normalized.ankle),
  };
  state.charts = charts;

  showSection(el.sectionResult, true);
  showSection(el.sectionDownload, true);
  el.downloadStatus.textContent = '';
});

// ---------- Section 8: Excel download ----------

el.btnDownloadExcel.addEventListener('click', async () => {
  if (!state.analysisResult) return;

  el.downloadStatus.textContent = 'Excelを生成中...';

  try {
    const side = state.selectedSide;
    const vars = SIDE_VARIABLES[side];
    const { first, second } = state.icState;

    const chartImages = {
      hip: chartToPngDataUrl(state.charts.hip),
      knee: chartToPngDataUrl(state.charts.knee),
      ankle: chartToPngDataUrl(state.charts.ankle),
    };

    const metadata = {
      'ZIP file name': state.zipFile.name,
      'MOT file name': state.selectedTrial.motName,
      'Video file path':
        state.selectedTrial.videos.length === 0
          ? '(not found)'
          : videoGrid.panels.map((p) => p.path).join('; ') || '(not displayed)',
      'Analysis side': side === 'R' ? 'Right' : 'Left',
      'Hip variable': vars.hip,
      'Knee variable': vars.knee,
      'Ankle variable': vars.ankle,
      '1st IC sample': first.sampleIndex + 1,
      '1st IC time': round(first.motTime, 4),
      '2nd IC sample': second.sampleIndex + 1,
      '2nd IC time': round(second.motTime, 4),
      'Gait cycle duration': round(gaitCycleDuration(state.icState), 4),
      'Original sample count': state.analysisResult.original.sampleIndices.length,
      'Normalization points': 101,
      'Interpolation method': 'linear',
      'Application version': APP_VERSION,
      'Export date/time': new Date().toISOString(),
    };

    const workbook = buildWorkbook({
      chartImages,
      normalized: state.analysisResult.normalized,
      original: state.analysisResult.original,
      metadata,
      allNormalized: state.analysisResult.allNormalized,
    });

    const filename = buildExportFilename(state.zipFile.name, state.selectedTrial.motName, side);
    await downloadWorkbook(workbook, filename);

    el.downloadStatus.textContent = `ダウンロードしました: ${filename}`;
  } catch (err) {
    el.downloadStatus.textContent = `Excel生成に失敗しました: ${err.message || err}`;
  }
});
