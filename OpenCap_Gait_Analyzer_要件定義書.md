# OpenCap Gait Cycle Analyzer 要件定義書

## 1. 文書目的

本書は、OpenCapからダウンロードしたZIPファイルをブラウザ上で読み込み、対象試行・解析側・1歩行周期を選択し、下肢関節角度を101点に時間正規化してExcel出力するWebアプリケーションの要件を定義する。

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
```

動画が見つからない場合は解析自体は継続可能とするが、IC選択に動画を利用できない旨を表示する。

---

## 5.3 解析側の選択

### FR-007 左右選択

利用者は以下から解析対象側を選択できる。

- Right
- Left

初期値は未選択、またはRightとする。

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

## 5.5 IC選択

### FR-012 1回目IC設定

利用者が動画を確認し、現在位置を「1st IC」として登録できる。

保存する情報：

- MOTサンプル番号
- MOT time
- 動画時刻

### FR-013 2回目IC設定

同様に現在位置を「2nd IC」として登録できる。

### FR-014 IC表示

登録後、画面上に以下を表示する。

```text
1st IC: sample / time
2nd IC: sample / time
Gait cycle duration
```

### FR-015 IC再設定

1st IC、2nd ICは解析実行前であれば何度でも上書きできる。

### FR-016 入力チェック

解析実行には以下を必須とする。

- MOTファイル選択済み
- 解析側選択済み
- 1st IC選択済み
- 2nd IC選択済み
- `2nd IC > 1st IC`
- 必要な3関節変数が存在

---

## 5.6 解析処理

### FR-017 データ切り出し

1st ICから2nd ICまでのデータを1歩行周期として抽出する。

1st ICおよび2nd ICのデータ点を両方含める。

### FR-018 時間正規化

抽出された1歩行周期を以下の101点へ正規化する。

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

### FR-024 Sheet 2: Normalized_Data

以下の形式で101点データを保存する。

| Gait cycle (%) | Hip flexion | Knee flexion | Ankle angle |
|---:|---:|---:|---:|
| 0 | value | value | value |
| 1 | value | value | value |
| ... | ... | ... | ... |
| 100 | value | value | value |

### FR-025 Sheet 3: Original_Data

1st ICから2nd ICまでの正規化前データを保存する。

推奨列：

```text
Sample
Time
Gait cycle (%)
Hip flexion
Knee flexion
Ankle angle
```

### FR-026 Sheet 4: Metadata

再現性確保のため、以下を保存する。

```text
ZIP file name
MOT file name
Video file path
Analysis side
Hip variable
Knee variable
Ankle variable
1st IC sample
1st IC time
2nd IC sample
2nd IC time
Gait cycle duration
Original sample count
Normalization points
Interpolation method
Application version
Export date/time
```

---

## 5.9 出力ファイル名

### FR-027 命名規則

基本形式：

```text
[ZIPファイル名]_[MOTファイル名]_[Side].xlsx
```

例：

```text
イシイタカシ_GSD歩行_gsdgait1_R.xlsx
```

ファイル名として使用できない文字は自動的に置換または削除する。

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
  Side selection

Section 3
  Video

Section 4
  Time / sample control
  -10
  -1
  +1
  +10
  slider

Section 5
  Set 1st IC
  Set 2nd IC

Section 6
  Selected IC information

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
- OpenSimの再計算
- kineticデータ解析
- 複数カメラ同時表示
- サーバー側解析

---

## 9. 完了条件

Version 1.0は以下を満たした時点で完成とする。

1. OpenCap ZIPをブラウザで読み込める
2. Kinematics内のMOTを自動検出できる
3. MOTを選択できる
4. Right / Leftを選択できる
5. 対応するCam0同期動画を自動表示できる
6. MOTのtimeに連動して動画位置を移動できる
7. 1st IC / 2nd ICを指定できる
8. 指定区間を101点に正規化できる
9. Hip / Knee / Ankle角度を処理できる
10. グラフを確認できる
11. 4シート構成のExcelを出力できる
12. GitHub Pages上で動作する
13. データが外部サーバーへ送信されない
