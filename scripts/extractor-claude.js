// Claude.ai conversation extractor
const ClaudeExtractor = {
  platform: 'claude',
  platformName: 'Claude',

  getConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  },

  getConversationTitle() {
    // Known Claude.ai selectors for conversation title
    const titleBtn = document.querySelector('[data-testid="chat-title-button"]');
    if (titleBtn) {
      const truncate = titleBtn.querySelector('.truncate');
      const text = (truncate || titleBtn).textContent.trim();
      if (text && text !== 'Claude') return text;
    }
    // Fallback selectors
    const selectors = ['header h1', '[data-testid="conversation-title"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text && text !== 'Claude') return text;
      }
    }
    const title = document.title.replace(/\s*[-|]\s*Claude\s*$/, '').trim();
    if (title && title !== 'Claude') return title;
    return null;
  },

  extractMessages() {
    const messages = [];

    // Primary strategy: Find all message action bars and work backwards to content.
    // Claude.ai has [role="group"][aria-label="Message actions"] on each message.
    // Assistant messages have a feedback button; human messages don't.
    const actionGroups = document.querySelectorAll(
      '[role="group"][aria-label="Message actions"]'
    );

    if (actionGroups.length > 0) {
      actionGroups.forEach(group => {
        const hasFeedback = !!group.querySelector(
          'button[aria-label="Give positive feedback"], button[aria-label*="feedback"], button[aria-label*="thumbs"]'
        );
        const role = hasFeedback ? 'assistant' : 'human';

        // Walk up from the action bar to find the message container
        const messageContainer = this.findMessageContainer(group);
        if (messageContainer) {
          const content = this.extractContent(messageContainer);
          if (content) {
            messages.push({ role, content, timestamp: new Date().toISOString() });
          }
        }
      });
    }

    if (messages.length >= 1) return messages;

    // Fallback: Find copy buttons via data-testid and use feedback button presence
    const copyButtons = document.querySelectorAll('button[data-testid="action-bar-copy"]');
    if (copyButtons.length > 0) {
      copyButtons.forEach(btn => {
        const group = btn.closest('[role="group"]');
        const hasFeedback = group && !!group.querySelector(
          'button[aria-label="Give positive feedback"], button[aria-label*="feedback"]'
        );
        const role = hasFeedback ? 'assistant' : 'human';
        const messageContainer = this.findMessageContainer(btn);
        if (messageContainer) {
          const content = this.extractContent(messageContainer);
          if (content) {
            messages.push({ role, content, timestamp: new Date().toISOString() });
          }
        }
      });
    }

    if (messages.length >= 1) return messages;

    // Last resort: find all substantial text blocks in the conversation area
    return this.tryGenericExtraction();
  },

  // Walk up from an action bar element to find the enclosing message container
  findMessageContainer(actionEl) {
    let el = actionEl.parentElement;
    // Walk up until we find a container that has meaningful text content
    // beyond just the action bar itself
    for (let i = 0; i < 8 && el; i++) {
      const clone = el.cloneNode(true);
      // Remove action bars from the clone to check if there's actual content
      clone.querySelectorAll('[role="group"], button, svg').forEach(n => n.remove());
      const text = clone.textContent.trim();
      if (text.length > 0) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  },

  // Generic fallback: look for the conversation thread and extract text blocks
  tryGenericExtraction() {
    const messages = [];

    // Try to find the scrollable conversation area
    const mainEl = document.querySelector('main') || document.body;

    // Look for elements that contain message-like content
    // Claude renders human messages as right-aligned and assistant as left-aligned
    const allGroups = mainEl.querySelectorAll('[role="group"]');
    const processed = new Set();

    allGroups.forEach(group => {
      const ariaLabel = (group.getAttribute('aria-label') || '').toLowerCase();
      if (!ariaLabel.includes('message')) return;

      const container = this.findMessageContainer(group);
      if (!container || processed.has(container)) return;
      processed.add(container);

      const hasFeedback = !!group.querySelector(
        'button[aria-label*="feedback"], button[aria-label*="thumbs"]'
      );
      const content = this.extractContent(container);
      if (content) {
        messages.push({
          role: hasFeedback ? 'assistant' : 'human',
          content,
          timestamp: new Date().toISOString()
        });
      }
    });

    return messages;
  },

  extractContent(block) {
    // Clone to avoid modifying the page
    const clone = block.cloneNode(true);

    // Remove all UI chrome: action bars, buttons, SVGs, toolbars
    clone.querySelectorAll(
      '[role="group"], button, [role="toolbar"], svg, ' +
      '[class*="toolbar"], [class*="tooltip"], [class*="Tooltip"]'
    ).forEach(el => el.remove());

    const text = clone.textContent.trim();

    // Don't return if it's just a role label or empty
    if (!text || text === 'You' || text === 'Claude' || text === 'Assistant') return '';
    return text;
  }
};

// Expose to content.js
window.__aiMemoryExtractor = ClaudeExtractor;
