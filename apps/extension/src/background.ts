// --- Types ---

interface SynapseMessage {
  type:
    | 'OPEN_SIDEPANEL'
    | 'CLOSE_SIDEPANEL'
    | 'EXTRACT_PAGE_DATA'
    | 'ANALYZE_PAGE'
    | 'TOGGLE_SYNAPSE'
    | 'GET_AUTH_STATE'
    | 'PAGE_DATA_RESPONSE'
    | 'GET_PAGE_TYPE'
    | 'OPEN_ACTION_PANEL'
    | 'AI_CHAT'
    | 'AI_GENERATE'
    | 'TOOL_EXECUTE'
  payload?: any
}

// --- State ---

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'

// --- Side Panel ---

function openSidePanel() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (tabId) {
      chrome.sidePanel.open({ tabId }).catch((err) =>
        console.error('Failed to open side panel:', err)
      )
    }
  })
}

// --- NVIDIA AI ---

async function handleAIChat(messages: any[]): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const res = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer __NVIDIA_API_KEY__',
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [
          { role: 'system', content: `You are Synapse, an AI assistant specialized in Facebook Page management.

You have the ability to CONTROL the Facebook page directly using tools. When the user asks you to perform an action on Facebook, you respond with the action using the format:

[TOOL: tool_name: arg1 | arg2 | ...]

Available tools:
- scroll_to_bottom — Scroll page down
- scroll_to_top — Scroll page up
- get_page_text — Get visible page text
- click_like — Click the first like button on the page
- click_comment — Open the comment section
- click_share — Click share button
- like_first_post — Like the first post on the page
- highlight_elements: selector — Highlight matching elements for 5s (default: articles)
- click_element: css_selector — Click any element by CSS selector
- fill_input: css_selector | text to type — Type text into an input field
- get_visible_text — Get all visible text content from the page

Examples:
User: "like the first post"
Assistant: [TOOL: like_first_post]

User: "scroll down"
Assistant: [TOOL: scroll_to_bottom]

User: "type hello in the comment box"
Assistant: [TOOL: fill_input: [aria-label*="comment"i] textarea | hello]

Always explain what you're doing before using a tool. Be concise, practical, and data-driven.` },
          ...messages,
        ],
        max_tokens: 1024,
        temperature: 0.7,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      console.error('NVIDIA API error:', res.status, errText)
      return { success: false, error: `AI service error (${res.status})` }
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() || ''
    return { success: true, content }
  } catch (err) {
    console.error('AI chat error:', err)
    return { success: false, error: 'Internal error' }
  }
}

async function handleAIGenerate(prompt: string): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    const res = await fetch(NVIDIA_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer __NVIDIA_API_KEY__',
      },
      body: JSON.stringify({
        model: 'meta/llama-3.1-8b-instruct',
        messages: [
          { role: 'system', content: 'You are a social media content creator for a Facebook Page. Generate engaging, well-formatted Facebook posts based on the user\'s request. Use emojis sparingly. Include relevant hashtags. Keep posts concise (under 200 words). Return only the post content, no explanations.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return { success: false, error: `AI service error (${res.status})` }
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim() || ''
    return { success: true, content }
  } catch (err) {
    return { success: false, error: 'Internal error' }
  }
}

// --- Forward to Content Script ---

function forwardToContentScript(type: string, sendResponse: (response: any) => void, payload?: any) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      sendResponse({ success: false, error: 'No active tab' })
      return
    }
    chrome.tabs.sendMessage(tabs[0].id, { type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message })
        return
      }
      sendResponse(response || { success: false, error: 'No response' })
    })
  })
}

// --- Messaging ---

chrome.runtime.onMessage.addListener(
  (message: SynapseMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'OPEN_SIDEPANEL':
      case 'TOGGLE_SYNAPSE':
        openSidePanel()
        sendResponse({ success: true })
        break

      case 'EXTRACT_PAGE_DATA':
        forwardToContentScript('EXTRACT_PAGE_DATA', sendResponse)
        return true

      case 'GET_PAGE_TYPE':
        forwardToContentScript('GET_PAGE_TYPE', sendResponse)
        return true

      case 'OPEN_ACTION_PANEL':
        forwardToContentScript('OPEN_ACTION_PANEL', sendResponse)
        return true

      case 'AI_CHAT': {
        const messages = message.payload?.messages || []
        handleAIChat(messages).then(sendResponse)
        return true
      }

      case 'AI_GENERATE': {
        const prompt = message.payload?.prompt || ''
        handleAIGenerate(prompt).then(sendResponse)
        return true
      }

      case 'TOOL_EXECUTE': {
        forwardToContentScript('TOOL_EXECUTE', sendResponse, message.payload)
        return true
      }

      default:
        sendResponse({ success: false, error: 'Unknown message type' })
    }
  }
)

// --- Extension Lifecycle ---

chrome.runtime.onInstalled.addListener(() => {
  console.log('Synapse Social extension installed')
  try {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  } catch (e) {
    console.error('Failed to set panel behavior:', e)
  }
})

chrome.runtime.onSuspend.addListener(() => {
  console.log('Synapse Social background service worker suspending')
})
