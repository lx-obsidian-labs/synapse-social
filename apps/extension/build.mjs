import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, cpSync, mkdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_URL = process.env.APP_URL || 'http://localhost:3000'
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
  return content.replace(/__APP_URL__/g, APP_URL)
}

async function copyAssets() {
  const distDir = resolve(__dirname, 'dist')
  const publicDir = resolve(__dirname, 'public')
  const srcDir = resolve(__dirname, 'src')

  if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })

  const manifestSrc = readFileSync(resolve(__dirname, 'manifest.json'), 'utf-8')
  writeFileSync(resolve(distDir, 'manifest.json'), replacePlaceholder(manifestSrc))

  if (existsSync(publicDir)) {
    cpSync(publicDir, distDir, { recursive: true })
  }

  const htmlFiles = ['sidepanel.html', 'popup.html']
  for (const file of htmlFiles) {
    const srcPath = resolve(srcDir, file)
    if (existsSync(srcPath)) {
      let content = readFileSync(srcPath, 'utf-8')
      content = replacePlaceholder(content)
      writeFileSync(resolve(distDir, file), content)
    }
  }
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
