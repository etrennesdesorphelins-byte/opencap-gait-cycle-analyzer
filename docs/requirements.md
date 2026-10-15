# OpenCap Gait Cycle Analyzer 要件定義書

## 1. 文書目的

本書は、OpenCapからダウンロードしたZIPファイルをブラウザ上で読み込み、対象試行を選択して左右のIC・Toe Offを設定し、左右の全歩行周期の下肢関節角度を101点に時間正規化（平均±SD）してExcel出力するWebアプリケーションの要件を定義する。

本アプリケーションは、GitHub上でソースコードを公開し、GitHub Pages等を用いて、利用者が専用ソフトウェアをインストールせずWebブラウザのみで使用できることを目標とする。

---

## 2. アプリケーション概要

### 2.1 仮称

**OpenCap Gait Cycle Analyzer**

### 2.2 主な用途

OpenCapで計測した歩行データについて、以下を簡便に実施する。

1. OpenCap ZIPファイルの読み込み
2. Kinematicsフォルダ内のMOTファイル選択
3. 右下肢または左下肢の選択
4. 同期動画を確認しながら1回目IC・2回目ICを指定
5. 指定された1歩行周期を0–100%の101点へ時間正規化
6. 股関節屈曲角度、膝関節屈曲角度、足関節底背屈角度を抽出
7. グラフおよび数値データをExcel形式で出力

### 2.3 想定利用者

- 理学療法士
- 医療・リハビリテーション分野の研究者
- 大学生・大学院生
- OpenCapを用いた歩行解析を行う者

---

## 3. 利用環境

### 3.1 基本方針

- HTML / CSS / JavaScriptで構成する
- サーバー側処理を必須としない
- 原則として全処理を利用者のブラウザ内で完結させる
- GitHub Pagesで公開可能な静的Webアプリケーションとする
- ZIPファイルや動画、MOTデータを外部サーバーへ送信しない

### 3.2 推奨ブラウザ

初期版では以下を主要対象とする。

- Google Chrome 最新版
- Microsoft Edge 最新版

Safari、Firefoxは可能な範囲で対応するが、初期版の必須対応とはしない。

---

## 4. 想定するOpenCap ZIP構造

本アプリは、原則として以下のOpenCap出力構造を対象とする。

```text
[OpenCap ZIP]
├─ OpenSimData
│  └─ Kinematics
│     ├─ trial1.mot
│     ├─ trial2.mot
│     └─ ...
└─ Videos
   └─ Cam0
      └─ InputMedia
         ├─ trial1
         │  └─ trial1_sync.mp4
         ├─ trial2
         │  └─ trial2_sync.mp4
         └─ ...
```

MOTファイル名を `trial1.mot` とした場合、対応動画は次のパスから自動探索する。

```text
Videos/Cam0/InputMedia/trial1/trial1_sync.mp4
```

大文字・小文字や一部フォルダ表記の差異については可能な範囲で吸収する。

---

## 5. 機能要件

## 5.1 ZIPファイル読み込み

### FR-001 ZIP選択

利用者は以下のいずれかでZIPファイルを読み込める。

- ファイル選択ボタン
- ドラッグ＆ドロップ

### FR-002 ZIP内容確認

ZIP読み込み後、アプリは自動的に以下を検索する。

```text
OpenSimData/Kinematics/*.mot
```

検出したMOTファイルを一覧化する。

### FR-003 エラー表示

以下の場合は利用者へ明確なメッセージを表示する。

- ZIP形式でない
- ZIPが破損している
- `OpenSimData/Kinematics` が存在しない
- MOTファイルが存在しない

---

## 5.2 MOTファイル選択

### FR-004 試行選択

検出されたMOTファイルをプルダウン等で一覧表示し、解析対象を1つ選択できる。

### FR-005 MOT解析

選択したMOTファイルを読み込み、以下を取得する。

- ヘッダー情報
- `time` 列
- 全変数名
- 全時系列データ

### FR-006 対応動画の自動探索

MOTファイルのベース名から対応する同期動画を自動探索する。

例：

```text
MOT:
gsdgait1.mot

Video:
Videos/Cam0/InputMedia/gsdgait1/gsdgait1_sync.mp4
Videos/Cam1/InputMedia/gsdgait1/gsdgait1_sync.mp4
...
```

`Videos/Cam{N}/` 配下の同期動画を全カメラ分検出する。

動画が見つからない場合は解析自体は継続可能とするが、IC選択に動画を利用できない旨を表示する。

### FR-006a 表示動画の選択・同時表示

検出したカメラをチェックボックスで一覧表示し、利用者は表示する動画を選択できる。

- 初期状態は先頭のカメラ（通常Cam0）のみ表示する
- 複数選択した場合は並べて同時に表示し、全動画を同じMOT時刻へシークする
- 先頭に表示された動画を基準動画とし、Video Time表示・IC記録の動画時刻に用いる
- いずれかの動画をネイティブコントロールで再生/一時停止すると、他の動画も追従する
- 拡大/縮小は動画ごとに個別に操作できる
- 試行を切り替えた場合、同じカメラが存在すれば選択を引き継ぐ
- 動画は選択されたカメラ分のみZIPから展開する

---

## 5.3 解析側

### FR-007 左右の解析（v1.1で変更）

解析側の選択は廃止し、左右両方を同時に解析する。

- 同側ICが2回以上設定された側を解析対象とする
- 左右とも周期があれば、1つの結果・1つのExcelに左右をまとめて出力する
- 一方の側の必要変数がMOTに存在しない場合、その側のみ解析対象外として警告し、もう一方の側は解析する

### FR-008 対象変数の自動決定

Rightの場合：

```text
hip_flexion_r
knee_angle_r
ankle_angle_r
```

Leftの場合：

```text
hip_flexion_l
knee_angle_l
ankle_angle_l
```

上記変数がMOT内に存在しない場合は解析を実行せず、不足している変数名を表示する。

---

## 5.4 動画表示

### FR-009 動画プレイヤー

対応する `_sync.mp4` をブラウザ上に表示する。

以下を利用可能とする。

- 再生
- 一時停止
- シーク
- 現在時刻表示

### FR-010 IC確認用フレーム操作

動画下部にIC選択専用の操作機能を設ける。

最低限以下を搭載する。

- 1ステップ戻る
- 1ステップ進む
- 10ステップ戻る
- 10ステップ進む
- タイムスライダー

ここでいう1ステップは、選択したMOTファイルの隣接する `time` 行への移動を意味する。

これにより、動画のフレームレートに依存せずMOT時刻を基準としてIC候補位置を移動できるようにする。

### FR-011 現在位置情報

IC選択画面に以下を常時表示する。

- MOTデータ行番号
- 現在のMOT time
- 動画の現在時刻
- 総データ点数

表示例：

```text
Sample: 105 / 292
MOT Time: 1.7500 s
Video Time: 1.7500 s
```

可能な場合は動画フレーム番号も参考値として表示する。

---

## 5.5 歩行イベント設定（v1.1で変更）

### FR-012 歩行イベントの登録

利用者が動画を確認し、現在位置を以下のいずれかのイベントとして登録できる。

- Right IC（Initial Contact）
- Right Toe Off
- Left IC
- Left Toe Off

各イベントは何回でも登録できる。入力順は問わず、時刻順に並べて管理する。
同じ側・種類・サンプルへの重複登録は警告して無視する。

保存する情報：

- 側（Right / Left）
- 種類（IC / Toe Off）
- MOTサンプル番号
- MOT time
- 動画時刻（基準動画）

### FR-013 歩行周期の構成

同側の連続するIC間（IC → 次の同側IC）を1歩行周期とする。

各周期について以下を求める（時刻ベース、周期の開始IC = 0%、次IC = 100%）。

- 周期時間 (s)
- 立脚期 (%)：周期内の最初の同側Toe Offの位置。未設定の場合は空欄
- 遊脚期 (%)：100 − 立脚期
- 対側Toe Off (%)、対側IC (%)：周期内に登録されていれば付与（両脚支持期の確認用）

周期時間が他周期の中央値の1.5倍を超える周期は、間のICの登録漏れの可能性として強調表示する。

### FR-014 イベント・周期の表示

- 登録済みイベントを一覧表示し、各イベントへの移動・削除ができる
- 現在位置にあるイベントの行を強調表示する
- スライダー下に各イベントの位置を目印として表示する（Right: 赤、Left: 青）
- 構成された歩行周期を一覧表示する

### FR-015 イベントの保持・再設定

- イベントは個別削除・全削除ができる
- 試行（MOT）ごとに保持し、試行を切り替えて戻っても設定内容を維持する（新しいZIPを読み込むと破棄）
- イベントを変更した場合、以前の解析結果は無効として非表示にする

### FR-016 入力チェック

解析実行には以下を必須とする。

- MOTファイル選択済み
- 少なくとも一方の側で歩行周期が1つ以上ある（同側ICが2回以上）
- 解析対象側の3関節変数が存在

---

## 5.6 解析処理

### FR-017 データ切り出し

左右それぞれ、全歩行周期（IC → 次の同側IC）のデータを抽出する。

周期の開始ICおよび終了ICのデータ点を両方含める。

### FR-018 時間正規化

抽出された各歩行周期をそれぞれ以下の101点へ正規化する。
さらに側ごとに、各点の周期間の平均と標準偏差（標本SD、n−1）を求める。1周期のみの場合SDは空欄とする。

```text
0%, 1%, 2%, ... , 99%, 100%
```

### FR-019 補間

初期版は線形補間を使用する。

対象：

- Hip flexion angle
- Knee flexion angle
- Ankle angle

補間は、単純なサンプル番号ではなく元MOTの `time` を基準に実施する。

### FR-020 対象角度

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

---

## 5.7 解析結果の画面表示

### FR-021 グラフプレビュー

解析後、Web画面上でも以下3グラフを確認できることが望ましい。

1. Hip flexion angle
2. Knee flexion angle
3. Ankle angle

共通設定：

- 横軸：Gait cycle (%)
- 横軸範囲：0–100
- 縦軸：Joint angle (deg)
- 左右を同じグラフに重ねる（Right: 赤、Left: 青）
- 太線：平均、帯：±SD、細線：各周期、破線：平均Toe Off位置

グラフの上に、側ごとの周期数・周期時間・立脚期%（平均±SD）を表示する。

---

## 5.8 Excel出力

### FR-022 Excel生成

解析結果を `.xlsx` 形式で生成し、利用者がダウンロードできる。

### FR-023 Sheet 1: Graphs

以下3グラフを配置する。

1. Hip flexion angle
2. Knee flexion angle
3. Ankle angle

各グラフ：

```text
X axis: Gait cycle (%)
Y axis: Joint angle (deg)
```

### FR-024 Sheet 2: Gait_Events（v1.1）

登録した全イベントを時刻順に保存する。

```text
Side / Event / MOT sample / MOT time (s) / Video time (s)
```

### FR-024a Sheet 3: Cycles（v1.1）

周期ごとの時間パラメータと、側ごとの平均・SD行を保存する。

```text
Side / Cycle / IC sample / IC time / Next IC sample / Next IC time / Cycle duration
Toe Off sample / Toe Off time / Stance (%) / Swing (%) / Opposite Toe Off (%) / Opposite IC (%)
```

### FR-024b Sheet 4: Normalized_Data

101点データを保存する。1列目は Gait cycle (%)。続いて側ごとに各関節の平均・SD、その後に各周期の値を並べる。

```text
R Hip flexion mean / R Hip flexion SD / ... / L Ankle angle SD
R C1 Hip flexion / R C1 Knee flexion / R C1 Ankle angle / R C2 ... / L C1 ...
```

### FR-025 Sheet 5: Original_Data

各周期の正規化前データを縦持ちで保存する。

```text
Side / Cycle / MOT sample / Time / Gait cycle (%) / Hip flexion / Knee flexion / Ankle angle
```

### FR-026 Sheet 6: Metadata

再現性確保のため、以下を保存する。

```text
ZIP file name
MOT file name
Video file path
Analyzed sides
Gait cycle definition
Number of events
Normalization points
Interpolation method
SD definition
Application version
Export date/time
Right / Left variables
Right / Left cycles
```

### FR-026a Sheet 7: Normalized_All_Data

MOTの全変数を周期ごとに101点正規化し、縦持ちで保存する（Side / Cycle / Gait cycle (%) / 全変数）。

---

## 5.9 出力ファイル名

### FR-027 命名規則

基本形式（v1.1で左右をまとめて出力するため Side を省略）：

```text
[ZIPファイル名]_[MOTファイル名].xlsx
```

例：

```text
イシイタカシ_GSD歩行_gsdgait1.xlsx
```

ファイル名として使用できない文字は自動的に置換または削除する。

---

## 5.10 身体重心（v1.2で追加）

### FR-028 身体重心の算出

ZIP内のスケーリング済みOpenSimモデル（`OpenSimData/Model/*.osim`、単眼セッションでは `OpenSimData/Model/{trial}/*.osim`）と
MOTの関節座標から、ブラウザ上で順運動学を計算し、全体節の質量加重平均として身体重心を求める
（OpenSim の `Model::calcMassCenterPosition` と同じ定義）。

- 対応ジョイント：CustomJoint、PinJoint、WeldJoint（ほか Slider / Universal / Gimbal / Ball / Free）
- 対応関数：Constant、LinearFunction、PolynomialFunction、MultiplierFunction、SimmSpline
- 膝蓋骨などの従属座標は CoordinateCouplerConstraint から求める
- MOTにない座標はモデルの既定値を使う
- 速度は位置の中心差分で求める（追加のフィルタ処理は行わない）
- モデルが見つからない・読み込めない場合は身体重心のみ算出せず、関節角度の解析は継続する

### FR-029 身体重心の座標系

- 鉛直：OpenSim地面座標系の y（上が正）
- 前後(AP)：周期ごとに、開始IC→次ICの水平COM変位の向き
- 左右(ML)：AP × 鉛直（右が正）
- 水平変位が5 cm未満の周期（足踏み等）は進行方向を決められないため、地面座標系の x を前後とみなし、参考値として扱う

### FR-030 身体重心の出力

周期ごとに101点正規化し、側ごとに平均±SDを求める。

- 時系列：鉛直位置・左右位置（地面座標系の原点基準, m。左右は原点からの水平位置を左右軸へ投影）、鉛直変位・左右変位（各周期の平均位置基準, cm）、前後変位（周期開始基準, cm）、鉛直速度・前後速度（m/s）、地面座標系の絶対位置（m）
- 周期ごとの指標：鉛直変位幅・左右変位幅（cm）、歩行速度（m/s, 周期内の水平変位 ÷ 周期時間）
- 画面：鉛直位置・左右位置（原点基準, m）のグラフ、側ごとの指標（平均±SD）
- Excel：Cycles シートに指標列、Graphs シートにグラフ、Sheet 8 `COM_Normalized` に時系列、Metadata にモデルファイル・総質量・算出方法

### 検証（v1.2）

実データ（LaiUhlrich2022_scaled.osim, 3試行）で、モデルマーカーの順運動学位置とIKに用いられた実測マーカー（*_study）の
差は RMS 17.6〜20.0 mm（下肢 7〜10 mm）であった。CustomJoint の回転を空間固定として誤って計算した場合は RMS 104 mm となり、
回転規約（物体固定・rotation1→2→3）の正しさを確認した。モデル総質量はセッション情報の体重と一致した。

---

## 6. UI要件

## 6.1 基本画面

推奨構成：

```text
Header
  OpenCap Gait Cycle Analyzer

Section 1
  ZIP upload

Section 2
  Trial selection

Section 3
  Camera selection
  Video (multiple, synchronized)

Section 4
  Time / sample control
  -10
  -1
  +1
  +10
  slider (with event marks)

Section 5
  R IC / R Toe Off / L IC / L Toe Off

Section 6
  Event list (jump / delete)
  Gait cycle list

Section 7
  Analyze button

Section 8
  Result preview

Section 9
  Download Excel
```

---

## 6.2 操作性

- 解析手順が上から下へ自然に進むこと
- 未完了の項目が分かること
- 解析可能になるまで「解析実行」ボタンを無効化すること
- エラーは可能な限り具体的に表示すること
- 研究者だけでなく学生でも直感的に使用できること

---

## 7. 非機能要件

### NFR-001 プライバシー

ZIP、動画、MOTデータは外部サーバーへアップロードしない。

すべてローカルブラウザ内で処理する。

### NFR-002 インストール不要

利用者側でPython、OpenSim等のインストールを不要とする。

### NFR-003 GitHub Pages対応

静的ファイルとしてビルド・公開可能な構成とする。

### NFR-004 再現性

Excel Metadataに解析条件を保存する。

### NFR-005 保守性

以下の処理をモジュール分離する。

- ZIP処理
- MOTパーサー
- 動画処理
- IC管理
- 正規化
- グラフ
- Excel出力

### NFR-006 拡張性

将来的に以下を追加できる構造とする。

- 複数歩行周期の一括解析
- 平均波形・SD算出
- 左右同時解析
- pelvis / hip adduction / rotation等の追加
- GRF解析
- 自動IC候補検出
- CSV出力
- 複数MOT一括Excel出力

---

## 8. 初期版で実装しない項目

以下はVersion 1.0の必須要件には含めない。

- ユーザー登録
- クラウド保存
- データベース
- 自動IC検出
- AIによる歩行イベント判定
- OpenSimの再計算（IK等。身体重心の算出に必要な順運動学のみブラウザで実装）
- kineticデータ解析
- サーバー側解析

---

## 9. 完了条件

Version 1.0は以下を満たした時点で完成とする。

1. OpenCap ZIPをブラウザで読み込める
2. Kinematics内のMOTを自動検出できる
3. MOTを選択できる
4. 左右を同時に解析できる
5. 対応する同期動画を自動表示でき、表示するカメラを選択・複数同時表示できる
6. MOTのtimeに連動して動画位置を移動できる
7. 左右のIC / Toe Offを複数回指定できる
8. 指定区間を101点に正規化できる
9. Hip / Knee / Ankle角度を処理できる
10. グラフを確認できる
11. 7シート構成のExcelを出力できる
12. GitHub Pages上で動作する
13. データが外部サーバーへ送信されない
