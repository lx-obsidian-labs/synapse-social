// --- State ---

let chatHistory = []
let isGenerating = false

// --- DOM refs ---

const $ = (id) => document.getElementById(id)
const chatMessages = $('chat-messages')
const chatInput = $('chat-input')
const chatSend = $('chat-send')
const suggestions = $('suggestions')
const generatePrompt = $('generate-prompt')
const generateBtn = $('generate-btn')
const generateResult = $('generate-result')
const copyBtn = $('copy-btn')
const charCount = $('char-count')
const pageTypeLabel = $('page-type-label')
const pageTypePill = $('page-type-pill')
const pageDataName = $('page-data-name')

// --- Tab switching ---

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'))
    tab.classList.add('active')
    $(`tab-${tab.dataset.tab}`).classList.add('active')
  })
})

// --- Character count ---

generatePrompt.addEventListener('input', () => {
  charCount.textContent = generatePrompt.value.length
})

// --- Suggestion chips (chat) ---

suggestions.addEventListener('click', (e) => {
  const chip = e.target.closest('.suggestion-chip')
  if (!chip) return
  chatInput.value = chip.dataset.prompt
  chatInput.focus()
})

// --- Chat send ---

chatSend.addEventListener('click', sendChatMessage)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendChatMessage()
  }
})

async function sendChatMessage() {
  const text = chatInput.value.trim()
  if (!text || isGenerating) return

  chatInput.value = ''
  isGenerating = true
  chatSend.disabled = true

  addMessage('user', text)
  showTyping()
  scrollToBottom()

  try {
    const response = await sendToBackground('AI_CHAT', {
      messages: [...chatHistory, { role: 'user', content: text }],
    })
    removeTyping()
    if (response.success) {
      const processed = await processToolCalls(response.content)
      addMessage('assistant', processed.display)
      chatHistory.push({ role: 'user', content: text }, { role: 'assistant', content: processed.historyContent })
    } else {
      addMessage('assistant', 'Error: ' + (response.error || 'Failed to get response'))
    }
  } catch (err) {
    removeTyping()
    addMessage('assistant', 'Error: Could not reach the AI service')
  }

  isGenerating = false
  chatSend.disabled = false
  scrollToBottom()
}

async function processToolCalls(content) {
  const toolCallRegex = /\[TOOL:\s*(\w+)\s*(?::\s*(.*?))?\]/g
  let match
  let display = content
  let historyContent = content
  let hasToolCalls = false

  while ((match = toolCallRegex.exec(content)) !== null) {
    hasToolCalls = true
    const toolName = match[1]
    const argsStr = match[2] ? match[2].split('|').map(s => s.trim()) : []

    addMessage('assistant', `🔧 Executing: ${toolName}...`)
    scrollToBottom()

    const result = await sendToBackground('TOOL_EXECUTE', { tool: toolName, args: argsStr })

    const resultText = result.success
      ? `✅ ${result.result || 'Done'}`
      : `❌ ${result.error || 'Failed'}`

    display = display.replace(match[0], `**${resultText}**`)
    historyContent = historyContent.replace(match[0], `[Executed ${toolName}: ${result.success ? 'Success' : 'Failed'}]`)
  }

  if (hasToolCalls) {
    addMessage('assistant', '✅ Tool execution complete')
    scrollToBottom()
  }

  return { display, historyContent }
}

function addMessage(role, content) {
  const msg = document.createElement('div')
  msg.className = `msg ${role}`
  const avatar = role === 'assistant' ? 'S' : 'You'
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  msg.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div>
      <div class="msg-bubble">${escapeHtml(content)}</div>
      <div class="msg-time">${time}</div>
    </div>
  `
  chatMessages.appendChild(msg)
}

function showTyping() {
  const div = document.createElement('div')
  div.className = 'typing-indicator'
  div.id = 'typing-indicator'
  div.innerHTML = '<span></span><span></span><span></span>'
  chatMessages.appendChild(div)
}

function removeTyping() {
  const el = $('typing-indicator')
  if (el) el.remove()
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight
}

// --- Generate ---

generateBtn.addEventListener('click', generateContent)
generatePrompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.shiftKey) return
  if (e.key === 'Enter') {
    e.preventDefault()
    generateContent()
  }
})

// Template chips (generate)
$('templates').addEventListener('click', (e) => {
  const btn = e.target.closest('button')
  if (!btn) return
  generatePrompt.value = btn.dataset.prompt
  charCount.textContent = generatePrompt.value.length
  generatePrompt.focus()
})

async function generateContent() {
  const prompt = generatePrompt.value.trim()
  if (!prompt || isGenerating) return

  isGenerating = true
  generateBtn.textContent = '⏳ Generating...'
  generateBtn.disabled = true
  generateResult.classList.remove('visible')
  copyBtn.style.display = 'none'

  try {
    const response = await sendToBackground('AI_GENERATE', { prompt })
    if (response.success) {
      generateResult.textContent = response.content
      generateResult.classList.add('visible')
      copyBtn.style.display = 'inline-block'
    } else {
      generateResult.textContent = 'Error: ' + (response.error || 'Generation failed')
      generateResult.classList.add('visible')
    }
  } catch (err) {
    generateResult.textContent = 'Error: Could not reach the AI service'
    generateResult.classList.add('visible')
  }

  isGenerating = false
  generateBtn.textContent = '✨ Generate'
  generateBtn.disabled = false
}

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(generateResult.textContent)
  copyBtn.textContent = '✅ Copied!'
  setTimeout(() => { copyBtn.textContent = '📋 Copy' }, 2000)
})

// --- Background messaging ---

function sendToBackground(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message })
      } else {
        resolve(response || { success: false, error: 'No response' })
      }
    })
  })
}

// --- Page data ---

function updatePageData(data) {
  const pageTypeLabels = {
    page: 'Facebook Page', post: 'Post', inbox: 'Inbox',
    insights: 'Insights', group: 'Group', unknown: 'Facebook',
  }
  pageTypeLabel.textContent = pageTypeLabels[data.pageType] || 'Facebook'
  pageTypePill.textContent = pageTypeLabels[data.pageType] || 'Facebook'
  pageTypePill.className = 'pill ' + (data.pageType || 'unknown')
  pageDataName.textContent = data.pageName || data.pageTitle || '—'
}

// Listen for page data from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'PAGE_DATA_RESPONSE' && message.payload) {
    updatePageData(message.payload)
  }
})

// Request initial page data
function requestPageData() {
  chrome.runtime.sendMessage({ type: 'EXTRACT_PAGE_DATA' }, (response) => {
    if (response?.success && response.data) {
      updatePageData(response.data)
    }
  })
}

// --- Utility ---

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// --- Tool buttons (Tools tab) ---

const toolResult = $('tool-result')

document.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const tool = btn.dataset.tool
    toolResult.style.display = 'block'
    toolResult.textContent = `⏳ Running ${tool}...`
    const args = tool === 'highlight_elements' ? ['[role="article"], article'] : []
    const result = await sendToBackground('TOOL_EXECUTE', { tool, args })
    toolResult.textContent = result.success
      ? `✅ ${result.result || 'Done'}`
      : `❌ ${result.error || 'Failed'}`
  })
})

$('tool-click-el').addEventListener('click', async () => {
  const selector = $('tool-selector').value.trim()
  if (!selector) return
  toolResult.style.display = 'block'
  toolResult.textContent = '⏳ Clicking...'
  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'click_element', args: [selector] })
  toolResult.textContent = result.success ? `✅ ${result.result}` : `❌ ${result.error}`
})

$('tool-fill-btn').addEventListener('click', async () => {
  const selector = $('tool-selector').value.trim()
  const text = $('tool-fill-text').value
  if (!selector || !text) return
  toolResult.style.display = 'block'
  toolResult.textContent = '⏳ Filling...'
  const result = await sendToBackground('TOOL_EXECUTE', { tool: 'fill_input', args: [selector, text] })
  toolResult.textContent = result.success ? `✅ ${result.result}` : `❌ ${result.error}`
})

// --- Init ---

requestPageData()
