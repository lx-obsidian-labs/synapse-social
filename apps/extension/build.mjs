import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, cpSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.APP_URL || 'http://localhost:3000'
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || ''
const isWatch = process.argv.includes('--watch')

async function build() {
  const config = {
    entryPoints: [
      resolve(__dirname, 'src/background.ts'),
      resolve(__dirname, 'src/content.ts'),
    ],
    bundle: true,
    outdir: resolve(__dirname, 'dist'),
    platform: 'browser',
    target: 'chrome100',
    format: 'esm',
    sourcemap: false,
    minify: !isWatch,
    outbase: resolve(__dirname, 'src'),
  }

  if (isWatch) {
    const ctx = await esbuild.context(config)
    await ctx.watch()
    console.log('Watching for changes...')
  } else {
    await esbuild.build(config)
    await copyAssets()
    console.log('Extension built successfully → dist/')
  }
}

function replacePlaceholder(content) {
  return content
    .replace(/__APP_URL__/g, APP_URL)
    .replace(/__NVIDIA_API_KEY__/g, NVIDIA_API_KEY)
}

function replaceAndWrite(srcPath, destPath) {
  const content = readFileSync(srcPath, 'utf-8')
  writeFileSync(destPath, replacePlaceholder(content))
}

async function copyAssets() {
  const distDir = resolve(__dirname, 'dist')
  const publicDir = resolve(__dirname, 'public')
  const srcDir = resolve(__dirname, 'src')

  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

  replaceAndWrite(resolve(__dirname, 'manifest.json'), resolve(distDir, 'manifest.json'))

  if (existsSync(publicDir)) {
    cpSync(publicDir, distDir, { recursive: true })
  }

  const assetsWithPlaceholders = ['sidepanel.html', 'popup.html', 'sidepanel.js']
  for (const file of assetsWithPlaceholders) {
    const srcPath = resolve(srcDir, file)
    if (existsSync(srcPath)) {
      replaceAndWrite(srcPath, resolve(distDir, file))
    }
  }

  // Replace placeholders in esbuild bundled output
  const bundledFiles = ['background.js', 'content.js']
  for (const file of bundledFiles) {
    const distPath = resolve(distDir, file)
    if (existsSync(distPath)) {
      replaceAndWrite(distPath, distPath)
    }
  }
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
