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
  let memoryAlreadyLoaded = false;
  let floatingBtnInjected = false;

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
      console.log('[AI Memory] URL changed:', lastUrl, '->', currentUrl);
      lastUrl = currentUrl;
      lastSavedHash = ''; // Reset so the new conversation gets saved
      memoryAlreadyLoaded = false; // Reset memory state for new conversation
      clearTimeout(saveTimer);
      setTimeout(saveIfChanged, 1000);
      // Delay auto-inject check to let the new page DOM settle
      setTimeout(checkAutoInject, 3000);
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

  // === MEMORY INJECTION ===

  function injectFloatingButton() {
    console.log('[AI Memory] injectFloatingButton called, already injected:', floatingBtnInjected, 'exists in DOM:', !!document.getElementById('ai-memory-load-btn'));
    if (floatingBtnInjected || document.getElementById('ai-memory-load-btn')) return;
    floatingBtnInjected = true;
    console.log('[AI Memory] Injecting floating button into page');

    const btn = document.createElement('button');
    btn.id = 'ai-memory-load-btn';
    btn.title = 'Load AI Memory into this chat';
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/>
        <line x1="10" y1="22" x2="14" y2="22"/>
      </svg>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #ai-memory-load-btn {
        position: fixed;
        bottom: 120px;
        right: 24px;
        z-index: 99999;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 1px solid rgba(107, 92, 231, 0.3);
        background: rgba(15, 15, 20, 0.9);
        color: #8b7cf7;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 12px rgba(0,0,0,0.3);
        transition: all 0.2s;
        backdrop-filter: blur(8px);
      }
      #ai-memory-load-btn:hover {
        background: rgba(107, 92, 231, 0.2);
        border-color: #8b7cf7;
        transform: scale(1.1);
      }
      #ai-memory-load-btn.loading {
        opacity: 0.6;
        pointer-events: none;
      }
      #ai-memory-load-btn.done {
        background: rgba(5, 150, 105, 0.2);
        border-color: #059669;
        color: #10b981;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(btn);

    btn.addEventListener('click', () => loadMemoryIntoChat(btn));
  }

  async function loadMemoryIntoChat(btn) {
    console.log('[AI Memory] loadMemoryIntoChat called, btn:', !!btn);
    if (btn) btn.classList.add('loading');

    try {
      const markdown = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_MEMORY_MARKDOWN', excludePlatform: extractor.platform }, resolve);
      });

      if (!markdown) {
        console.log('[AI Memory] No memory data to load');
        if (btn) btn.classList.remove('loading');
        return;
      }

      const input = extractor.getInputElement();
      if (!input) {
        console.warn('[AI Memory] Could not find chat input element');
        if (btn) btn.classList.remove('loading');
        return;
      }

      insertTextIntoInput(input, markdown);
      memoryAlreadyLoaded = true;

      if (btn) {
        btn.classList.remove('loading');
        btn.classList.add('done');
        btn.title = 'Memory loaded!';
        setTimeout(() => {
          btn.classList.remove('done');
          btn.title = 'Load AI Memory into this chat';
        }, 3000);
      }
    } catch (err) {
      console.error('[AI Memory] Failed to load memory:', err);
      if (btn) btn.classList.remove('loading');
    }
  }

  function insertTextIntoInput(input, text) {
    console.log('[AI Memory] insertTextIntoInput - tag:', input.tagName, 'contentEditable:', input.contentEditable, 'text length:', text.length);
    if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
      // For textarea/input elements
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set || Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(input, text);
      } else {
        input.value = text;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (input.contentEditable === 'true') {
      // For contenteditable elements (Claude, Gemini)
      input.focus();
      // Clear existing content
      input.innerHTML = '';
      // Insert as a paragraph
      const p = document.createElement('p');
      p.textContent = text;
      input.appendChild(p);
      // Dispatch input event so the framework picks up the change
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }
  }

  // Auto-inject: check if this is a new/empty conversation and setting is enabled
  async function checkAutoInject() {
    console.log('[AI Memory] checkAutoInject called, memoryAlreadyLoaded:', memoryAlreadyLoaded, 'url:', window.location.href);
    if (memoryAlreadyLoaded) return;

    try {
      const autoInject = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTING', key: 'autoInject' }, (result) => {
          if (chrome.runtime.lastError) {
            console.warn('[AI Memory] GET_SETTING error:', chrome.runtime.lastError.message);
            resolve(null);
          } else {
            resolve(result);
          }
        });
      });

      console.log('[AI Memory] autoInject setting:', autoInject);
      if (autoInject !== true) return;

      // Check if this looks like a new conversation:
      // - No conversation ID in URL (e.g. claude.ai/ or claude.ai/new), OR
      // - Has conversation ID but zero messages in the DOM
      const hasConversationId = !!extractor.getConversationId();
      console.log('[AI Memory] hasConversationId:', hasConversationId);

      // Wait for input element to be available, then check messages
      let attempts = 0;
      const waitForInput = setInterval(() => {
        attempts++;
        const input = extractor.getInputElement();
        console.log('[AI Memory] waitForInput attempt', attempts, 'input found:', !!input);

        if (input) {
          const messages = extractor.extractMessages();
          console.log('[AI Memory] messages found:', messages.length);

          if (messages.length === 0) {
            clearInterval(waitForInput);
            console.log('[AI Memory] Empty conversation detected, auto-injecting');
            loadMemoryIntoChat(document.getElementById('ai-memory-load-btn'));
          } else {
            // Has messages — not a new conversation
            clearInterval(waitForInput);
            console.log('[AI Memory] Conversation has', messages.length, 'messages, skipping');
          }
        }
        if (attempts >= 20) {
          clearInterval(waitForInput);
          console.log('[AI Memory] Gave up waiting for input after', attempts, 'attempts');
        }
      }, 500);
    } catch (err) {
      console.error('[AI Memory] Auto-inject check failed:', err);
    }
  }

  // Inject floating button and check auto-inject on initial load
  function initMemoryFeatures() {
    console.log('[AI Memory] initMemoryFeatures called, readyState:', document.readyState);
    injectFloatingButton();
    setTimeout(() => {
      console.log('[AI Memory] Initial auto-inject check starting (2s after init)');
      checkAutoInject();
    }, 2000);
  }

  if (document.readyState === 'complete') {
    initMemoryFeatures();
  } else {
    window.addEventListener('load', initMemoryFeatures);
  }
})();
