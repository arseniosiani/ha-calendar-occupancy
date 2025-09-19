const { build } = require('esbuild')
const fs = require('fs-extra')
const { builtinModules } = require('node:module')

const externals = [
  'avsc',
  'thrift',
  'protobufjs/minimal',
  './build/Debug/iconv.node',
  '../build/Debug/iconv.node',
  'mongodb-client-encryption',
  './xhr-sync-worker.js',
  'canvas',
  'esbuild',
  'lightningcss',
  '@tailwindcss/oxide',
  'kafka-node',
  'deasync'
]

const start = async () => {
  await fs.rm('dist', { recursive: true, force: true })
  await fs.mkdir('dist')


  const build_opts = {
    entryPoints: ['./src/ha-calendar-occupancy.js'],
    bundle: true,
    minify: false,
    platform: 'browser',
    sourcemap: false,
    format: 'cjs',
    external: [...builtinModules, ...externals],
    outdir: './dist',
    // plugins: [bindingsPlugin, dirnamePlugin, markoPlugin, svgPlugin, punycode, processPlugin]
  }

  await build(build_opts)

}
start()
