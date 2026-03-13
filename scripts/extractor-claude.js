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
    const log = (msg, ...args) => console.log(`[AI Memory] ${msg}`, ...args);

    // === DOM DIAGNOSTIC ===
    // Log what we can find so we can debug selector issues
    const allRoleGroups = document.querySelectorAll('[role="group"]');
    const allAriaLabels = [];
    allRoleGroups.forEach(g => {
      const label = g.getAttribute('aria-label');
      if (label) allAriaLabels.push(label);
    });
    log('Found role="group" elements:', allRoleGroups.length, 'aria-labels:', [...new Set(allAriaLabels)]);

    const allButtons = document.querySelectorAll('button[data-testid]');
    const testIds = [];
    allButtons.forEach(b => testIds.push(b.getAttribute('data-testid')));
    log('Found button data-testids:', [...new Set(testIds)]);

    const allDataTestIds = document.querySelectorAll('[data-testid]');
    const allTestIds = [];
    allDataTestIds.forEach(el => allTestIds.push(el.tagName + ':' + el.getAttribute('data-testid')));
    log('All data-testid elements:', [...new Set(allTestIds)].slice(0, 30));

    // Primary strategy: Find all message action bars
    const actionGroups = document.querySelectorAll(
      '[role="group"][aria-label="Message actions"]'
    );
    log('Strategy 1 - action groups with "Message actions":', actionGroups.length);

    if (actionGroups.length > 0) {
      actionGroups.forEach((group, i) => {
        const buttons = group.querySelectorAll('button');
        const btnLabels = [];
        buttons.forEach(b => btnLabels.push(b.getAttribute('aria-label') || b.textContent.trim().slice(0, 20)));
        log(`  Group ${i} buttons:`, btnLabels);

        const hasFeedback = !!group.querySelector(
          'button[aria-label="Give positive feedback"], button[aria-label*="feedback"], button[aria-label*="thumbs"]'
        );
        const role = hasFeedback ? 'assistant' : 'human';

        const messageContainer = this.findMessageContainer(group);
        log(`  Group ${i} role=${role}, container found=${!!messageContainer}`);
        if (messageContainer) {
          const content = this.extractContent(messageContainer);
          log(`  Group ${i} content length=${content ? content.length : 0}, preview="${content ? content.slice(0, 80) : ''}"`);
          if (content) {
            messages.push({ role, content, timestamp: new Date().toISOString() });
          }
        }
      });
    }

    if (messages.length >= 1) {
      log('Strategy 1 succeeded with', messages.length, 'messages');
      return messages;
    }

    // Fallback: Find copy buttons via data-testid
    const copyButtons = document.querySelectorAll('button[data-testid="action-bar-copy"]');
    log('Strategy 2 - copy buttons:', copyButtons.length);

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

    if (messages.length >= 1) {
      log('Strategy 2 succeeded with', messages.length, 'messages');
      return messages;
    }

    // Last resort: find all substantial text blocks in the conversation area
    log('Trying generic extraction...');
    const generic = this.tryGenericExtraction();
    log('Generic extraction found', generic.length, 'messages');
    return generic;
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

  getInputElement() {
    return document.querySelector('[contenteditable="true"].ProseMirror') ||
           document.querySelector('[contenteditable="true"]') ||
           document.querySelector('textarea');
  },

  isNewConversation() {
    // No conversation ID in URL means it's the new chat page
    return !this.getConversationId();
  }
};

// Expose to content.js
window.__aiMemoryExtractor = ClaudeExtractor;
