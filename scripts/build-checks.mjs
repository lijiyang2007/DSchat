// 把纯逻辑模块打包成 ESM，供 scripts/check-*.mjs 直接运行
// 运行：node scripts/build-checks.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entries = {
  compaction: 'src/services/chat/compaction.ts',
  title: 'src/services/chat/title.ts',
  sessionSearch: 'src/services/chat/sessionSearch.ts',
  origin: 'src/services/api/origin.ts',
  vision: 'src/services/vision.ts',
  imageNormalize: 'src/services/imageNormalize.ts',
  welcome: 'src/services/chat/welcome.ts',
  sessionSort: 'src/components/sider/sessionSortState.ts',
}

const build = (name, entryFile) =>
  new Promise((resolve, reject) => {
    const compiler = rspack({
      mode: 'development',
      devtool: false,
      target: 'node',
      entry: path.join(root, entryFile),
      output: {
        path: path.join(root, '.tmp-check'),
        filename: `${name}.mjs`,
        library: { type: 'module' },
      },
      experiments: { outputModule: true },
      resolve: {
        extensions: ['.ts', '.js'],
        // 源码用 ESM 的 .js 后缀引用 TS 文件，打包时映射回 .ts
        extensionAlias: { '.js': ['.ts', '.js'] },
      },
      module: {
        rules: [
          {
            test: /\.ts$/,
            use: {
              loader: 'builtin:swc-loader',
              options: { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } },
            },
            type: 'javascript/auto',
          },
        ],
      },
      externalsType: 'module',
      optimization: { minimize: false },
      plugins: [
        // origin.ts 依赖构建期注入的常量
        new rspack.DefinePlugin({
          __API_ORIGIN__: JSON.stringify('https://api.deepseek.com'),
          __DEV_PROXY__: JSON.stringify(false),
        }),
      ],
    })
    compiler.run((error, stats) => {
      if (error) return reject(error)
      if (stats?.hasErrors()) {
        return reject(new Error(stats.toString({ errors: true, all: false })))
      }
      compiler.close(() => resolve())
    })
  })

for (const [name, entry] of Object.entries(entries)) {
  await build(name, entry)
  console.log(`bundled ${name} -> .tmp-check/${name}.mjs`)
}
