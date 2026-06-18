const WEB_APP_URL = '__APP_URL__'
const iframe = document.getElementById('synapse-frame')
const loading = document.getElementById('loading')
const error = document.getElementById('error')
let loaded = false

function showApp() {
  loading.style.display = 'none'
  error.style.display = 'none'
  iframe.style.display = 'block'
}

function showError() {
  if (loaded) return
  loading.style.display = 'none'
  iframe.style.display = 'none'
  error.style.display = 'flex'
}

iframe.addEventListener('load', () => {
  loaded = true
  showApp()
})

iframe.src = WEB_APP_URL

setTimeout(showError, 8000)
