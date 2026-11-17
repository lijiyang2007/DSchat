// Bundles the compaction module (and its deps) to a plain ESM file so the pure planner
// logic can be exercised without the app's build pipeline.
// Run with: node scripts/build-compaction-check.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const compiler = rspack({
  mode: 'development',
  devtool: false,
  target: 'node',
  entry: path.join(root, 'src/services/chat/compaction.ts'),
  output: {
    path: path.join(root, '.tmp-check'),
    filename: 'compaction.mjs',
    library: { type: 'module' },
  },
  experiments: { outputModule: true },
  resolve: {
    extensions: ['.ts', '.js'],
    // 源码以 TS 编写却用 ESM 的 .js 后缀引用，打包时映射回 .ts
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'builtin:swc-loader',
          options: {
            jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
          },
        },
        type: 'javascript/auto',
      },
    ],
  },
  externalsType: 'module',
  optimization: { minimize: false },
})

compiler.run((error, stats) => {
  if (error) {
    console.error(error)
    process.exit(1)
  }
  if (stats?.hasErrors()) {
    console.error(stats.toString({ errors: true, all: false }))
    process.exit(1)
  }
  console.log('bundled ->', path.join(root, '.tmp-check/compaction.mjs'))
  compiler.close(() => {})
})
