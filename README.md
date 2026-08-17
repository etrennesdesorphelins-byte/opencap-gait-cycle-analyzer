# OpenCap Gait Cycle Analyzer

OpenCapからダウンロードしたZIPファイルをブラウザ上で読み込み、対象試行・解析側・1歩行周期を選択し、
下肢関節角度（股関節屈曲・膝関節屈曲・足関節底背屈）を101点に時間正規化してExcel出力するWebアプリケーションです。

全処理はブラウザ内で完結し、ZIP・動画・MOTデータを外部サーバーへ送信しません。

詳細な仕様は以下を参照してください。

- [要件定義書](./docs/requirements.md)
- [技術要件書](./docs/technical_requirements.md)

## セットアップ

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

`dist/` に静的ファイルが生成されます。GitHub Pagesへ`main`ブランチへのpushで自動デプロイされます
（`.github/workflows/deploy.yml`）。

## 使い方

1. OpenCap出力のZIPファイルをドラッグ＆ドロップ、またはボタンで選択
2. 解析対象のMOTファイルと解析側（Right / Left）を選択
3. 同期動画とフレーム操作で1st IC・2nd ICを指定
4. 「解析実行」で1歩行周期を101点へ時間正規化
5. グラフを確認し、「Excelをダウンロード」で結果を出力
