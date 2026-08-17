// MOTのtimeを唯一の同期基準とし、動画はその時刻へシークして視覚確認用に表示する。
export class VideoController {
  constructor(videoElement) {
    this.video = videoElement;
    this.currentObjectUrl = null;
  }

  hasSource() {
    return Boolean(this.currentObjectUrl);
  }

  setSource(blob) {
    this.revoke();
    if (!blob) {
      this.video.removeAttribute('src');
      this.video.load();
      return;
    }
    const url = URL.createObjectURL(blob);
    this.currentObjectUrl = url;
    this.video.src = url;
  }

  revoke() {
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
  }

  // メタデータ読み込み待機 → currentTime設定 → seekedイベント待機
  // → requestVideoFrameCallback → 完了。
  //
  // 注意: 一時停止中の動画やヘッドレス環境ではrequestVideoFrameCallbackが
  // 発火しないことがある。そのためタイムアウトによる安全策は
  // rVFCを経由せず直接resolveする（rVFC待ちのままタイムアウト自体が
  // ハングするのを防ぐ）。また、既に目的の時刻にいる場合はseekedが
  // 発火しないためシーク自体をスキップする。
  async seekToTime(time) {
    const video = this.video;

    if (video.readyState < 1) {
      await new Promise((resolve) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
        setTimeout(resolve, 2000);
      });
    }

    if (Math.abs(video.currentTime - time) < 1e-4) {
      return;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener('seeked', onSeeked);
        clearTimeout(timeoutId);
        resolve();
      };
      const onSeeked = () => {
        if (typeof video.requestVideoFrameCallback === 'function') {
          video.requestVideoFrameCallback(finish);
        } else {
          finish();
        }
      };
      // rVFCが発火しない場合でも1.5秒後に必ず解決する
      const timeoutId = setTimeout(finish, 1500);

      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;
    });
  }
}
