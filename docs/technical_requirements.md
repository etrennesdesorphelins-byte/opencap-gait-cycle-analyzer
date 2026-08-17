# OpenCap Gait Cycle Analyzer 技術要件書

## 1. 技術方針

本アプリケーションはGitHub Pagesで公開可能な**完全クライアントサイドWebアプリケーション**として実装する。

利用者が選択したOpenCap ZIPファイルはサーバーへ送信せず、ブラウザメモリ内で展開・解析する。

基本構成：

```text
Browser
  ├─ ZIP extraction
  ├─ MOT parsing
  ├─ MP4 playback
  ├─ IC selection
  ├─ Time normalization
  ├─ Graph rendering
  └─ Excel generation
```

---

## 2. 推奨技術スタック

### 2.1 フロントエンド

推奨：

```text
HTML5
CSS3
JavaScript
```

初期版は依存関係を減らすため、React等の大型フレームワークは必須としない。

Claude Codeでの開発効率を考慮し、以下のいずれかとする。

### 推奨案A

```text
Vite
Vanilla JavaScript
HTML
CSS
```

利点：

- GitHub Pagesへ公開しやすい
- npmライブラリを利用しやすい
- ファイル分割しやすい
- 将来的な機能拡張に対応しやすい

### 最小構成案B

```text
index.html
style.css
app.js
```

CDN経由で必要ライブラリを読み込む。

ただし、研究用途で継続開発する場合は**Vite + Vanilla JavaScript**を推奨する。

---

## 3. 推奨ライブラリ

### 3.1 ZIP展開

**JSZip**

用途：

- ZIPファイル読み込み
- ZIP内ファイル一覧取得
- `.mot` テキスト抽出
- `.mp4` Blob抽出

---

## 3.2 Excel生成

推奨：

**ExcelJS**

主用途：

- `.xlsx` 作成
- 複数シート作成
- セル書式設定
- 画像挿入

注意：

ExcelグラフオブジェクトをJavaScriptのみで直接生成する機能には制約がある。

そのためVersion 1.0では、

1. Web画面上でChart.js等を用いてグラフを描画
2. CanvasをPNG画像へ変換
3. ExcelのGraphsシートへ画像として貼り付ける

方式を推奨する。

これはブラウザ環境で安定して実装しやすい。

---

## 3.3 グラフ

推奨：

**Chart.js**

用途：

- Hip flexion
- Knee flexion
- Ankle angle

の101点波形を描画する。

設定：

```text
X axis: 0–100 %
Y axis: deg
No smoothing
Line chart
```

Excel出力時はCanvasからPNGを作成する。

---

## 3.4 動画

HTML5：

```html
<video>
```

を使用する。

基本操作：

```javascript
video.currentTime = targetTime;
```

を用いてMOTの `time` と同期する。

必要に応じて：

```javascript
HTMLVideoElement.requestVideoFrameCallback()
```

を利用し、描画済み動画フレームの `mediaTime` を取得する。

---

## 4. 推奨ディレクトリ構成

```text
opencap-gait-analyzer/
├─ index.html
├─ package.json
├─ vite.config.js
├─ README.md
├─ docs/
│  ├─ requirements.md
│  └─ technical_requirements.md
├─ src/
│  ├─ main.js
│  ├─ styles/
│  │  └─ main.css
│  ├─ modules/
│  │  ├─ zipLoader.js
│  │  ├─ motParser.js
│  │  ├─ trialManager.js
│  │  ├─ videoController.js
│  │  ├─ icSelector.js
│  │  ├─ normalizer.js
│  │  ├─ chartRenderer.js
│  │  ├─ excelExporter.js
│  │  └─ validators.js
│  └─ utils/
│     ├─ filename.js
│     └─ numbers.js
└─ public/
   └─ favicon.*
```

---

## 5. ZIP処理仕様

### 5.1 読み込み

```javascript
const zip = await JSZip.loadAsync(file);
```

### 5.2 MOT検索

ZIP内のファイル名を検索し、以下に一致するファイルを抽出する。

```text
OpenSimData/Kinematics/*.mot
```

パス比較時は必要に応じて以下を実施する。

- `\` → `/`
- 大文字・小文字を無視
- 先頭 `/` を除去

### 5.3 動画検索

MOT：

```text
OpenSimData/Kinematics/gsdgait1.mot
```

ベース名：

```text
gsdgait1
```

期待動画：

```text
Videos/Cam0/InputMedia/gsdgait1/gsdgait1_sync.mp4
```

探索アルゴリズムは完全一致を第一候補とする。

見つからない場合はZIP全体から、

```text
*/gsdgait1_sync.mp4
```

をフォールバック検索する。

---

## 6. MOTパーサー仕様

### 6.1 OpenSim MOT形式

MOTファイルにはヘッダーが存在し、一般に以下のような終了行を持つ。

```text
endheader
```

`endheader` の次の非空行を列名行として扱う。

区切り文字は以下を許容する。

- tab
- 複数space

### 6.2 必須列

```text
time
```

`Time` など大文字・小文字差は許容し、内部では小文字へ正規化して照合する。

### 6.3 関節変数

Right：

```text
hip_flexion_r
knee_angle_r
ankle_angle_r
```

Left：

```text
hip_flexion_l
knee_angle_l
ankle_angle_l
```

列名は元データを保持しつつ、検索時のみcase-insensitiveとする。

### 6.4 データ型

全数値データはJavaScript `Number` として保持する。

推奨内部形式：

```javascript
{
  headers: [],
  rows: [],
  columns: {
    time: [],
    hip_flexion_r: [],
    ...
  },
  metadata: {}
}
```

---

## 7. 時刻・動画同期仕様

## 7.1 同期の基準

**MOTの `time` 列を唯一の基準時刻とする。**

動画フレーム番号そのものを解析の基準にはしない。

理由：

- MP4のfps情報取得はブラウザAPIだけでは安定しない
- 可変フレームレートの可能性がある
- IC解析の最終的な切り出しはMOTデータに対して行うため

---

## 7.2 1ステップ送り

現在選択中のMOTサンプルを `i` とする。

次へ：

```javascript
i = Math.min(i + 1, time.length - 1);
video.currentTime = time[i];
```

前へ：

```javascript
i = Math.max(i - 1, 0);
video.currentTime = time[i];
```

10ステップ送り：

```javascript
i = Math.min(i + 10, time.length - 1);
```

10ステップ戻り：

```javascript
i = Math.max(i - 10, 0);
```

---

## 7.3 動画開始時刻

通常はOpenCapの `_sync.mp4` とMOTの `time` が同期済みであることを前提とする。

ただし、MOTの最初のtimeが0でないケースにも対応できるよう、内部では以下を許容する。

```text
videoTime = motTime - motTime[0]
```

Version 1.0では実データを確認した上で、

```text
videoTime = motTime
```

または上記オフセット方式のどちらを採用するかをテストで確定する。

可能であれば自動判定する。

---

## 7.4 フレーム精度に関する仕様

ブラウザのMP4再生では、`currentTime` を設定した瞬間に必ずしも意図したフレームが画面描画済みとは限らない。

そのため実装では、

```text
currentTime設定
↓
seekedイベント待機
↓
requestVideoFrameCallback
↓
画面更新
```

の順で処理する。

IC選択ボタンは動画のseek完了後に有効化する。

---

## 7.5 Canvasプレビュー

IC確認精度向上のため、必要に応じて現在動画フレームをCanvasへ描画する。

```javascript
ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
```

IC登録時にはCanvasの表示画像をそのまま保持する必要はないが、将来的なIC画像保存機能へ拡張可能な構造とする。

---

## 8. IC選択データ構造

推奨：

```javascript
const icSelection = {
  first: {
    sampleIndex: null,
    motTime: null,
    videoTime: null
  },
  second: {
    sampleIndex: null,
    motTime: null,
    videoTime: null
  }
};
```

### バリデーション

解析実行可能条件：

```javascript
first.sampleIndex !== null
second.sampleIndex !== null
second.sampleIndex > first.sampleIndex
```

---

## 9. 解析仕様

### 9.1 区間抽出

インデックス：

```text
start = firstIC.sampleIndex
end   = secondIC.sampleIndex
```

配列切り出しでは終了点を含める。

```javascript
slice(start, end + 1)
```

---

## 9.2 歩行周期%

元データの各時点について：

```text
gaitCycle =
(time - timeStart)
/
(timeEnd - timeStart)
× 100
```

---

## 9.3 101点正規化

ターゲット：

```javascript
[0, 1, 2, ..., 100]
```

元のtimeを0–100%へ変換した後、線形補間する。

---

## 9.4 線形補間

外部ライブラリを必須にせず、自作関数で実装可能。

概念：

```javascript
function linearInterpolate(x, y, targetX) {
  // xは昇順
  // targetXを挟む2点を検索
  // 線形補間して返す
}
```

式：

```text
y =
y1 +
(x - x1) ×
(y2 - y1) / (x2 - x1)
```

### 境界

0%および100%は必ず元IC1、IC2の値と一致させる。

---

## 10. 角度符号

Version 1.0ではOpenCap / OpenSim MOTに保存されている値を変更せずそのまま出力する。

つまり、

- hip_flexion
- knee_angle
- ankle_angle

の符号反転等は行わない。

将来的に臨床向け表示として、

```text
Flexion positive
Dorsiflexion positive
```

等へ統一する機能を追加する場合は、別設定として実装する。

---

## 11. グラフ仕様

Chart.jsを使用する。

### 11.1 Hip

```text
Title: Hip Flexion Angle
X: Gait Cycle (%)
Y: Angle (deg)
```

### 11.2 Knee

```text
Title: Knee Flexion Angle
X: Gait Cycle (%)
Y: Angle (deg)
```

### 11.3 Ankle

```text
Title: Ankle Angle
X: Gait Cycle (%)
Y: Angle (deg)
```

### 11.4 X軸

固定：

```text
min = 0
max = 100
```

1%刻みデータで描画する。

---

## 12. Excel生成仕様

ExcelJSを推奨する。

Workbook：

```javascript
const workbook = new ExcelJS.Workbook();
```

---

## 12.1 Graphs

3グラフをPNG化して貼り付ける。

```javascript
canvas.toDataURL("image/png");
```

ExcelJSへ画像登録：

```javascript
workbook.addImage(...)
```

推奨配置：

```text
Hip     上段
Knee    中段
Ankle   下段
```

---

## 12.2 Normalized_Data

列：

```text
A Gait cycle (%)
B Hip flexion (deg)
C Knee flexion (deg)
D Ankle angle (deg)
```

データ：

```text
2行目 = 0%
...
102行目 = 100%
```

---

## 12.3 Original_Data

列：

```text
A Sample
B Time (s)
C Gait cycle (%)
D Hip flexion (deg)
E Knee flexion (deg)
F Ankle angle (deg)
```

サンプル番号は0始まりではなく、人が確認しやすい1始まり表示を推奨する。

内部インデックスは0始まりのままとする。

---

## 12.4 Metadata

Key / Value形式：

```text
A: Parameter
B: Value
```

保存項目は要件定義書に準拠する。

---

## 13. ファイル名生成

入力：

```text
ZIP = イシイタカシ：GSD歩行.zip
MOT = gsdgait1.mot
Side = Right
```

拡張子除去：

```text
イシイタカシ：GSD歩行
gsdgait1
```

禁止文字置換：

```text
\ / : * ? " < > |
```

を `_` に置換する。

出力例：

```text
イシイタカシ_GSD歩行_gsdgait1_R.xlsx
```

---

## 14. 状態管理

最低限以下の状態を保持する。

```javascript
appState = {
  zipFile: null,
  zipInstance: null,
  trials: [],
  selectedTrial: null,
  motData: null,
  videoUrl: null,
  selectedSide: null,
  currentSampleIndex: 0,
  firstIC: null,
  secondIC: null,
  normalizedData: null
}
```

フレームワークを使用しない場合でも、状態を1箇所に集約する。

---

## 15. Object URL管理

ZIP内部のMP4 Blobは以下で表示する。

```javascript
const url = URL.createObjectURL(videoBlob);
video.src = url;
```

試行変更・ZIP変更時は必ず、

```javascript
URL.revokeObjectURL(oldUrl);
```

を実行しメモリリークを防止する。

---

## 16. 大容量ファイル対策

OpenCap ZIPは動画を含むため比較的大容量になる可能性がある。

Version 1.0では以下を実施する。

- ZIP全体をBase64化しない
- 必要なファイルのみBlob / textとして展開
- MOTは選択された試行のみ解析
- 動画も選択された試行のみBlob化
- 試行変更時に不要Blob URLを解放

必要に応じてロード中表示を行う。

---

## 17. エラーハンドリング

代表例：

### ZIPエラー

```text
ZIPファイルを読み込めませんでした。
OpenCapからダウンロードしたZIPファイルか確認してください。
```

### MOTなし

```text
OpenSimData/Kinematics 内にMOTファイルが見つかりません。
```

### 動画なし

```text
選択したMOTに対応するCam0同期動画が見つかりません。
動画なしでも解析は可能ですが、IC選択を動画で確認できません。
```

### 必要列なし

```text
解析に必要な列が見つかりません。
Missing: knee_angle_r
```

### IC異常

```text
2nd ICは1st ICより後の時点を選択してください。
```

---

## 18. GitHub Pages

### 18.1 Repository

例：

```text
opencap-gait-cycle-analyzer
```

### 18.2 Vite設定

GitHub Project Pagesの場合はrepository名に合わせて`base`を設定する。

例：

```javascript
export default defineConfig({
  base: '/opencap-gait-cycle-analyzer/'
})
```

ユーザー/Organization Pages直下の場合は `/` を使用する。

---

## 18.3 GitHub Actions

推奨：

GitHub Actionsを使用して、

```text
push to main
↓
npm install
↓
npm run build
↓
dist
↓
GitHub Pages deploy
```

を自動化する。

---

## 19. セキュリティ・個人情報

### 19.1 基本原則

解析対象データはブラウザ内のみで処理する。

以下を実装しない。

- 外部APIへのZIP送信
- 動画アップロード
- MOTアップロード
- 解析データの外部保存
- Analyticsへのファイル名送信

### 19.2 UI表示

アプリ内に以下の趣旨を表示する。

```text
選択したOpenCapデータは外部サーバーへ送信されません。
解析処理はお使いのブラウザ内で実行されます。
```

---

## 20. テスト要件

### 20.1 ZIP

- 正常なOpenCap ZIP
- ZIP以外
- 壊れたZIP
- Kinematicsなし
- MOTなし
- 動画なし

### 20.2 MOT

- Right列あり
- Left列あり
- 片側列不足
- time列なし
- 変則的な空白
- CRLF / LF

### 20.3 IC

- 正常
- 同一時刻
- IC2 < IC1
- 最初のsample
- 最後のsample

### 20.4 Normalization

確認事項：

- 出力が101点
- 0%がIC1と一致
- 100%がIC2と一致
- 線形データで補間値が理論値と一致
- NaNを生成しない

### 20.5 Excel

- 4シート存在
- 101点存在
- Original dataが指定区間と一致
- Metadata一致
- グラフ画像が表示される
- 日本語ファイル名でも保存可能

---

## 21. 開発フェーズ

### Phase 1

```text
ZIP upload
MOT detection
MOT parser
Trial selector
Side selector
```

### Phase 2

```text
Video extraction
Video display
MOT time synchronization
Step controls
```

### Phase 3

```text
IC1
IC2
Validation
```

### Phase 4

```text
Gait-cycle extraction
101-point normalization
```

### Phase 5

```text
Web chart
Excel export
Metadata
```

### Phase 6

```text
UI refinement
Error handling
GitHub Pages deployment
Testing
```

---

## 22. Claude Codeへの実装指示方針

最初から全機能を一度に生成させず、Phase単位で実装する。

推奨順：

1. プロジェクト構成作成
2. ZIP読み込み
3. MOT一覧表示
4. MOTパース
5. 動画自動紐付け
6. MOT timeによる動画移動
7. IC選択
8. 正規化
9. グラフ
10. Excel
11. GitHub Pages
12. テスト

各Phaseの完了時にブラウザで動作確認してから次へ進む。

---

## 23. 重要な実装上の判断

本アプリで最も重要なのは、

**「動画フレーム番号を解析基準にする」のではなく、「MOTのtimeを解析基準として動画をその時刻へ移動する」**

ことである。

これにより、

```text
IC選択
↓
MOT sample確定
↓
MOT time確定
↓
解析区間確定
```

という一貫した処理となり、101点正規化に直接利用できる。

動画はICを視覚的に判断するための同期表示として扱う。
