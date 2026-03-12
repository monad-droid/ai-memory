// Shared content script - runs after the platform-specific extractor is loaded
(function () {
  'use strict';

  const extractor = window.__aiMemoryExtractor;
  if (!extractor) return;

  const SAVE_INTERVAL_MS = 10000; // Save every 10 seconds if there are changes
  const MIN_MESSAGES_TO_SAVE = 1;

  let lastSavedHash = '';
  let saveTimer = null;

  function hashMessages(messages) {
    return messages.map(m => m.role + ':' + m.content.slice(0, 100)).join('|');
  }

  function captureConversation() {
    const conversationId = extractor.getConversationId();
    if (!conversationId) return null;

    const messages = extractor.extractMessages();
    if (messages.length < MIN_MESSAGES_TO_SAVE) return null;

    const title = extractor.getConversationTitle() || `${extractor.platformName} conversation`;

    return {
      id: `${extractor.platform}-${conversationId}`,
      platform: extractor.platform,
      platformName: extractor.platformName,
      conversationId,
      title,
      url: window.location.href,
      messageCount: messages.length,
      messages,
      lastUpdated: new Date().toISOString()
    };
  }

  function saveIfChanged() {
    const conversation = captureConversation();
    if (!conversation) return;

    const currentHash = hashMessages(conversation.messages);
    if (currentHash === lastSavedHash) return;

    chrome.runtime.sendMessage({
      type: 'SAVE_CONVERSATION',
      conversation
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[AI Memory] Save error:', chrome.runtime.lastError.message);
        return;
      }
      // Only mark as saved if background confirmed the save
      if (response && response.saved) {
        lastSavedHash = currentHash;
      }
    });
  }

  // Observe DOM changes to detect new messages
  const observer = new MutationObserver(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveIfChanged, SAVE_INTERVAL_MS);
  });

  // Start observing once the page is ready
  function startObserving() {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Do an initial capture
    setTimeout(saveIfChanged, 1000);
  }

  if (document.readyState === 'complete') {
    startObserving();
  } else {
    window.addEventListener('load', startObserving);
  }

  // Also save when user navigates away
  window.addEventListener('beforeunload', () => {
    clearTimeout(saveTimer);
    saveIfChanged();
  });

  // Listen for manual save requests from the popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'MANUAL_SAVE') {
      const conversation = captureConversation();
      if (conversation) {
        lastSavedHash = hashMessages(conversation.messages);
        sendResponse({ success: true, conversation });
      } else {
        sendResponse({ success: false, error: 'No conversation found on this page' });
      }
    }
    return true;
  });
})();
