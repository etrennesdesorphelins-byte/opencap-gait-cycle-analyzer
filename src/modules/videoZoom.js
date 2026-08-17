const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.5;

// ネイティブの動画コントロール（再生バー等）を誤操作しないよう、
// 動画下端からこの高さ(px)の範囲ではドラッグパンを開始しない。
const CONTROL_BAR_EXCLUSION = 40;

// 動画の拡大/縮小、および拡大時のドラッグによる表示位置移動（パン）を行う。
// IC選択時に接地部分等を拡大して確認しやすくするための機能。
export class VideoZoomController {
  constructor(wrapperEl, videoEl, displayEl) {
    this.wrapper = wrapperEl;
    this.video = videoEl;
    this.display = displayEl;
    this.zoom = MIN_ZOOM;
    this.panX = 0;
    this.panY = 0;
    this.dragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.panStart = { x: 0, y: 0 };

    this._bindDrag();
    this._applyTransform();
  }

  zoomIn() {
    this.setZoom(this.zoom + ZOOM_STEP);
  }

  zoomOut() {
    this.setZoom(this.zoom - ZOOM_STEP);
  }

  reset() {
    this.zoom = MIN_ZOOM;
    this.panX = 0;
    this.panY = 0;
    this._applyTransform();
  }

  setZoom(value) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    if (this.zoom === MIN_ZOOM) {
      this.panX = 0;
      this.panY = 0;
    } else {
      this._clampPan();
    }
    this._applyTransform();
  }

  // ズーム倍率に応じてパン可能範囲を制限し、映像が完全に枠外へ外れないようにする
  _clampPan() {
    const rect = this.wrapper.getBoundingClientRect();
    const maxX = (rect.width * (this.zoom - 1)) / 2;
    const maxY = (rect.height * (this.zoom - 1)) / 2;
    this.panX = Math.min(maxX, Math.max(-maxX, this.panX));
    this.panY = Math.min(maxY, Math.max(-maxY, this.panY));
  }

  _applyTransform() {
    this.video.style.transform =
      this.zoom === MIN_ZOOM ? '' : `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
    this.wrapper.classList.toggle('zoomed', this.zoom > MIN_ZOOM);
    if (this.display) {
      this.display.textContent = `${Math.round(this.zoom * 100)}%`;
    }
  }

  _isOnControlBar(e) {
    const rect = this.wrapper.getBoundingClientRect();
    return e.clientY > rect.bottom - CONTROL_BAR_EXCLUSION;
  }

  _bindDrag() {
    const onPointerDown = (e) => {
      if (this.zoom <= MIN_ZOOM) return;
      if (this._isOnControlBar(e)) return;
      this.dragging = true;
      this.wrapper.classList.add('dragging');
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.panStart = { x: this.panX, y: this.panY };
      this.wrapper.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e) => {
      if (!this.dragging) return;
      this.panX = this.panStart.x + (e.clientX - this.dragStart.x);
      this.panY = this.panStart.y + (e.clientY - this.dragStart.y);
      this._clampPan();
      this._applyTransform();
    };

    const onPointerUp = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.wrapper.classList.remove('dragging');
      if (this.wrapper.hasPointerCapture(e.pointerId)) {
        this.wrapper.releasePointerCapture(e.pointerId);
      }
    };

    this.wrapper.addEventListener('pointerdown', onPointerDown);
    this.wrapper.addEventListener('pointermove', onPointerMove);
    this.wrapper.addEventListener('pointerup', onPointerUp);
    this.wrapper.addEventListener('pointercancel', onPointerUp);
  }
}

export const ZOOM_MIN = MIN_ZOOM;
export const ZOOM_MAX = MAX_ZOOM;
