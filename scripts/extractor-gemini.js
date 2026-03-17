// Gemini conversation extractor
const GeminiExtractor = {
  platform: 'gemini',
  platformName: 'Gemini',

  getConversationId() {
    const match = window.location.pathname.match(/\/app\/([a-f0-9]+)/);
    return match ? match[1] : null;
  },

  getConversationTitle() {
    // Gemini shows the conversation title in the side panel or header
    const activeItem = document.querySelector('[class*="selected"] [class*="title"], [class*="active"] [class*="conversation"]');
    if (activeItem) {
      const text = activeItem.textContent.trim();
      if (text) return text;
    }

    const titleEl = document.querySelector('title');
    if (titleEl) {
      const text = titleEl.textContent.trim();
      if (text && text !== 'Gemini') return text;
    }
    return null;
  },

  extractMessages() {
    const messages = [];

    // Gemini uses specific turn containers
    let turns = document.querySelectorAll(
      'message-content, [class*="query-content"], [class*="response-content"], [class*="model-response"], [class*="user-query"]'
    );

    if (turns.length > 0) {
      // Deduplicate: remove elements that are descendants of other matched elements
      // (e.g. message-content inside [class*="model-response"] would double-count)
      const turnArr = Array.from(turns);
      const filtered = turnArr.filter(el =>
        !turnArr.some(other => other !== el && other.contains(el))
      );

      const seen = new Set();
      filtered.forEach((turn, index) => {
        const content = this.extractContent(turn);
        if (content && content.length > 1) {
          // Skip duplicate content from overlapping selectors
          if (seen.has(content)) return;
          seen.add(content);
          const role = this.detectRole(turn, index);
          messages.push({ role, content, timestamp: new Date().toISOString() });
        }
      });
      return messages;
    }

    // Fallback: generic conversation containers
    const containers = document.querySelectorAll('[class*="turn"], [class*="conversation-turn"], [class*="chat-turn"]');
    const seen = new Set();
    containers.forEach((container, index) => {
      const content = this.extractContent(container);
      if (content && content.length > 1) {
        if (seen.has(content)) return;
        seen.add(content);
        const role = this.detectRole(container, index);
        messages.push({ role, content, timestamp: new Date().toISOString() });
      }
    });

    return messages;
  },

  detectRole(block, index) {
    const classList = block.className || '';
    const tag = block.tagName || '';

    if (classList.includes('query') || classList.includes('user') || classList.includes('human')) return 'human';
    if (classList.includes('response') || classList.includes('model') || classList.includes('assistant')) return 'assistant';

    // Check parent elements
    const parent = block.closest('[class*="query"], [class*="response"], [class*="user"], [class*="model"]');
    if (parent) {
      const parentClass = parent.className || '';
      if (parentClass.includes('query') || parentClass.includes('user')) return 'human';
      if (parentClass.includes('response') || parentClass.includes('model')) return 'assistant';
    }

    return index % 2 === 0 ? 'human' : 'assistant';
  },

  extractContent(block) {
    const contentArea =
      block.querySelector('.markdown-main-panel, [class*="markdown"], .prose, [class*="text-content"]') || block;

    const clone = contentArea.cloneNode(true);

    clone.querySelectorAll('button, [role="toolbar"], [class*="toolbar"], [class*="action"], [class*="icon-button"]')
      .forEach(el => el.remove());

    return clone.textContent.trim();
  },

  getInputElement() {
    return document.querySelector('.ql-editor[contenteditable="true"]') ||
           document.querySelector('[contenteditable="true"]') ||
           document.querySelector('textarea');
  },

  isNewConversation() {
    return !this.getConversationId();
  }
};

window.__aiMemoryExtractor = GeminiExtractor;
