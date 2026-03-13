// Grok (x.com/i/grok) conversation extractor
const GrokExtractor = {
  platform: 'grok',
  platformName: 'Grok',

  getConversationId() {
    // Grok URLs: x.com/i/grok/chat/CONVERSATION_ID or grok.com/chat/CONVERSATION_ID
    const match = window.location.pathname.match(/\/chat\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  },

  getConversationTitle() {
    // Check sidebar for active conversation title
    const activeItem = document.querySelector('[class*="active"] [class*="title"], [aria-selected="true"]');
    if (activeItem) {
      const text = activeItem.textContent.trim();
      if (text && text !== 'Grok') return text;
    }

    const titleEl = document.querySelector('title');
    if (titleEl) {
      const text = titleEl.textContent.trim();
      if (text && text !== 'Grok') return text;
    }
    return null;
  },

  extractMessages() {
    const messages = [];

    // Grok uses message containers with role indicators
    // Try data attributes first
    const roleBlocks = document.querySelectorAll('[data-message-author-role], [data-role]');
    if (roleBlocks.length > 0) {
      roleBlocks.forEach(block => {
        const role = block.getAttribute('data-message-author-role') || block.getAttribute('data-role');
        const content = this.extractContent(block);
        if (content && content.length > 1) {
          messages.push({
            role: (role === 'user' || role === 'human') ? 'human' : 'assistant',
            content,
            timestamp: new Date().toISOString()
          });
        }
      });
      if (messages.length > 0) return messages;
    }

    // Try turn-based containers
    const turns = document.querySelectorAll(
      '[class*="message"], [class*="turn"], [class*="chat-message"], [class*="conversation-row"]'
    );
    const seen = new Set();
    turns.forEach((turn, index) => {
      const content = this.extractContent(turn);
      if (content && content.length > 1 && !seen.has(content)) {
        seen.add(content);
        const role = this.detectRole(turn, index);
        messages.push({ role, content, timestamp: new Date().toISOString() });
      }
    });

    return messages;
  },

  detectRole(block, index) {
    const classList = (block.className || '').toLowerCase();
    const text = block.textContent || '';

    if (classList.includes('user') || classList.includes('human')) return 'human';
    if (classList.includes('assistant') || classList.includes('bot') || classList.includes('grok')) return 'assistant';

    // Check for avatar or label indicators
    const parent = block.closest('[class*="user"], [class*="assistant"], [class*="grok"]');
    if (parent) {
      const pc = (parent.className || '').toLowerCase();
      if (pc.includes('user')) return 'human';
      if (pc.includes('assistant') || pc.includes('grok')) return 'assistant';
    }

    return index % 2 === 0 ? 'human' : 'assistant';
  },

  extractContent(block) {
    const contentArea =
      block.querySelector('.markdown, [class*="markdown"], .prose, [class*="text-content"], [class*="message-text"]') || block;

    const clone = contentArea.cloneNode(true);
    clone.querySelectorAll('button, [role="toolbar"], [class*="toolbar"], [class*="action"], svg')
      .forEach(el => el.remove());

    return clone.textContent.trim();
  },

  getInputElement() {
    return document.querySelector('textarea[placeholder]') ||
           document.querySelector('[contenteditable="true"]') ||
           document.querySelector('textarea');
  },

  isNewConversation() {
    return !this.getConversationId();
  }
};

window.__aiMemoryExtractor = GrokExtractor;
