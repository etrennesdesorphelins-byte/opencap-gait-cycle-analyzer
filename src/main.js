import './styles/main.css';

import { loadZip } from './modules/zipLoader.js';
import { buildTrialList, loadTrialData } from './modules/trialManager.js';
import { getColumn } from './modules/motParser.js';
import { VideoController } from './modules/videoController.js';
import { VideoZoomController } from './modules/videoZoom.js';
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
  videoWrapper: document.getElementById('video-wrapper'),
  video: document.getElementById('sync-video'),
  videoStatus: document.getElementById('video-status'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnZoomReset: document.getElementById('btn-zoom-reset'),
  zoomLevelDisplay: document.getElementById('zoom-level-display'),

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

const videoController = new VideoController(el.video);
const videoZoom = new VideoZoomController(el.videoWrapper, el.video, el.zoomLevelDisplay);

el.btnZoomIn.addEventListener('click', () => videoZoom.zoomIn());
el.btnZoomOut.addEventListener('click', () => videoZoom.zoomOut());
el.btnZoomReset.addEventListener('click', () => videoZoom.reset());

const state = {
  zipFile: null,
  zipInstance: null,
  trials: [],
  selectedTrial: null,
  motData: null,
  timeArray: null,
  hasVideo: false,
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
    const { motData, videoBlob } = await loadTrialData(state.zipInstance, trial);
    state.motData = motData;
    state.timeArray = getColumn(motData, 'time');
    state.hasVideo = Boolean(videoBlob);
    state.currentSampleIndex = 0;

    if (!state.timeArray) {
      throw new Error('MOTファイルに time 列が見つかりません。');
    }

    videoController.setSource(videoBlob);
    videoZoom.reset();
    if (videoBlob) {
      el.videoStatus.textContent = '';
    } else {
      el.videoStatus.textContent =
        '選択したMOTに対応するCam0同期動画が見つかりません。動画なしでも解析は可能ですが、IC選択を動画で確認できません。';
    }

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

// ---------- Section 3 & 4: Video + sample stepping ----------

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

  if (state.hasVideo) {
    await videoController.seekToTime(motTime);
  }

  if (requestId !== goToSampleRequestId) return; // 後続の呼び出しに追い越された

  const videoTime = state.hasVideo ? el.video.currentTime : motTime;

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
  const videoTime = state.hasVideo ? el.video.currentTime : motTime;
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
      'Video file path': state.selectedTrial.videoPath || '(not found)',
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
