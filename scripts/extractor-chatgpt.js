// ChatGPT conversation extractor
const ChatGPTExtractor = {
  platform: 'chatgpt',
  platformName: 'ChatGPT',

  getConversationId() {
    const match = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  },

  getConversationTitle() {
    // ChatGPT shows active conversation title in the sidebar or nav
    const activeNav = document.querySelector('nav a.bg-token-sidebar-surface-secondary, nav [class*="active"]');
    if (activeNav) {
      const text = activeNav.textContent.trim();
      if (text) return text;
    }

    const titleEl = document.querySelector('title');
    if (titleEl) {
      const text = titleEl.textContent.trim();
      if (text && text !== 'ChatGPT') return text;
    }
    return null;
  },

  extractMessages() {
    const messages = [];

    // ChatGPT uses article elements or data-message-author-role attributes
    const articleBlocks = document.querySelectorAll('[data-message-author-role]');

    if (articleBlocks.length > 0) {
      articleBlocks.forEach(block => {
        const role = block.getAttribute('data-message-author-role');
        const content = this.extractContent(block);
        if (content) {
          const normalizedRole = role === 'user' ? 'human' : 'assistant';
          messages.push({ role: normalizedRole, content, timestamp: new Date().toISOString() });
        }
      });
      return messages;
    }

    // Fallback: look for turn containers
    const turns = document.querySelectorAll('[class*="ConversationItem"], [data-testid^="conversation-turn"]');
    turns.forEach((turn, index) => {
      const content = this.extractContent(turn);
      if (content && content.length > 1) {
        const role = this.detectRole(turn, index);
        messages.push({ role, content, timestamp: new Date().toISOString() });
      }
    });

    return messages;
  },

  detectRole(block, index) {
    const html = block.innerHTML || '';
    const testId = block.getAttribute('data-testid') || '';

    if (html.includes('You') && !html.includes('ChatGPT')) return 'human';
    if (html.includes('ChatGPT') || html.includes('GPT')) return 'assistant';

    if (testId.includes('user')) return 'human';
    if (testId.includes('assistant')) return 'assistant';

    return index % 2 === 0 ? 'human' : 'assistant';
  },

  extractContent(block) {
    const contentArea =
      block.querySelector('.markdown, [class*="markdown"], .prose, [class*="message-content"]') || block;

    const clone = contentArea.cloneNode(true);

    // Remove UI elements
    clone.querySelectorAll('button, [role="toolbar"], [class*="toolbar"], [class*="action"], [class*="copy"]')
      .forEach(el => el.remove());

    return clone.textContent.trim();
  }
};

  getInputElement() {
    return document.querySelector('#prompt-textarea') ||
           document.querySelector('textarea[data-id="root"]') ||
           document.querySelector('[contenteditable="true"]') ||
           document.querySelector('textarea');
  },

  isNewConversation() {
    return !this.getConversationId();
  }
};

window.__aiMemoryExtractor = ChatGPTExtractor;
