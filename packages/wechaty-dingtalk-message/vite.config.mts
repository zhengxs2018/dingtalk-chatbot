import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';
import dts from 'vite-plugin-dts';
import { viteStaticCopy as copy } from 'vite-plugin-static-copy'
import { externalizeDeps as external } from 'vite-plugin-externalize-deps';

import pkg from './package.json';

export default defineConfig((api) => {
  return {
    appType: 'custom',
    plugins: [
      external(),
      checker({
        typescript: true,
      }),
      dts(),
      dts({
        beforeWriteFile(filePath, content) {
          return {
            filePath: filePath.replace(/\.d\.ts$/, '.d.mts'),
            content,
          };
        },
      }),
      copy({
        targets: [
          { src: 'src', dest: '' },
          { src: 'README.md', dest: '' },
          { src: 'package.json', dest: '' },
        ],
      }),
    ],
    define: {
      __PKG_NAME__: JSON.stringify(pkg.name),
      __PKG_VERSION__: JSON.stringify(pkg.version),
    },
    esbuild: {
      // wechaty 的 UrlLink 内部会检查 class 的名字
      // 所以这里需要保留
      keepNames: true,
      minifyIdentifiers: false,
    },
    build: {
      target: 'esnext',
      sourcemap: false,
      copyPublicDir: false,
      emptyOutDir: api.mode === 'production',
      lib: {
        entry: ['src/index.ts'],
        formats: ['es', 'cjs']
      },
      rollupOptions: {
        output: {
          exports: 'named',
          // See https://github.com/vitejs/vite/issues/5174
          preserveModules: true,
        },
      },
    },
  }
});
