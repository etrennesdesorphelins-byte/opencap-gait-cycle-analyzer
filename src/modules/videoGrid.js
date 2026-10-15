import { VideoController } from './videoController.js';
import { VideoZoomController } from './videoZoom.js';

function createButton(text, ariaLabel) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  return btn;
}

// 選択されたカメラごとに動画パネル（動画＋拡大/縮小操作）を生成し、
// 全パネルを同じMOT時刻へシークする。
// 先頭パネルを基準動画（primary）とし、Video Time表示やIC記録に用いる。
export class VideoGrid {
  constructor(containerEl) {
    this.container = containerEl;
    this.panels = [];
  }

  get primary() {
    return this.panels[0] || null;
  }

  hasVideo() {
    return this.panels.length > 0;
  }

  // videos: [{ camera, path, blob }]
  setVideos(videos) {
    this.clear();
    const isMulti = videos.length > 1;
    videos.forEach((video, idx) => {
      this.panels.push(this._createPanel(video, idx === 0, isMulti));
    });
    this.container.classList.toggle('multi', isMulti);
  }

  clear() {
    for (const panel of this.panels) {
      panel.controller.revoke();
    }
    this.container.innerHTML = '';
    this.container.classList.remove('multi');
    this.panels = [];
  }

  async seekAll(time) {
    await Promise.all(this.panels.map((panel) => panel.controller.seekToTime(time)));
  }

  // 1つの動画をネイティブコントロールで再生/一時停止したとき、他の動画も追従させる。
  // 他の動画の状態が既に一致していれば何もしないため、イベントがループしない。
  _syncPlayback(sourceVideo, type) {
    for (const panel of this.panels) {
      const video = panel.video;
      if (video === sourceVideo) continue;
      if (type === 'play' && video.paused) {
        video.currentTime = sourceVideo.currentTime;
        video.play().catch(() => {});
      } else if (type === 'pause' && !video.paused) {
        video.pause();
        video.currentTime = sourceVideo.currentTime;
      }
    }
  }

  _createPanel({ camera, path, blob }, isPrimary, isMulti) {
    const panelEl = document.createElement('div');
    panelEl.className = 'video-panel';

    const header = document.createElement('div');
    header.className = 'video-panel-header';
    const label = document.createElement('span');
    label.className = 'video-camera-label';
    label.textContent = isPrimary && isMulti ? `${camera}（基準）` : camera;
    label.title = path;
    header.appendChild(label);

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.muted = !isPrimary;
    wrapper.appendChild(video);

    const zoomControls = document.createElement('div');
    zoomControls.className = 'zoom-controls';
    const btnOut = createButton('－', `${camera} を縮小`);
    const display = document.createElement('span');
    display.className = 'zoom-level';
    display.textContent = '100%';
    const btnIn = createButton('＋', `${camera} を拡大`);
    const btnReset = createButton('リセット');
    zoomControls.append(btnOut, display, btnIn, btnReset);

    panelEl.append(header, wrapper, zoomControls);
    this.container.appendChild(panelEl);

    const controller = new VideoController(video);
    controller.setSource(blob);
    const zoom = new VideoZoomController(wrapper, video, display);
    btnIn.addEventListener('click', () => zoom.zoomIn());
    btnOut.addEventListener('click', () => zoom.zoomOut());
    btnReset.addEventListener('click', () => zoom.reset());

    video.addEventListener('play', () => this._syncPlayback(video, 'play'));
    video.addEventListener('pause', () => this._syncPlayback(video, 'pause'));

    return { camera, path, video, controller, zoom };
  }
}
