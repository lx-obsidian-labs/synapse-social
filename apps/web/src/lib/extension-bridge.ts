"use client"

export function isExtensionContext(): boolean {
  return typeof window !== "undefined" && !!(window as any).chrome?.runtime?.id
}

export function sendExtensionMessage(type: string, payload?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!isExtensionContext()) {
      reject(new Error("Not in extension context"))
      return
    }
    const chrome = (window as any).chrome
    chrome.runtime.sendMessage({ type, payload }, (response: any) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve(response)
      }
    })
  })
}

export function getPageData(): Promise<any> {
  return sendExtensionMessage("EXTRACT_PAGE_DATA")
}

export function openSidePanel(): Promise<any> {
  return sendExtensionMessage("OPEN_SIDEPANEL")
}

export function listenForExtensionMessages(
  handler: (message: any) => void
): () => void {
  if (!isExtensionContext()) return () => {}

  const chrome = (window as any).chrome
  const listener = (message: any) => handler(message)
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
