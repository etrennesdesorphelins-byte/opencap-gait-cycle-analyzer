import './styles/main.css';

import { loadZip } from './modules/zipLoader.js';
import { buildTrialList, loadTrialData, loadVideoBlob, loadOsimModel } from './modules/trialManager.js';
import { computeCenterOfMassTrajectory } from './modules/bodyKinematics.js';
import { analyzeComForSide } from './modules/comAnalysis.js';
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
import { analyzeSide } from './modules/normalizer.js';
import { renderChart, chartToPngDataUrl } from './modules/chartRenderer.js';
import { buildWorkbook, downloadWorkbook } from './modules/excelExporter.js';
import { buildExportFilename } from './utils/filename.js';
import { clamp, round } from './utils/numbers.js';

const APP_VERSION = '1.2.0';

const el = {
  dropZone: document.getElementById('drop-zone'),
  btnSelectZip: document.getElementById('btn-select-zip'),
  inputZip: document.getElementById('input-zip'),
  zipStatus: document.getElementById('zip-status'),
  zipError: document.getElementById('zip-error'),

  sectionSelection: document.getElementById('section-selection'),
  selectTrial: document.getElementById('select-trial'),
  selectionError: document.getElementById('selection-error'),
  comStatus: document.getElementById('com-status'),

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

  sectionAnalyze: document.getElementById('section-analyze'),
  btnAnalyze: document.getElementById('btn-analyze'),
  analyzeError: document.getElementById('analyze-error'),

  sectionResult: document.getElementById('section-result'),
  resultSummary: document.getElementById('result-summary'),
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
  currentSampleIndex: 0,
  // 試行ごとの歩行イベント（motPath → イベント配列）。試行を切り替えても設定内容を保持する
  eventsByTrial: new Map(),
  events: createEventList(),
  // ZIP内のOpenSimモデル（パス → 解析済みモデルのPromise）。同じモデルを試行ごとに再解析しない
  modelCache: new Map(),
  // 選択中の試行の身体重心時系列と、算出に用いたモデルの情報（算出できない場合は null）
  com: null,
  comModel: null,
  analysisResult: null,
  charts: null,
};

function showSection(sectionEl, visible) {
  sectionEl.hidden = !visible;
}

// イベントが変わったら、以前の解析結果は無効になるため非表示にする
function invalidateAnalysis() {
  state.analysisResult = null;
  state.charts = null;
  showSection(el.sectionResult, false);
  showSection(el.sectionDownload, false);
  el.analyzeError.textContent = '';
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
    state.eventsByTrial = new Map();
    state.modelCache = new Map();

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

// ---------- Section 2: Trial selection ----------

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

    await updateCenterOfMass(trial);

    state.videoBlobCache = new Map();
    renderCameraSelect(trial);
    await updateDisplayedVideos();

    el.timeSlider.min = '0';
    el.timeSlider.max = String(state.timeArray.length - 1);
    el.timeSlider.value = '0';

    if (!state.eventsByTrial.has(trial.motPath)) {
      state.eventsByTrial.set(trial.motPath, createEventList());
    }
    state.events = state.eventsByTrial.get(trial.motPath);
    el.icError.textContent = '';
    invalidateAnalysis();
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

// ---------- Center of mass (OpenSim model) ----------

function getModel(path) {
  if (!state.modelCache.has(path)) {
    state.modelCache.set(path, loadOsimModel(state.zipInstance, path));
  }
  return state.modelCache.get(path);
}

// 試行のMOTとスケーリング済みOpenSimモデルから身体重心の時系列を求める。
// 算出できなくても関節角度の解析は続けられるため、エラーは状態表示にとどめる。
async function updateCenterOfMass(trial) {
  state.com = null;
  state.comModel = null;
  if (!trial.modelPath) {
    el.comStatus.textContent =
      '身体重心: OpenSimData/Model 内にモデル(.osim)が見つからないため算出しません（関節角度の解析は可能です）。';
    return;
  }
  try {
    const model = await getModel(trial.modelPath);
    const com = computeCenterOfMassTrajectory(model, state.motData);
    state.com = com;
    state.comModel = { path: trial.modelPath, name: model.name, totalMass: model.totalMass };
    const fileName = trial.modelPath.split('/').pop();
    let text = `身体重心: ${fileName}（総質量 ${round(model.totalMass, 1)} kg）から算出しました。`;
    if (com.missingCoordinates.length > 0) {
      text += ` MOTにない座標はモデルの既定値を使用: ${com.missingCoordinates.join(', ')}`;
    }
    el.comStatus.textContent = text;
  } catch (err) {
    el.comStatus.textContent = `身体重心を算出できませんでした: ${err.message || err}`;
  }
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

const fmt = (v, digits = 1) => (v === null || v === undefined ? '-' : round(v, digits).toFixed(digits));

function sideCell(side) {
  const td = document.createElement('td');
  td.textContent = SIDE_LABELS[side];
  td.className = `side-text-${side}`;
  return td;
}

function textCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function renderEventTable() {
  el.eventTableBody.innerHTML = '';
  state.events.forEach((event, i) => {
    const tr = document.createElement('tr');
    tr.dataset.sample = String(event.sampleIndex);

    const actions = document.createElement('td');
    const btnGo = document.createElement('button');
    btnGo.type = 'button';
    btnGo.className = 'secondary';
    btnGo.textContent = '移動';
    btnGo.addEventListener('click', () => goToSample(event.sampleIndex));
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'danger';
    btnDel.textContent = '削除';
    btnDel.setAttribute('aria-label', `${SIDE_LABELS[event.side]} ${EVENT_LABELS[event.type]} sample ${event.sampleIndex + 1} を削除`);
    btnDel.addEventListener('click', () => {
      removeEvent(state.events, event.id);
      onEventsChanged();
    });
    actions.append(btnGo, ' ', btnDel);

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
      tr.append(
        sideCell(side),
        textCell(String(c.number)),
        textCell(`${c.start.sampleIndex + 1} → ${c.end.sampleIndex + 1}`),
        textCell(round(c.duration, 3).toFixed(3)),
        textCell(fmt(c.stancePercent)),
        textCell(fmt(c.oppositeToeOffPercent)),
        textCell(fmt(c.oppositeICPercent))
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

function refreshEvents() {
  renderEventTable();
  renderCycleTable();
  renderEventTrack();
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

// ---------- Section 6: Analyze ----------

function updateAnalyzeButtonState() {
  const { ok } = checkAnalysisReady({ motData: state.motData, cyclesBySide: cyclesBySide() });
  el.btnAnalyze.disabled = !ok;
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
    `歩行速度 ${withSD(com.speed, 2, 'm/s')}`,
  ];
  if (com.undefinedDirectionCount > 0) {
    parts.push(`進行方向を決められない周期が ${com.undefinedDirectionCount} 件（左右・前後成分は参考値）`);
  }
  return parts.join('、');
}

el.btnAnalyze.addEventListener('click', () => {
  const bySide = cyclesBySide();
  const { ok, errors, sides } = checkAnalysisReady({ motData: state.motData, cyclesBySide: bySide });

  if (!ok) {
    el.analyzeError.textContent = errors.join(' ');
    return;
  }
  // 一方の側だけ必要列が欠けている場合は、解析可能な側の結果を出しつつ警告を表示する
  el.analyzeError.textContent = errors.join(' ');

  const sideResults = {};
  sides.forEach((side) => {
    sideResults[side] = analyzeSide(state.motData, side, bySide[side]);
  });
  let comResults = null;
  if (state.com) {
    comResults = {};
    sides.forEach((side) => {
      comResults[side] = analyzeComForSide(state.com, bySide[side]);
    });
  }
  state.analysisResult = {
    sideResults,
    comResults,
    comModel: state.comModel,
    sides,
    events: state.events.map((e) => ({ ...e })),
  };

  const chartSides = (pick) =>
    sides.map((side) => {
      const { cycles, summary } = pick(side);
      return {
        side,
        label: SIDE_LABELS[side],
        cycles,
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

  showSection(el.sectionResult, true);
  showSection(el.comResult, Boolean(comResults));
  state.charts = {
    hip: renderChart(el.chartHip, 'Hip Flexion Angle', jointSides('hip')),
    knee: renderChart(el.chartKnee, 'Knee Flexion Angle', jointSides('knee')),
    ankle: renderChart(el.chartAnkle, 'Ankle Angle', jointSides('ankle')),
  };
  if (comResults) {
    state.charts.comVertical = renderChart(
      el.chartComVertical,
      'COM Vertical Position',
      comSides('verticalPos'),
      'Position from origin (m)'
    );
    state.charts.comMl = renderChart(
      el.chartComMl,
      'COM Mediolateral Position (+Right)',
      comSides('mlPos'),
      'Position from origin (m)'
    );
  }

  el.resultSummary.innerHTML = '';
  el.comSummary.innerHTML = '';
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

  showSection(el.sectionDownload, true);
  el.downloadStatus.textContent = '';
});

// ---------- Section 8: Excel download ----------

el.btnDownloadExcel.addEventListener('click', async () => {
  if (!state.analysisResult) return;

  el.downloadStatus.textContent = 'Excelを生成中...';

  try {
    const { sideResults, comResults, comModel, sides, events } = state.analysisResult;

    const chartImages = {};
    for (const [key, chart] of Object.entries(state.charts)) {
      chartImages[key] = chartToPngDataUrl(chart);
    }

    const metadata = {
      'ZIP file name': state.zipFile.name,
      'MOT file name': state.selectedTrial.motName,
      'Video file path':
        state.selectedTrial.videos.length === 0
          ? '(not found)'
          : videoGrid.panels.map((p) => p.path).join('; ') || '(not displayed)',
      'Analyzed sides': sides.map((s) => SIDE_LABELS[s]).join(', '),
      'Gait cycle definition': 'Consecutive ipsilateral IC to IC',
      'Number of events': events.length,
      'Normalization points': 101,
      'Interpolation method': 'linear',
      'SD definition': 'Sample SD (n-1), across cycles',
      'COM model file': comModel ? comModel.path : '(not computed)',
      'COM model total mass (kg)': comModel ? comModel.totalMass : null,
      'COM method': comModel
        ? 'Mass-weighted mean of all body COMs via forward kinematics of the scaled OpenSim model (MOT coordinates as exported by OpenCap, no additional filtering); velocity by central difference'
        : '(not computed)',
      'COM axes': comModel
        ? 'Vertical = ground Y (floor ~ 0); AP = horizontal COM displacement direction from IC to next IC per cycle; ML = AP x vertical (+right). Position columns are measured from the ground origin; displacement columns from the cycle mean (vertical/ML) or cycle start (AP)'
        : '(not computed)',
      'Application version': APP_VERSION,
      'Export date/time': new Date().toISOString(),
    };

    const workbook = buildWorkbook({ chartImages, events, sideResults, comResults, metadata });

    const filename = buildExportFilename(state.zipFile.name, state.selectedTrial.motName);
    await downloadWorkbook(workbook, filename);

    el.downloadStatus.textContent = `ダウンロードしました: ${filename}`;
  } catch (err) {
    el.downloadStatus.textContent = `Excel生成に失敗しました: ${err.message || err}`;
  }
});
