import './styles/main.css';

import { loadZip } from './modules/zipLoader.js';
import { buildTrialList, loadTrialData, loadVideoBlob, loadOsimModel, loadTrc } from './modules/trialManager.js';
import { computeCenterOfMassTrajectory, computeMarkerTrajectories } from './modules/bodyKinematics.js';
import {
  computeCycleParameters,
  computeTrialSpeed,
  summarizeSpatioTemporal,
  SPATIOTEMPORAL_PARAMS,
  WALKING_SPEED,
  HEEL_MARKERS,
  PELVIS_MARKERS,
} from './modules/spatioTemporal.js';
import { analyzeComCycles, summarizeCom } from './modules/comAnalysis.js';
import { getColumn } from './modules/motParser.js';
import { VideoGrid } from './modules/videoGrid.js';
import {
  SIDES,
  SIDE_LABELS,
  EVENT_LABELS,
  createEventList,
  addEvent,
  removeEvent,
  clearEvents,
  buildCycles,
} from './modules/gaitEvents.js';
import { checkAnalysisReady, checkRequiredColumns } from './modules/validators.js';
import { analyzeSideCycles, summarizeSide, scalarMeanSD } from './modules/normalizer.js';
import { renderChart, chartToPngDataUrl, highlightCycle } from './modules/chartRenderer.js';
import { buildWorkbook, downloadWorkbook } from './modules/excelExporter.js';
import { buildExportFilename } from './utils/filename.js';
import { clamp, round } from './utils/numbers.js';

const APP_VERSION = '1.5.0';

const el = {
  dropZone: document.getElementById('drop-zone'),
  btnSelectZip: document.getElementById('btn-select-zip'),
  inputZip: document.getElementById('input-zip'),
  zipStatus: document.getElementById('zip-status'),
  zipError: document.getElementById('zip-error'),

  sectionSelection: document.getElementById('section-selection'),
  currentZip: document.getElementById('current-zip'),
  selectTrial: document.getElementById('select-trial'),
  selectionError: document.getElementById('selection-error'),
  comStatus: document.getElementById('com-status'),
  markerStatus: document.getElementById('marker-status'),

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
  eventTrack: document.getElementById('event-track'),
  sampleInfo: document.getElementById('sample-info'),
  timeInfo: document.getElementById('time-info'),

  sectionIC: document.getElementById('section-ic'),
  eventButtons: document.querySelectorAll('.event-buttons button[data-side]'),
  icError: document.getElementById('ic-error'),
  eventTableBody: document.querySelector('#event-table tbody'),
  eventEmpty: document.getElementById('event-empty'),
  btnClearEvents: document.getElementById('btn-clear-events'),
  cycleTableBody: document.querySelector('#cycle-table tbody'),
  cycleInfo: document.getElementById('cycle-info'),

  sectionDatasets: document.getElementById('section-datasets'),
  datasetTableBody: document.querySelector('#dataset-table tbody'),
  btnAddZip: document.getElementById('btn-add-zip'),
  inputAddZip: document.getElementById('input-add-zip'),
  datasetTotal: document.getElementById('dataset-total'),
  datasetStatus: document.getElementById('dataset-status'),
  datasetError: document.getElementById('dataset-error'),

  sectionAnalyze: document.getElementById('section-analyze'),
  btnAnalyze: document.getElementById('btn-analyze'),
  analyzeError: document.getElementById('analyze-error'),

  sectionResult: document.getElementById('section-result'),
  resultSummary: document.getElementById('result-summary'),
  cyclePicker: document.getElementById('cycle-picker'),
  btnExcludeCycle: document.getElementById('btn-exclude-cycle'),
  selectedCycleInfo: document.getElementById('selected-cycle-info'),
  excludedCycles: document.getElementById('excluded-cycles'),
  excludedList: document.getElementById('excluded-list'),
  btnRestoreAll: document.getElementById('btn-restore-all'),
  cycleToolsError: document.getElementById('cycle-tools-error'),
  stTableBody: document.querySelector('#st-table tbody'),
  chartHip: document.getElementById('chart-hip'),
  chartKnee: document.getElementById('chart-knee'),
  chartAnkle: document.getElementById('chart-ankle'),
  comResult: document.getElementById('com-result'),
  comSummary: document.getElementById('com-summary'),
  chartComVertical: document.getElementById('chart-com-vertical'),
  chartComMl: document.getElementById('chart-com-ml'),

  sectionDownload: document.getElementById('section-download'),
  btnDownloadExcel: document.getElementById('btn-download-excel'),
  downloadStatus: document.getElementById('download-status'),
};

const videoGrid = new VideoGrid(el.videoGrid);

// 読み込んだZIP（データセット）の一覧と、2〜5で編集中のZIP・試行。
// 各試行は、展開済みのデータ（trial.data: MOT・身体重心・マーカー）と歩行イベント（trial.events）を保持する。
// 解析は全データセットのうちイベントを設定した全試行が対象。
const state = {
  datasets: [],
  current: null,
  selectedTrial: null,
  // 以下は編集中の試行の値（trial.data / trial.events を指す）
  motData: null,
  timeArray: null,
  events: createEventList(),
  // 表示中のカメラ名。試行を切り替えても、同じカメラがあれば選択を引き継ぐ
  selectedCameras: new Set(['Cam0']),
  // 編集中の試行で展開済みの動画Blob（path → Blob）。カメラの再選択時に再展開しない
  videoBlobCache: new Map(),
  currentSampleIndex: 0,
  // 解析から除外した歩行周期（cycleKey → 周期の情報）と、グラフで選択中の周期
  excluded: new Map(),
  selectedCycleKey: null,
  analysisResult: null,
  charts: null,
};

let nextDatasetId = 1;

function showSection(sectionEl, visible) {
  sectionEl.hidden = !visible;
}

// 解析対象（イベント・ZIP）が変わったら、以前の解析結果は無効になるため非表示にする
function invalidateAnalysis() {
  state.analysisResult = null;
  state.charts = null;
  showSection(el.sectionResult, false);
  showSection(el.sectionDownload, false);
  el.analyzeError.textContent = '';
}

const fmt = (v, digits = 1) => (v === null || v === undefined ? '-' : round(v, digits).toFixed(digits));

function sideCell(side) {
  const td = document.createElement('td');
  td.textContent = SIDE_LABELS[side];
  td.className = `side-text-${side}`;
  return td;
}

function textCell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function button(text, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

// ---------- Section 1 & 6: ZIP files (datasets) ----------

const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

async function handleZipFiles(files) {
  el.zipError.textContent = '';
  el.datasetError.textContent = '';
  const errors = [];
  let firstAdded = null;

  for (const file of files) {
    const existing = state.datasets.find((d) => sameFile(d.file, file));
    if (existing) {
      errors.push(`${file.name} は既に読み込まれています。`);
      firstAdded = firstAdded || existing;
      continue;
    }
    el.zipStatus.textContent = `${file.name} を読み込み中...`;
    try {
      const zip = await loadZip(file);
      const trials = buildTrialList(zip);
      if (trials.length === 0) {
        throw new Error('OpenSimData/Kinematics 内にMOTファイルが見つかりません。');
      }
      const dataset = { id: nextDatasetId++, file, zip, trials, modelCache: new Map(), selectedIndex: 0 };
      state.datasets.push(dataset);
      firstAdded = firstAdded || dataset;
    } catch (err) {
      errors.push(`${file.name}: ${err.message || 'ZIPファイルを読み込めませんでした。'}`);
    }
  }

  el.zipStatus.textContent =
    state.datasets.length > 0 ? `${state.datasets.length} 件のZIPファイルを読み込み済みです。` : '';
  el.zipError.textContent = errors.join(' ');
  el.datasetError.textContent = errors.join(' ');

  if (firstAdded) {
    invalidateAnalysis();
    await activateDataset(firstAdded);
  }
  renderDatasetTable();
}

function filesFrom(list) {
  return Array.from(list || []).filter((f) => f.name.toLowerCase().endsWith('.zip') || f.type.includes('zip'));
}

el.btnSelectZip.addEventListener('click', () => el.inputZip.click());
el.inputZip.addEventListener('change', (e) => {
  const files = filesFrom(e.target.files);
  e.target.value = '';
  if (files.length) handleZipFiles(files);
});
el.btnAddZip.addEventListener('click', () => el.inputAddZip.click());
el.inputAddZip.addEventListener('change', async (e) => {
  const files = filesFrom(e.target.files);
  e.target.value = '';
  if (files.length === 0) return;
  await handleZipFiles(files);
  el.sectionSelection.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const files = filesFrom(e.dataTransfer.files);
  if (files.length) handleZipFiles(files);
});

// 2〜5で編集するZIPを切り替える
async function activateDataset(dataset) {
  state.current = dataset;
  el.currentZip.textContent = `編集中のZIP: ${dataset.file.name}`;
  el.selectTrial.innerHTML = '';
  dataset.trials.forEach((trial, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = trial.events && trial.events.length > 0 ? `${trial.motName}（イベント ${trial.events.length}）` : trial.motName;
    el.selectTrial.appendChild(opt);
  });
  el.selectTrial.value = String(dataset.selectedIndex);
  showSection(el.sectionSelection, true);
  showSection(el.sectionDatasets, true);
  await selectTrial(dataset.selectedIndex);
}

function removeDataset(dataset) {
  if (!window.confirm(`${dataset.file.name} とその試行に設定したイベントを解析対象から削除します。よろしいですか？`)) return;
  state.datasets = state.datasets.filter((d) => d !== dataset);
  invalidateAnalysis();
  if (state.current === dataset) {
    if (state.datasets.length > 0) {
      activateDataset(state.datasets[0]);
    } else {
      resetEditor();
    }
  }
  el.zipStatus.textContent =
    state.datasets.length > 0 ? `${state.datasets.length} 件のZIPファイルを読み込み済みです。` : '';
  renderDatasetTable();
}

// ZIPが1つもなくなったときに、2〜7を初期状態へ戻す
function resetEditor() {
  state.current = null;
  state.selectedTrial = null;
  state.motData = null;
  state.timeArray = null;
  state.events = createEventList();
  videoGrid.clear();
  [el.sectionSelection, el.sectionVideo, el.sectionControls, el.sectionIC, el.sectionDatasets, el.sectionAnalyze].forEach(
    (s) => showSection(s, false)
  );
}

function cyclesOf(trial) {
  const events = trial.events || [];
  return { R: buildCycles(events, 'R'), L: buildCycles(events, 'L') };
}

function renderDatasetTable() {
  el.datasetTableBody.innerHTML = '';
  let totalTrials = 0;
  const totals = { R: 0, L: 0 };

  state.datasets.forEach((dataset, i) => {
    const tr = document.createElement('tr');
    if (dataset === state.current) tr.className = 'current';

    const trialTexts = [];
    const counts = { R: 0, L: 0 };
    for (const trial of dataset.trials) {
      if (!trial.events || trial.events.length === 0) continue;
      const bySide = cyclesOf(trial);
      counts.R += bySide.R.length;
      counts.L += bySide.L.length;
      if (bySide.R.length + bySide.L.length > 0) totalTrials += 1;
      trialTexts.push(`${trial.motName}（R ${bySide.R.length} / L ${bySide.L.length}）`);
    }
    totals.R += counts.R;
    totals.L += counts.L;

    const actions = document.createElement('td');
    actions.append(
      button(dataset === state.current ? '編集中' : '編集', 'secondary', async () => {
        await activateDataset(dataset);
        renderDatasetTable();
        el.sectionSelection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
      ' ',
      button('削除', 'danger', () => removeDataset(dataset))
    );
    actions.firstChild.disabled = dataset === state.current;

    tr.append(
      textCell(String(i + 1)),
      textCell(dataset.file.name, 'wrap filename'),
      textCell(trialTexts.length > 0 ? trialTexts.join('、') : '（未設定）', 'wrap'),
      textCell(String(counts.R), 'side-text-R'),
      textCell(String(counts.L), 'side-text-L'),
      actions
    );
    el.datasetTableBody.appendChild(tr);
  });

  el.datasetTotal.textContent =
    state.datasets.length > 0
      ? `解析対象: ${totalTrials} 試行（Right ${totals.R} 周期 / Left ${totals.L} 周期）` +
        (state.excluded.size > 0 ? `、うち除外 ${state.excluded.size} 周期` : '')
      : '';
}

// ---------- Section 2: Trial selection ----------

function getModel(dataset, path) {
  if (!dataset.modelCache.has(path)) {
    dataset.modelCache.set(path, loadOsimModel(dataset.zip, path));
  }
  return dataset.modelCache.get(path);
}

// 試行のMOTとスケーリング済みOpenSimモデルから身体重心の時系列を求める。
// 算出できなくても関節角度の解析は続けられるため、エラーは状態表示にとどめる。
async function loadCenterOfMass(dataset, trial, motData) {
  if (!trial.modelPath) {
    return {
      com: null,
      comModel: null,
      status: '身体重心: OpenSimData/Model 内にモデル(.osim)が見つからないため算出しません（関節角度の解析は可能です）。',
    };
  }
  try {
    const model = await getModel(dataset, trial.modelPath);
    const com = computeCenterOfMassTrajectory(model, motData);
    const fileName = trial.modelPath.split('/').pop();
    let status = `身体重心: ${fileName}（総質量 ${round(model.totalMass, 1)} kg）から算出しました。`;
    if (com.missingCoordinates.length > 0) {
      status += ` MOTにない座標はモデルの既定値を使用: ${com.missingCoordinates.join(', ')}`;
    }
    return { com, comModel: { path: trial.modelPath, name: model.name, totalMass: model.totalMass }, status };
  } catch (err) {
    return { com: null, comModel: null, status: `身体重心を算出できませんでした: ${err.message || err}` };
  }
}

// 歩幅（踵マーカー）と、身体重心がない場合の歩行速度（骨盤マーカー）に使うマーカー軌跡を用意する。
// OpenCapと同じく実測のTRCを優先し、なければモデルの順運動学でマーカー位置を求める。
async function loadMarkers(dataset, trial, motData) {
  const names = [...Object.values(HEEL_MARKERS), ...PELVIS_MARKERS];
  let markers = null;
  let markerSource = null;
  try {
    if (trial.trcPath) {
      markers = await loadTrc(dataset.zip, trial.trcPath);
      markerSource = trial.trcPath;
    } else if (trial.modelPath) {
      const model = await getModel(dataset, trial.modelPath);
      markers = computeMarkerTrajectories(model, motData, names);
      markerSource = `${trial.modelPath} (forward kinematics)`;
    }
  } catch (err) {
    return { markers: null, markerSource: null, status: `マーカーデータを読み込めませんでした: ${err.message || err}` };
  }
  if (!markers) {
    return { markers, markerSource, status: '歩幅: マーカーデータ(.trc)・モデルが見つからないため算出しません。' };
  }
  const missing = Object.values(HEEL_MARKERS).filter(
    (n) => !Object.keys(markers.markers).some((k) => k.toLowerCase() === n.toLowerCase())
  );
  const source = trial.trcPath ? trial.trcPath.split('/').pop() : 'モデルの順運動学';
  const status =
    missing.length > 0
      ? `歩幅: 踵マーカー（${missing.join(', ')}）が見つからないため算出しません。`
      : `歩幅: ${source} の踵マーカー（${Object.values(HEEL_MARKERS).join(', ')}）から算出します。`;
  return { markers, markerSource, status };
}

// 試行の解析用データ（MOT・身体重心・マーカー）を一度だけ展開して試行に保持する
async function ensureTrialData(dataset, trial) {
  if (trial.data) return trial.data;
  const { motData } = await loadTrialData(dataset.zip, trial);
  const timeArray = getColumn(motData, 'time');
  if (!timeArray) {
    throw new Error('MOTファイルに time 列が見つかりません。');
  }
  const comInfo = await loadCenterOfMass(dataset, trial, motData);
  const markerInfo = await loadMarkers(dataset, trial, motData);
  trial.data = {
    motData,
    timeArray,
    com: comInfo.com,
    comModel: comInfo.comModel,
    comStatus: comInfo.status,
    markers: markerInfo.markers,
    markerSource: markerInfo.markerSource,
    markerStatus: markerInfo.status,
  };
  return trial.data;
}

async function selectTrial(index) {
  const dataset = state.current;
  const trial = dataset.trials[index];
  dataset.selectedIndex = index;
  state.selectedTrial = trial;
  el.selectionError.textContent = '';

  // 読み込み中は前の試行のイベントを表示・編集できないようにする（誤って前の試行へ記録するのを防ぐ）
  state.timeArray = null;
  state.events = createEventList();
  renderEventTable();
  renderEventTrack();
  el.eventButtons.forEach((b) => {
    b.disabled = true;
  });

  try {
    const data = await ensureTrialData(dataset, trial);
    state.motData = data.motData;
    state.timeArray = data.timeArray;
    state.currentSampleIndex = 0;
    el.comStatus.textContent = data.comStatus;
    el.markerStatus.textContent = data.markerStatus;

    state.videoBlobCache = new Map();
    renderCameraSelect(trial);
    await updateDisplayedVideos();

    el.timeSlider.min = '0';
    el.timeSlider.max = String(state.timeArray.length - 1);
    el.timeSlider.value = '0';

    if (!trial.events) trial.events = createEventList();
    state.events = trial.events;
    el.eventButtons.forEach((b) => {
      b.disabled = false;
    });
    el.icError.textContent = '';
    checkColumns();
    refreshEvents();

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

// 左右どちらかの必要列が欠けている場合は警告する（もう一方の側は解析可能）
function checkColumns() {
  if (!state.motData) return;
  const messages = SIDES.map((side) => ({ side, ...checkRequiredColumns(state.motData, side) }))
    .filter((r) => !r.ok)
    .map((r) => `${SIDE_LABELS[r.side]} の解析に必要な列が見つかりません。Missing: ${r.missing.join(', ')}`);
  el.selectionError.textContent = messages.join(' ');
}

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
    state.videoBlobCache.set(video.path, await loadVideoBlob(state.current.zip, video));
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
// 入れ替わることがある（例: イベント設定直後に素早く移動する等）。
// 世代カウンタで「最後に呼ばれた要求」だけが画面表示を更新するようにする。
let goToSampleRequestId = 0;

async function goToSample(idx) {
  if (!state.timeArray) return;
  const requestId = ++goToSampleRequestId;

  const clamped = clamp(idx, 0, state.timeArray.length - 1);
  state.currentSampleIndex = clamped;
  const motTime = state.timeArray[clamped];

  el.timeSlider.value = String(clamped);
  highlightCurrentEvents();

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

// ---------- Section 5: Gait events (IC / Toe Off) ----------

function currentEventPoint() {
  const motTime = state.timeArray[state.currentSampleIndex];
  const videoTime = primaryVideoTime(motTime);
  return { sampleIndex: state.currentSampleIndex, motTime, videoTime };
}

function cyclesBySide() {
  return { R: buildCycles(state.events, 'R'), L: buildCycles(state.events, 'L') };
}

function renderEventTable() {
  el.eventTableBody.innerHTML = '';
  state.events.forEach((event, i) => {
    const tr = document.createElement('tr');
    tr.dataset.sample = String(event.sampleIndex);

    const actions = document.createElement('td');
    const btnDel = button('削除', 'danger', () => {
      removeEvent(state.events, event.id);
      onEventsChanged();
    });
    btnDel.setAttribute('aria-label', `${SIDE_LABELS[event.side]} ${EVENT_LABELS[event.type]} sample ${event.sampleIndex + 1} を削除`);
    actions.append(button('移動', 'secondary', () => goToSample(event.sampleIndex)), ' ', btnDel);

    tr.append(
      textCell(String(i + 1)),
      sideCell(event.side),
      textCell(EVENT_LABELS[event.type]),
      textCell(String(event.sampleIndex + 1)),
      textCell(round(event.motTime, 4).toFixed(4)),
      actions
    );
    el.eventTableBody.appendChild(tr);
  });
  el.eventEmpty.hidden = state.events.length > 0;
  el.btnClearEvents.hidden = state.events.length === 0;
  highlightCurrentEvents();
}

function renderCycleTable() {
  const bySide = cyclesBySide();
  el.cycleTableBody.innerHTML = '';
  let hasSuspicious = false;
  let missingToeOff = 0;

  SIDES.forEach((side) => {
    bySide[side].forEach((c) => {
      const tr = document.createElement('tr');
      if (c.suspiciouslyLong) {
        tr.className = 'warning';
        hasSuspicious = true;
      }
      if (c.toeOff === null) missingToeOff += 1;
      const key = cycleKey(state.current, state.selectedTrial, side, c);
      const status = document.createElement('td');
      if (state.excluded.has(key)) {
        tr.classList.add('excluded');
        status.append('除外 ', button('戻す', 'secondary', () => restoreCycles([key])));
      }
      tr.append(
        sideCell(side),
        textCell(String(c.number)),
        textCell(`${c.start.sampleIndex + 1} → ${c.end.sampleIndex + 1}`),
        textCell(round(c.duration, 3).toFixed(3)),
        textCell(fmt(c.stancePercent)),
        textCell(fmt(c.oppositeToeOffPercent)),
        textCell(fmt(c.oppositeICPercent)),
        status
      );
      el.cycleTableBody.appendChild(tr);
    });
  });

  const counts = SIDES.map((s) => `${SIDE_LABELS[s]} ${bySide[s].length} 周期`).join(' / ');
  const notes = [counts];
  if (bySide.R.length + bySide.L.length === 0) {
    notes.push('同じ側のICを2回以上設定すると歩行周期が作成されます。');
  }
  if (missingToeOff > 0) {
    notes.push(`Toe Off が未設定の周期が ${missingToeOff} 件あります（立脚期%は空欄になります）。`);
  }
  if (hasSuspicious) {
    notes.push('色付きの周期は他より1.5倍以上長く、間のICが抜けている可能性があります。');
  }
  el.cycleInfo.textContent = notes.join(' ');
}

// スライダー下に各イベントの位置を目印として表示する
function renderEventTrack() {
  el.eventTrack.innerHTML = '';
  if (!state.timeArray) return;
  const last = Math.max(1, state.timeArray.length - 1);
  state.events.forEach((event) => {
    const mark = document.createElement('div');
    mark.className = `event-mark side-${event.side} type-${event.type}`;
    mark.style.left = `${(event.sampleIndex / last) * 100}%`;
    mark.title = `${SIDE_LABELS[event.side]} ${EVENT_LABELS[event.type]} (sample ${event.sampleIndex + 1})`;
    el.eventTrack.appendChild(mark);
  });
}

function highlightCurrentEvents() {
  el.eventTableBody.querySelectorAll('tr').forEach((tr) => {
    tr.classList.toggle('current', Number(tr.dataset.sample) === state.currentSampleIndex);
  });
}

// 試行選択のプルダウンに、イベント設定済みの件数を表示する
function updateTrialOptionLabel() {
  const dataset = state.current;
  if (!dataset) return;
  const opt = el.selectTrial.options[dataset.selectedIndex];
  const trial = dataset.trials[dataset.selectedIndex];
  if (opt) opt.textContent = trial.events.length > 0 ? `${trial.motName}（イベント ${trial.events.length}）` : trial.motName;
}

function refreshEvents() {
  renderEventTable();
  renderCycleTable();
  renderEventTrack();
  renderDatasetTable();
  updateTrialOptionLabel();
  updateAnalyzeButtonState();
}

function onEventsChanged() {
  el.icError.textContent = '';
  invalidateAnalysis();
  refreshEvents();
}

el.eventButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!state.timeArray) return;
    const { side, type } = btn.dataset;
    const added = addEvent(state.events, { side, type, ...currentEventPoint() });
    onEventsChanged();
    if (!added) {
      el.icError.textContent = `${SIDE_LABELS[side]} ${EVENT_LABELS[type]} はこのサンプルに既に設定されています。`;
    }
  });
});

el.btnClearEvents.addEventListener('click', () => {
  if (!window.confirm('この試行の全イベントを削除します。よろしいですか？')) return;
  clearEvents(state.events);
  onEventsChanged();
});

// ---------- Section 7: Analyze ----------

// 解析対象: 全ZIPのうち、歩行周期が1つ以上ある試行
function collectSources() {
  const sources = [];
  for (const dataset of state.datasets) {
    for (const trial of dataset.trials) {
      if (!trial.data || !trial.events || trial.events.length === 0) continue;
      const bySide = cyclesOf(trial);
      if (bySide.R.length + bySide.L.length === 0) continue;
      sources.push({ dataset, trial, data: trial.data, bySide, label: `${dataset.file.name} / ${trial.motName}` });
    }
  }
  return sources;
}

// 試行ごとに解析可能な側を判定する（必要列が欠けた側はその試行のみ除外）
function checkSources(sources) {
  const errors = [];
  for (const src of sources) {
    const result = checkAnalysisReady({ motData: src.data.motData, cyclesBySide: src.bySide });
    src.sides = result.sides;
    result.errors.forEach((e) => errors.push(`[${src.label}] ${e}`));
  }
  const ok = sources.some((s) => s.sides.length > 0);
  if (!ok && errors.length === 0) {
    errors.push('解析には同じ側のICを2回以上設定してください（連続する同側IC間を1歩行周期とします）。');
  }
  return { ok, errors };
}

function updateAnalyzeButtonState() {
  el.btnAnalyze.disabled = !checkSources(collectSources()).ok;
}

function summaryText(result) {
  const parts = [`${SIDE_LABELS[result.side]}: ${result.cycles.length} 周期`];
  const d = result.duration;
  parts.push(`周期時間 ${fmt(d.mean, 3)}${d.sd !== null ? ` ± ${fmt(d.sd, 3)}` : ''} s`);
  const s = result.stancePercent;
  if (s.n > 0) {
    parts.push(`立脚期 ${fmt(s.mean)}${s.sd !== null ? ` ± ${fmt(s.sd)}` : ''} %（n=${s.n}）`);
  }
  return parts.join('、');
}

const withSD = (stat, digits, unit) =>
  stat.n === 0 ? '-' : `${fmt(stat.mean, digits)}${stat.sd !== null ? ` ± ${fmt(stat.sd, digits)}` : ''} ${unit}`;

function comSummaryText(side, com) {
  const parts = [
    `${SIDE_LABELS[side]}: 鉛直変位幅 ${withSD(com.verticalExcursion, 2, 'cm')}`,
    `左右変位幅 ${withSD(com.mlExcursion, 2, 'cm')}`,
  ];
  if (com.undefinedDirectionCount > 0) {
    parts.push(`進行方向を決められない周期が ${com.undefinedDirectionCount} 件（左右・前後成分は参考値）`);
  }
  return parts.join('、');
}

// 時間・距離因子の表（行: 項目、列: 側）。歩行速度は左右を分けず全体の値を表示する
function renderSpatioTemporalTable(sides, stResults, overallSpeed) {
  el.stTableBody.innerHTML = '';

  const speedRow = document.createElement('tr');
  speedRow.appendChild(textCell(`${WALKING_SPEED.label}（全体）`));
  const speedCell = textCell(
    overallSpeed.n > 0
      ? `${withSD(overallSpeed, WALKING_SPEED.digits, WALKING_SPEED.unit)}（n=${overallSpeed.n} 試行）`
      : '-'
  );
  speedCell.colSpan = 2;
  speedRow.appendChild(speedCell);
  el.stTableBody.appendChild(speedRow);

  for (const param of SPATIOTEMPORAL_PARAMS) {
    const tr = document.createElement('tr');
    tr.appendChild(textCell(param.label));
    for (const side of SIDES) {
      if (!sides.includes(side)) {
        tr.appendChild(textCell('-'));
        continue;
      }
      const stat = stResults[side].summary[param.key];
      let text = withSD(stat, param.digits, param.unit);
      if (stat.n > 0) {
        text += `（n=${stat.n}）`;
        if (param.percentKey) {
          text += ` / ${fmt(stResults[side].summary[param.percentKey].mean)}%`;
        }
      }
      tr.appendChild(textCell(text));
    }
    el.stTableBody.appendChild(tr);
  }
}

// 歩行周期の識別子（ZIP・試行・側・開始/終了サンプル）。イベントを編集してもその周期が残っていれば同じ値になる
function cycleKey(dataset, trial, side, cycle) {
  return `${dataset.id}|${trial.motPath}|${side}|${cycle.start.sampleIndex}-${cycle.end.sampleIndex}`;
}

// 全試行の周期のうち除外していないものをまとめて解析する。各結果の cycles 配列は同じ順序（側ごとの通し番号）で並ぶ
function analyzeSources(sources) {
  // 除外していない周期（cycleInTrial は試行内の元の番号）
  const included = sources.map((src) => {
    const bySide = {};
    for (const side of SIDES) {
      bySide[side] = src.sides.includes(side)
        ? src.bySide[side].filter((c) => !state.excluded.has(cycleKey(src.dataset, src.trial, side, c)))
        : [];
    }
    return bySide;
  });
  const sides = SIDES.filter((side) => included.some((bySide) => bySide[side].length > 0));
  const comAvailable = sources.every((s) => s.data.com);
  const sideResults = {};
  const stResults = {};
  const comResults = comAvailable ? {} : null;

  for (const side of sides) {
    const jointCycles = [];
    const stCycles = [];
    const comCycles = [];
    sources.forEach((src, si) => {
      const cycles = included[si][side];
      if (cycles.length === 0) return;
      const analyzed = analyzeSideCycles(src.data.motData, side, cycles);
      const st = cycles.map((c) => computeCycleParameters(c, { com: src.data.com, markers: src.data.markers }));
      const com = comAvailable ? analyzeComCycles(src.data.com, cycles) : null;
      analyzed.forEach((c, k) => {
        jointCycles.push({
          ...c,
          key: cycleKey(src.dataset, src.trial, side, c),
          zipName: src.dataset.file.name,
          trialName: src.trial.motName,
          cycleInTrial: c.number,
        });
        stCycles.push(st[k]);
        if (com) comCycles.push(com[k]);
      });
    });
    jointCycles.forEach((c, i) => {
      c.number = i + 1;
    });
    sideResults[side] = summarizeSide(side, jointCycles);
    stResults[side] = summarizeSpatioTemporal(stCycles);
    if (comResults) comResults[side] = summarizeCom(comCycles);
  }

  const trials = sources.map((src, si) => {
    const speed = computeTrialSpeed(src.trial.events, { com: src.data.com, markers: src.data.markers });
    const total = (side) => (src.sides.includes(side) ? src.bySide[side].length : 0);
    return {
      zipName: src.dataset.file.name,
      trialName: src.trial.motName,
      cycles: { R: included[si].R.length, L: included[si].L.length },
      excludedCycles: total('R') + total('L') - included[si].R.length - included[si].L.length,
      speed,
      speedReference: src.data.com ? 'Body COM' : 'Pelvis marker center',
      comModel: src.data.comModel,
      markerSource: src.data.markerSource,
    };
  });
  const overallSpeed = scalarMeanSD(trials.map((t) => (t.speed ? t.speed.speed : null)));

  const events = sources.flatMap((src) =>
    src.trial.events.map((e) => ({ ...e, zipName: src.dataset.file.name, trialName: src.trial.motName }))
  );

  return { sides, sideResults, stResults, comResults, comAvailable, trials, overallSpeed, events };
}

// イベントの編集で存在しなくなった周期を除外リストから外す
function pruneExcluded(sources) {
  const existing = new Set();
  for (const src of sources) {
    for (const side of SIDES) src.bySide[side].forEach((c) => existing.add(cycleKey(src.dataset, src.trial, side, c)));
  }
  for (const key of [...state.excluded.keys()]) {
    if (!existing.has(key)) state.excluded.delete(key);
  }
}

function runAnalysis() {
  const sources = collectSources();
  pruneExcluded(sources);
  const { ok, errors } = checkSources(sources);
  if (!ok) {
    el.analyzeError.textContent = errors.join(' ');
    return;
  }
  // 一部の試行・側だけ必要列が欠けている場合は、解析可能なものの結果を出しつつ警告を表示する
  el.analyzeError.textContent = errors.join(' ');

  const usable = sources.filter((s) => s.sides.length > 0);
  const result = analyzeSources(usable);
  const { sides, sideResults, stResults, comResults } = result;
  if (sides.length === 0) {
    el.analyzeError.textContent = '全ての歩行周期が除外されています。除外した周期を戻してください。';
    return;
  }
  state.analysisResult = { ...result, sources: usable, excluded: [...state.excluded.values()] };
  const allKeys = new Set(sides.flatMap((side) => sideResults[side].cycles.map((c) => c.key)));
  if (!allKeys.has(state.selectedCycleKey)) state.selectedCycleKey = null;

  const chartSides = (pick) =>
    sides.map((side) => {
      const { cycles, summary } = pick(side);
      return {
        side,
        label: SIDE_LABELS[side],
        cycles,
        cycleKeys: sideResults[side].cycles.map((c) => c.key),
        mean: summary.mean,
        sd: summary.sd,
        toeOffPercent: sideResults[side].stancePercent.mean,
      };
    });
  const jointSides = (joint) =>
    chartSides((side) => ({
      cycles: sideResults[side].cycles.map((c) => c.normalized[joint]),
      summary: sideResults[side].summary[joint],
    }));
  const comSides = (key) =>
    chartSides((side) => ({
      cycles: comResults[side].cycles.map((c) => c.normalized[key]),
      summary: comResults[side].summary[key],
    }));
  const chartOptions = { onCycleClick: selectCycle, selectedKey: state.selectedCycleKey };

  showSection(el.sectionResult, true);
  showSection(el.comResult, true);
  state.charts = {
    hip: renderChart(el.chartHip, 'Hip Flexion Angle', jointSides('hip'), 'Angle (deg)', chartOptions),
    knee: renderChart(el.chartKnee, 'Knee Flexion Angle', jointSides('knee'), 'Angle (deg)', chartOptions),
    ankle: renderChart(el.chartAnkle, 'Ankle Angle', jointSides('ankle'), 'Angle (deg)', chartOptions),
  };
  el.chartComVertical.hidden = !comResults;
  el.chartComMl.hidden = !comResults;
  if (comResults) {
    state.charts.comVertical = renderChart(
      el.chartComVertical,
      'COM Vertical Position',
      comSides('verticalPos'),
      'Position from origin (m)',
      chartOptions
    );
    state.charts.comMl = renderChart(
      el.chartComMl,
      'COM Mediolateral Position (+Right)',
      comSides('mlPos'),
      'Position from origin (m)',
      chartOptions
    );
  }

  el.resultSummary.innerHTML = '';
  el.comSummary.innerHTML = '';
  const zipCount = new Set(usable.map((s) => s.dataset)).size;
  const scope = document.createElement('p');
  scope.textContent =
    `解析対象: ZIP ${zipCount} 件・${usable.length} 試行` +
    (state.excluded.size > 0 ? `（除外した周期 ${state.excluded.size} 件）` : '');
  el.resultSummary.appendChild(scope);
  sides.forEach((side) => {
    const p = document.createElement('p');
    p.className = `side-text-${side}`;
    p.textContent = summaryText(sideResults[side]);
    el.resultSummary.appendChild(p);
    if (comResults) {
      const pc = document.createElement('p');
      pc.className = `side-text-${side}`;
      pc.textContent = comSummaryText(side, comResults[side]);
      el.comSummary.appendChild(pc);
    }
  });
  if (!comResults) {
    const missing = usable.filter((s) => !s.data.com).map((s) => s.label);
    const p = document.createElement('p');
    p.className = 'status-text';
    p.textContent = `身体重心を算出できない試行があるため、身体重心の解析は行いません: ${missing.join('、')}`;
    el.comSummary.appendChild(p);
  }

  renderSpatioTemporalTable(sides, stResults, result.overallSpeed);
  renderCycleTools();

  showSection(el.sectionDownload, true);
  el.downloadStatus.textContent = '';
}

el.btnAnalyze.addEventListener('click', runAnalysis);

// ---------- Section 8: Cycle selection / exclusion ----------

function cycleLabel(side, info) {
  return `${SIDE_LABELS[side]} · ${info.zipName} / ${info.trialName} · 周期 ${info.cycleInTrial}（sample ${info.startSample}→${info.endSample}）`;
}

function cycleInfoOf(side, c) {
  return {
    key: c.key,
    side,
    zipName: c.zipName,
    trialName: c.trialName,
    cycleInTrial: c.cycleInTrial,
    startSample: c.start.sampleIndex + 1,
    endSample: c.end.sampleIndex + 1,
    startTime: c.start.motTime,
    endTime: c.end.motTime,
  };
}

function analyzedCycleInfos() {
  const r = state.analysisResult;
  if (!r) return [];
  return r.sides.flatMap((side) => r.sideResults[side].cycles.map((c) => ({ ...cycleInfoOf(side, c), number: c.number })));
}

// 選択中の周期の表示、周期の一覧（プルダウン）、除外した周期の一覧を更新する
function renderCycleTools() {
  const infos = analyzedCycleInfos();
  el.cyclePicker.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '（選択なし）';
  el.cyclePicker.appendChild(none);
  for (const info of infos) {
    const opt = document.createElement('option');
    opt.value = info.key;
    opt.textContent = `${info.side} C${info.number}: ${cycleLabel(info.side, info)}`;
    el.cyclePicker.appendChild(opt);
  }
  el.cyclePicker.value = state.selectedCycleKey || '';

  const selected = infos.find((i) => i.key === state.selectedCycleKey);
  el.btnExcludeCycle.disabled = !selected;
  el.selectedCycleInfo.textContent = selected
    ? `選択中: ${cycleLabel(selected.side, selected)}（全てのグラフでオレンジ色の線）`
    : 'グラフの細線をクリックするか、一覧から歩行周期を選択してください。';

  el.excludedList.innerHTML = '';
  for (const info of state.excluded.values()) {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = `${info.side} · ${info.trialName} 周期 ${info.cycleInTrial}`;
    text.title = cycleLabel(info.side, info);
    li.append(text, button('戻す', 'secondary', () => restoreCycles([info.key])));
    el.excludedList.appendChild(li);
  }
  el.excludedCycles.hidden = state.excluded.size === 0;
}

function selectCycle(key) {
  state.selectedCycleKey = key || null;
  el.cycleToolsError.textContent = '';
  if (state.charts) {
    Object.values(state.charts).forEach((chart) => highlightCycle(chart, state.selectedCycleKey));
  }
  renderCycleTools();
}

function excludeCycle(key) {
  const infos = analyzedCycleInfos();
  const info = infos.find((i) => i.key === key);
  if (!info) return;
  if (infos.length <= 1) {
    el.cycleToolsError.textContent = '最後の1周期は除外できません。';
    return;
  }
  const { number, ...rest } = info;
  state.excluded.set(key, rest);
  state.selectedCycleKey = null;
  el.cycleToolsError.textContent = '';
  onExclusionChanged();
}

function restoreCycles(keys) {
  keys.forEach((k) => state.excluded.delete(k));
  onExclusionChanged();
}

// 除外の変更を解析結果・周期一覧・ZIP一覧に反映する
function onExclusionChanged() {
  renderCycleTable();
  renderDatasetTable();
  if (state.analysisResult) {
    runAnalysis();
  } else {
    renderCycleTools();
  }
}

el.cyclePicker.addEventListener('change', (e) => selectCycle(e.target.value));
el.btnExcludeCycle.addEventListener('click', () => {
  if (state.selectedCycleKey) excludeCycle(state.selectedCycleKey);
});
el.btnRestoreAll.addEventListener('click', () => restoreCycles([...state.excluded.keys()]));

// ---------- Section 9: Excel download ----------

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

el.btnDownloadExcel.addEventListener('click', async () => {
  if (!state.analysisResult) return;

  el.downloadStatus.textContent = 'Excelを生成中...';

  try {
    const { sideResults, stResults, comResults, sides, events, trials, overallSpeed, sources, excluded } = state.analysisResult;

    // グラフ画像は選択中の周期を強調しない状態で出力する
    const chartImages = {};
    for (const [key, chart] of Object.entries(state.charts)) {
      if (state.selectedCycleKey) highlightCycle(chart, null);
      chartImages[key] = chartToPngDataUrl(chart);
      if (state.selectedCycleKey) highlightCycle(chart, state.selectedCycleKey);
    }

    const metadata = {
      'Number of ZIP files': new Set(sources.map((s) => s.dataset)).size,
      'Number of trials': sources.length,
      ...Object.fromEntries(sources.map((s, i) => [`Source ${i + 1}`, s.label])),
      'Analyzed sides': sides.map((s) => SIDE_LABELS[s]).join(', '),
      'Gait cycle definition': 'Consecutive ipsilateral IC to IC (cycles pooled across all trials and ZIP files)',
      'Number of events': events.length,
      'Excluded cycles': excluded.length,
      'Normalization points': 101,
      'Interpolation method': 'linear',
      'SD definition': 'Sample SD (n-1), across pooled cycles (walking speed: across trials)',
      'Walking speed definition':
        'Per trial: horizontal displacement of the reference point (Body COM, or pelvis marker center if COM is unavailable) from the first to the last IC (either side) / time; overall = mean across trials',
      'Spatiotemporal definitions':
        'Step length = progression distance from contralateral heel (*_calc_study) at contralateral IC to ipsilateral heel at next ipsilateral IC; Stance = IC to TO; Swing = TO to next IC; Loading response = IC to contralateral TO; Pre-swing = contralateral IC to TO',
      'COM method': comResults
        ? 'Mass-weighted mean of all body COMs via forward kinematics of the scaled OpenSim model (MOT coordinates as exported by OpenCap, no additional filtering); velocity by central difference'
        : '(not computed: COM unavailable for some trials)',
      'COM axes': comResults
        ? 'Vertical = ground Y (floor ~ 0); AP = horizontal COM displacement direction from IC to next IC per cycle; ML = AP x vertical (+right). Position columns are measured from the ground origin; displacement columns from the cycle mean (vertical/ML) or cycle start (AP)'
        : '(not computed)',
      'Application version': APP_VERSION,
      'Export date/time': new Date().toISOString(),
    };

    const workbook = buildWorkbook({
      chartImages,
      events,
      sideResults,
      stResults,
      comResults,
      trials,
      overallSpeed,
      excluded,
      metadata,
    });

    const filename =
      sources.length === 1
        ? buildExportFilename(sources[0].dataset.file.name, sources[0].trial.motName)
        : `OpenCapGait_${sources.length}trials_${timestamp()}.xlsx`;
    await downloadWorkbook(workbook, filename);

    el.downloadStatus.textContent = `ダウンロードしました: ${filename}`;
  } catch (err) {
    el.downloadStatus.textContent = `Excel生成に失敗しました: ${err.message || err}`;
  }
});
