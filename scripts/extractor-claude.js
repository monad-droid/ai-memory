// Claude.ai conversation extractor
const ClaudeExtractor = {
  platform: 'claude',
  platformName: 'Claude',

  getConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  },

  getConversationTitle() {
    // Claude shows the title in the header or sidebar
    const titleEl =
      document.querySelector('[data-testid="conversation-title"]') ||
      document.querySelector('header h1') ||
      document.querySelector('title');
    if (titleEl) {
      const text = titleEl.textContent.trim();
      if (text && text !== 'Claude') return text;
    }
    return null;
  },

  extractMessages() {
    const messages = [];

    // Claude renders conversations as alternating human/assistant message blocks
    const messageBlocks = document.querySelectorAll('[data-testid^="chat-message-"], .font-claude-message, .font-user-message');

    if (messageBlocks.length > 0) {
      messageBlocks.forEach((block, index) => {
        const role = this.detectRole(block, index);
        const content = this.extractContent(block);
        if (content) {
          messages.push({ role, content, timestamp: new Date().toISOString() });
        }
      });
    }

    // Fallback: try generic turn-based extraction
    if (messages.length === 0) {
      const turns = document.querySelectorAll('[class*="turn"], [class*="message"], [class*="Message"]');
      turns.forEach((turn, index) => {
        const content = this.extractContent(turn);
        if (content && content.length > 1) {
          const role = this.detectRoleFromElement(turn, index);
          messages.push({ role, content, timestamp: new Date().toISOString() });
        }
      });
    }

    return messages;
  },

  detectRole(block, index) {
    const classList = block.className || '';
    const testId = block.getAttribute('data-testid') || '';

    if (testId.includes('human') || classList.includes('user')) return 'human';
    if (testId.includes('assistant') || classList.includes('claude')) return 'assistant';

    // Fallback: alternating pattern (human starts)
    return index % 2 === 0 ? 'human' : 'assistant';
  },

  detectRoleFromElement(el, index) {
    const text = el.textContent || '';
    const html = el.innerHTML || '';

    // Look for role indicators in the element or its children
    if (html.includes('Human') || html.includes('You')) return 'human';
    if (html.includes('Claude') || html.includes('Assistant')) return 'assistant';

    return index % 2 === 0 ? 'human' : 'assistant';
  },

  extractContent(block) {
    // Try to get the main content area, skipping UI chrome
    const contentArea =
      block.querySelector('[class*="content"], [class*="markdown"], .prose') || block;

    // Clone to avoid modifying the page
    const clone = contentArea.cloneNode(true);

    // Remove buttons, toolbars, and other UI elements
    clone.querySelectorAll('button, [role="toolbar"], [class*="toolbar"], [class*="action"]')
      .forEach(el => el.remove());

    return clone.textContent.trim();
  }
};

// Expose to content.js
window.__aiMemoryExtractor = ClaudeExtractor;
