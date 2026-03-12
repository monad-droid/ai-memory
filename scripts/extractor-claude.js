// Claude.ai conversation extractor
const ClaudeExtractor = {
  platform: 'claude',
  platformName: 'Claude',

  getConversationId() {
    const match = window.location.pathname.match(/\/chat\/([a-f0-9-]+)/);
    return match ? match[1] : null;
  },

  getConversationTitle() {
    const selectors = [
      '[data-testid="conversation-title"]',
      'header h1',
      'button[data-testid="chat-title"]',
      '[class*="ConversationTitle"]',
      '[class*="conversation-title"]'
    ];
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
    // Strategy 1: Explicit role data attributes
    let messages = this.tryExplicitRoleAttributes();
    if (messages.length >= 2) return messages;

    // Strategy 2: Turn containers with role detection via classes
    messages = this.tryTurnContainers();
    if (messages.length >= 2) return messages;

    // Strategy 3: Walk DOM for role labels ("You" / "Claude") next to content
    messages = this.tryRoleLabelWalk();
    if (messages.length >= 2) return messages;

    // Strategy 4: Structural parse of conversation container
    messages = this.tryStructuralParse();
    return messages;
  },

  tryExplicitRoleAttributes() {
    const messages = [];
    const selectors = [
      '[data-testid*="user-message"], [data-testid*="assistant-message"]',
      '[data-testid*="human-message"], [data-testid*="ai-message"]',
      '[data-role="user"], [data-role="assistant"]',
      '[data-author="user"], [data-author="assistant"]',
      '[data-message-author-role]'
    ];

    for (const sel of selectors) {
      const blocks = document.querySelectorAll(sel);
      if (blocks.length === 0) continue;

      blocks.forEach(block => {
        const role = this.detectRoleFromAttributes(block);
        const content = this.extractContent(block);
        if (content && role) {
          messages.push({ role, content, timestamp: new Date().toISOString() });
        }
      });

      if (messages.length >= 2) return messages;
      messages.length = 0;
    }
    return messages;
  },

  tryTurnContainers() {
    const messages = [];
    const containerSelectors = [
      '[class*="turn-"][class*="human"], [class*="turn-"][class*="assistant"]',
      '[class*="ChatMessage"], [class*="chat-message"]',
      '[class*="MessageContent"]',
      'div[class*="human-turn"], div[class*="assistant-turn"]',
      'div[class*="UserMessage"], div[class*="AssistantMessage"]'
    ];

    for (const sel of containerSelectors) {
      const blocks = document.querySelectorAll(sel);
      if (blocks.length === 0) continue;

      blocks.forEach(block => {
        const role = this.detectRoleFromContext(block);
        const content = this.extractContent(block);
        if (content && role) {
          messages.push({ role, content, timestamp: new Date().toISOString() });
        }
      });

      if (messages.length >= 2) return messages;
      messages.length = 0;
    }
    return messages;
  },

  tryRoleLabelWalk() {
    const messages = [];
    const allElements = document.querySelectorAll('*');
    const roleLabels = [];

    for (const el of allElements) {
      if (el.children.length > 3) continue;
      const text = el.textContent.trim();
      if (text === 'You' || text === 'Claude' || text === 'Assistant') {
        if (el.textContent.trim().length <= 10) {
          roleLabels.push({
            element: el,
            role: text === 'You' ? 'human' : 'assistant'
          });
        }
      }
    }

    for (const label of roleLabels) {
      const messageContent = this.findAdjacentContent(label.element);
      if (messageContent && messageContent.length > 0) {
        messages.push({
          role: label.role,
          content: messageContent,
          timestamp: new Date().toISOString()
        });
      }
    }
    return messages;
  },

  tryStructuralParse() {
    const messages = [];
    const containerSelectors = [
      '[class*="conversation"], [class*="Conversation"]',
      '[class*="chat-content"], [class*="ChatContent"]',
      'main [class*="scroll"]',
      'main'
    ];

    let container = null;
    for (const sel of containerSelectors) {
      container = document.querySelector(sel);
      if (container) break;
    }
    if (!container) return messages;

    const children = container.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.textContent.trim().length < 2) continue;
      const role = this.detectRoleFromContext(child);
      if (role) {
        const content = this.extractContent(child);
        if (content) {
          messages.push({ role, content, timestamp: new Date().toISOString() });
        }
      }
    }
    return messages;
  },

  detectRoleFromAttributes(el) {
    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    const dataRole = (el.getAttribute('data-role') || '').toLowerCase();
    const dataAuthor = (el.getAttribute('data-author') || '').toLowerCase();
    const authorRole = (el.getAttribute('data-message-author-role') || '').toLowerCase();
    const allAttrs = testId + ' ' + dataRole + ' ' + dataAuthor + ' ' + authorRole;

    if (allAttrs.includes('user') || allAttrs.includes('human')) return 'human';
    if (allAttrs.includes('assistant') || allAttrs.includes('ai') || allAttrs.includes('claude')) return 'assistant';
    return null;
  },

  detectRoleFromContext(el) {
    const toCheck = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean);
    for (const node of toCheck) {
      const cls = (node.className || '').toLowerCase();
      const ariaLabel = (node.getAttribute('aria-label') || '').toLowerCase();
      const testId = (node.getAttribute('data-testid') || '').toLowerCase();
      const combined = cls + ' ' + ariaLabel + ' ' + testId;

      if (combined.includes('human') || combined.includes('user')) return 'human';
      if (combined.includes('assistant') || combined.includes('claude') || combined.includes('bot')) return 'assistant';
    }

    // Check for role label children
    const labelEl = el.querySelector('[class*="role"], [class*="sender"], [class*="author"]');
    if (labelEl) {
      const labelText = labelEl.textContent.trim().toLowerCase();
      if (labelText.includes('you') || labelText.includes('human') || labelText.includes('user')) return 'human';
      if (labelText.includes('claude') || labelText.includes('assistant')) return 'assistant';
    }

    // Check first child text for role label
    const firstText = el.firstElementChild?.textContent?.trim() || '';
    if (firstText === 'You') return 'human';
    if (firstText === 'Claude' || firstText === 'Assistant') return 'assistant';

    return null;
  },

  findAdjacentContent(labelEl) {
    // Try next sibling
    let sibling = labelEl.nextElementSibling;
    if (sibling) {
      const text = this.extractContent(sibling);
      if (text && text.length > 0) return text;
    }

    // Try parent's next sibling
    const parent = labelEl.parentElement;
    if (parent) {
      sibling = parent.nextElementSibling;
      if (sibling) {
        const text = this.extractContent(sibling);
        if (text && text.length > 0) return text;
      }

      // Try other children of parent
      for (const child of parent.children) {
        if (child === labelEl) continue;
        const text = child.textContent.trim();
        if (text.length > 0 && text !== 'You' && text !== 'Claude') {
          return this.extractContent(child);
        }
      }
    }

    // Try grandparent's next sibling
    const grandparent = parent?.parentElement;
    if (grandparent) {
      sibling = grandparent.nextElementSibling;
      if (sibling) {
        const text = this.extractContent(sibling);
        if (text && text.length > 0) return text;
      }
    }

    return null;
  },

  extractContent(block) {
    const contentArea =
      block.querySelector('[class*="markdown"], .prose, [class*="message-text"], [class*="content"]') || block;

    const clone = contentArea.cloneNode(true);

    // Remove UI chrome
    clone.querySelectorAll(
      'button, [role="toolbar"], [class*="toolbar"], [class*="action"], ' +
      '[class*="copy"], [class*="Copy"], [class*="feedback"], [class*="Feedback"], ' +
      '[class*="avatar"], [class*="Avatar"], svg, [class*="tooltip"], [class*="Tooltip"]'
    ).forEach(el => el.remove());

    const text = clone.textContent.trim();

    // Don't return if it's just a role label
    if (text === 'You' || text === 'Claude' || text === 'Assistant') return '';
    return text;
  }
};

// Expose to content.js
window.__aiMemoryExtractor = ClaudeExtractor;
