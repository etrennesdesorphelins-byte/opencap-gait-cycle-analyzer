import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Project Pages で公開する場合は base をリポジトリ名に合わせて変更する。
// 例: base: '/opencap-gait-cycle-analyzer/'
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      // アプリ本体と使い方ページの2ページ構成
      input: {
        main: resolve(__dirname, 'index.html'),
        usage: resolve(__dirname, 'usage.html'),
      },
    },
  },
});
