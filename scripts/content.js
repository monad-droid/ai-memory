// Shared content script - runs after the platform-specific extractor is loaded
(function () {
  'use strict';

  const extractor = window.__aiMemoryExtractor;
  console.log('[AI Memory] Content script loaded, extractor:', extractor ? extractor.platformName : 'NOT FOUND');
  if (!extractor) return;

  const SAVE_INTERVAL_MS = 10000; // Save every 10 seconds if there are changes
  const MIN_MESSAGES_TO_SAVE = 1;

  let lastSavedHash = '';
  let lastUrl = window.location.href;
  let saveTimer = null;

  function hashMessages(messages) {
    return messages.map(m => m.role + ':' + m.content.slice(0, 100)).join('|');
  }

  function captureConversation() {
    const conversationId = extractor.getConversationId();
    console.log('[AI Memory] captureConversation - id:', conversationId, 'url:', window.location.pathname);
    if (!conversationId) return null;

    const messages = extractor.extractMessages();
    console.log('[AI Memory] captureConversation - messages found:', messages.length);
    if (messages.length < MIN_MESSAGES_TO_SAVE) return null;

    const title = extractor.getConversationTitle() || `${extractor.platformName} conversation`;
    console.log('[AI Memory] captureConversation - title:', title);

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
    console.log('[AI Memory] saveIfChanged triggered');
    const conversation = captureConversation();
    if (!conversation) {
      console.log('[AI Memory] No conversation captured');
      return;
    }

    const currentHash = hashMessages(conversation.messages);
    if (currentHash === lastSavedHash) {
      console.log('[AI Memory] Hash unchanged, skipping save');
      return;
    }

    console.log('[AI Memory] Sending save request:', conversation.messageCount, 'messages');
    chrome.runtime.sendMessage({
      type: 'SAVE_CONVERSATION',
      conversation
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[AI Memory] Save error:', chrome.runtime.lastError.message);
        return;
      }
      console.log('[AI Memory] Save response:', response);
      // Only mark as saved if background confirmed the save
      if (response && response.saved) {
        lastSavedHash = currentHash;
      }
    });
  }

  // Reset state when the URL changes (SPA navigation to a new conversation)
  function checkUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      lastSavedHash = ''; // Reset so the new conversation gets saved
      clearTimeout(saveTimer);
      setTimeout(saveIfChanged, 1000);
    }
  }

  // Observe DOM changes to detect new messages
  const observer = new MutationObserver(() => {
    checkUrlChange();
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

    // Detect SPA navigation via History API
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function () {
      origPushState.apply(this, arguments);
      checkUrlChange();
    };
    history.replaceState = function () {
      origReplaceState.apply(this, arguments);
      checkUrlChange();
    };
    window.addEventListener('popstate', checkUrlChange);

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
