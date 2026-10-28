    const pageAvatar = document.getElementById('page-avatar')
    const pageName = document.getElementById('page-name')
    const pageStatus = document.getElementById('page-status')
    const pageTypeDisplay = document.getElementById('page-type-display')
    const actionsContainer = document.getElementById('actions-container')
    const openPanel = document.getElementById('open-panel')
    const settingsLink = document.getElementById('settings-link')

    const pageActions = {
      page: [
        { label: '🔍 Extract Page Data', action: 'extract' },
        { label: '✍️ Generate Content', action: 'generate' },
        { label: '🛠️ Open Tools', action: 'tools' },
      ],
      unknown: [
        { label: '🛠️ Use Synapse', action: 'open' },
      ],
    }

    const pageTypeLabels = {
      page: 'Webpage', unknown: 'Unknown',
    }

    const pageTypeBadges = {
      page: 'badge-page', unknown: 'badge-unknown',
    }

    function updatePopup(pageType) {
      const label = pageTypeLabels[pageType] || 'Unknown'
      const badgeClass = pageTypeBadges[pageType] || 'badge-unknown'

      pageTypeDisplay.innerHTML = `<span class="badge ${badgeClass}">${label}</span>`

      const existingBtns = actionsContainer.querySelectorAll('.context-action')
      existingBtns.forEach(b => b.remove())

      const actions = pageActions[pageType] || pageActions.unknown
      actions.forEach(a => {
        const btn = document.createElement('button')
        btn.className = 'btn btn-secondary context-action'
        btn.textContent = a.label
        btn.addEventListener('click', () => {
          chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' })
          window.close()
        })
        actionsContainer.appendChild(btn)
      })
    }

    openPanel.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' })
      window.close()
    })

    settingsLink.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' })
      window.close()
    })

    // Detect page on popup open
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        pageStatus.textContent = 'No active tab'
        return
      }

      chrome.tabs.sendMessage(tabs[0].id, { type: 'SYNAPSE_PING' }, (response) => {
        if (chrome.runtime.lastError || !response?.active) {
          pageStatus.textContent = 'No page detected'
          pageAvatar.textContent = '?'
          updatePopup('unknown')
          return
        }

        pageStatus.textContent = 'Active'
        pageAvatar.textContent = 'S'

        chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT_PAGE_DATA' }, (dataResp) => {
          if (dataResp?.success && dataResp.data?.pageTitle) {
            pageName.textContent = dataResp.data.pageTitle
          }
        })

        updatePopup('page')
      })
    })
