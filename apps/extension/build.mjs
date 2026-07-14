import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, cpSync, mkdirSync, existsSync } from 'fs'
import vm from 'vm'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env (if present) so NVIDIA_API_KEY / APP_URL can be supplied without
// exporting them in the shell. Values already in process.env win.
try {
  const envPath = resolve(__dirname, '..', '..', '.env')
  if (existsSync(envPath)) {
    const envText = readFileSync(envPath, 'utf-8')
    for (const rawLine of envText.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (!(key in process.env)) process.env[key] = val
    }
  }
} catch { /* ignore missing/unreadable .env */ }

const APP_URL = process.env.APP_URL || 'http://localhost:3000'
const SUPABASE_PROXY_URL = process.env.SUPABASE_PROXY_URL || ''
// For public distribution set SUPABASE_PROXY_URL so no secret is shipped inside
// the extension. When a proxy URL is present the raw NVIDIA key is NEVER baked
// in, even if it exists in .env — the proxy holds it server-side instead.
const NVIDIA_API_KEY = SUPABASE_PROXY_URL ? '' : (process.env.NVIDIA_API_KEY || '')
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
    format: 'iife',
    sourcemap: false,
    minify: false,
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
    .replace(/__SUPABASE_PROXY_URL__/g, SUPABASE_PROXY_URL)
}

function replaceAndWrite(srcPath, destPath) {
  const content = readFileSync(srcPath, 'utf-8')
  writeFileSync(destPath, replacePlaceholder(content))
}

// sidepanel.js is copied as raw source and never parsed by esbuild, so a
// syntax error there (e.g. an unterminated template literal) would slip
// through a "successful" build and break the extension at load time.
function checkJsSyntax(filePath) {
  try {
    new vm.Script(readFileSync(filePath, 'utf-8'), { filename: filePath })
  } catch (err) {
    throw new Error(`Syntax error in ${filePath}: ${err.message}`)
  }
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

  // Validate the raw (non-esbuild) JS file so syntax errors fail the build
  const rawJs = [resolve(distDir, 'sidepanel.js')]
  for (const jsPath of rawJs) {
    if (existsSync(jsPath)) checkJsSyntax(jsPath)
  }
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
