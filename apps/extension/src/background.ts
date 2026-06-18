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
  payload?: any
}

// --- State ---

let isAuthenticated = false
let authToken: string | null = null

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

// --- Messaging ---

chrome.runtime.onMessage.addListener(
  (message: SynapseMessage, sender, sendResponse) => {
    switch (message.type) {
      case 'OPEN_SIDEPANEL':
        openSidePanel()
        sendResponse({ success: true })
        break

      case 'TOGGLE_SYNAPSE':
        openSidePanel()
        sendResponse({ success: true })
        break

      case 'EXTRACT_PAGE_DATA':
        handleExtractPageData(sendResponse)
        return true

      case 'GET_AUTH_STATE':
        sendResponse({ isAuthenticated, token: authToken })
        break

      default:
        sendResponse({ success: false, error: 'Unknown message type' })
    }
  }
)

// --- Message Handler: Extract Page Data ---

function handleExtractPageData(sendResponse: (response: any) => void) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) {
      sendResponse({ success: false, error: 'No active tab' })
      return
    }

    chrome.tabs.sendMessage(
      tabs[0].id,
      { type: 'EXTRACT_PAGE_DATA' },
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          })
          return
        }
        sendResponse(response || { success: false, error: 'No response' })
      }
    )
  })
}

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
