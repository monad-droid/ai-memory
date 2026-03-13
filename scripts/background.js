// Background service worker - handles storage and coordination
'use strict';

// Storage keys
const STORAGE_KEY_CONVERSATIONS = 'ai_memory_conversations';
const STORAGE_KEY_INDEX = 'ai_memory_index';
const STORAGE_KEY_STATS = 'ai_memory_stats';

// Save a conversation to local storage
async function saveConversation(conversation) {
  const { id } = conversation;

  // Get existing index
  const indexData = await chrome.storage.local.get(STORAGE_KEY_INDEX);
  const index = indexData[STORAGE_KEY_INDEX] || {};

  // Check if this is new or updated
  const isNew = !index[id];
  const existingEntry = index[id];

  // Skip save only if message count AND title are identical (no changes)
  if (existingEntry
    && conversation.messageCount === existingEntry.messageCount
    && conversation.title === existingEntry.title) {
    return { saved: false, reason: 'no_changes' };
  }

  // Store the full conversation data under its own key
  const convKey = `conv_${id}`;
  await chrome.storage.local.set({
    [convKey]: conversation
  });

  // Update the index (lightweight metadata for listing)
  index[id] = {
    id,
    platform: conversation.platform,
    platformName: conversation.platformName,
    title: conversation.title,
    url: conversation.url,
    messageCount: conversation.messageCount,
    lastUpdated: conversation.lastUpdated,
    firstSaved: existingEntry ? existingEntry.firstSaved : new Date().toISOString()
  };

  await chrome.storage.local.set({ [STORAGE_KEY_INDEX]: index });

  // Update stats
  await updateStats(isNew, conversation.platform);

  // Update badge
  const totalConversations = Object.keys(index).length;
  chrome.action.setBadgeText({ text: String(totalConversations) });
  chrome.action.setBadgeBackgroundColor({ color: '#6B5CE7' });

  return { saved: true, isNew };
}

async function updateStats(isNew, platform) {
  const statsData = await chrome.storage.local.get(STORAGE_KEY_STATS);
  const stats = statsData[STORAGE_KEY_STATS] || {
    totalConversations: 0,
    totalSaves: 0,
    byPlatform: {}
  };

  if (isNew) stats.totalConversations++;
  stats.totalSaves++;
  stats.byPlatform[platform] = (stats.byPlatform[platform] || 0) + (isNew ? 1 : 0);
  stats.lastSaveTime = new Date().toISOString();

  await chrome.storage.local.set({ [STORAGE_KEY_STATS]: stats });
}

// Get all conversations (index only, for listing)
async function getConversationIndex() {
  const indexData = await chrome.storage.local.get(STORAGE_KEY_INDEX);
  const index = indexData[STORAGE_KEY_INDEX] || {};
  return Object.values(index).sort((a, b) =>
    new Date(b.lastUpdated) - new Date(a.lastUpdated)
  );
}

// Get a single full conversation
async function getConversation(id) {
  const convKey = `conv_${id}`;
  const data = await chrome.storage.local.get(convKey);
  return data[convKey] || null;
}

// Delete a conversation
async function deleteConversation(id) {
  const convKey = `conv_${id}`;
  await chrome.storage.local.remove(convKey);

  const indexData = await chrome.storage.local.get(STORAGE_KEY_INDEX);
  const index = indexData[STORAGE_KEY_INDEX] || {};
  delete index[id];
  await chrome.storage.local.set({ [STORAGE_KEY_INDEX]: index });

  const totalConversations = Object.keys(index).length;
  chrome.action.setBadgeText({ text: totalConversations > 0 ? String(totalConversations) : '' });
}

// Export all conversations as JSON
async function exportAll() {
  const index = await getConversationIndex();
  const conversations = [];

  for (const entry of index) {
    const conv = await getConversation(entry.id);
    if (conv) conversations.push(conv);
  }

  return {
    exportDate: new Date().toISOString(),
    version: '1.0.0',
    totalConversations: conversations.length,
    conversations
  };
}

// Search conversations
async function searchConversations(query) {
  const index = await getConversationIndex();
  const lowerQuery = query.toLowerCase();

  // First filter by title
  const titleMatches = index.filter(entry =>
    entry.title.toLowerCase().includes(lowerQuery)
  );

  // If we need deeper search, look through message contents
  if (titleMatches.length === 0) {
    const contentMatches = [];
    for (const entry of index) {
      const conv = await getConversation(entry.id);
      if (conv && conv.messages.some(m => m.content.toLowerCase().includes(lowerQuery))) {
        contentMatches.push(entry);
      }
    }
    return contentMatches;
  }

  return titleMatches;
}

// Check storage usage
async function getStorageUsage() {
  const data = await chrome.storage.local.get(null);
  const json = JSON.stringify(data);
  const bytesUsed = new Blob([json]).size;
  const quotaBytes = chrome.storage.local.QUOTA_BYTES || 10485760; // 10MB default
  const index = await getConversationIndex();
  return {
    bytesUsed,
    quotaBytes,
    percentUsed: Math.round((bytesUsed / quotaBytes) * 100),
    conversationCount: index.length,
    formattedUsed: formatBytes(bytesUsed),
    formattedQuota: formatBytes(quotaBytes)
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// Generate a short hash fingerprint from a string
function generateFingerprint(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  // Convert to base36 for a compact alphanumeric code
  return Math.abs(hash).toString(36);
}

// Build memory markdown for injection into AI chats
// excludePlatform: skip conversations from this platform (e.g. don't load Claude convos into Claude)
async function buildMemoryMarkdown(excludePlatform) {
  const index = await getConversationIndex();
  if (index.length === 0) return null;

  const conversations = [];
  for (const entry of index) {
    const conv = await getConversation(entry.id);
    if (!conv) continue;
    if (excludePlatform && conv.platform === excludePlatform) continue;
    if (!conv.messages || conv.messages.length === 0) continue;

    // Check if the conversation started with a memory dump injection
    const firstMsg = conv.messages[0].content || '';
    const isMemoryDump = /\[AIM:[a-z0-9]+\]/i.test(firstMsg)
      || firstMsg.includes('# My AI Conversation History');

    if (isMemoryDump) {
      // Skip the memory dump message + the AI's response to it
      // Only keep messages that came AFTER that initial exchange
      let skipUntil = 1; // skip at least the dump message
      // If next message is from assistant, skip that too (it's just analyzing the dump)
      if (conv.messages.length > 1 && conv.messages[1].role === 'assistant') {
        skipUntil = 2;
      }
      conv.messages = conv.messages.slice(skipUntil);
    }

    // Only include if there are real messages left
    if (conv.messages.length > 0) {
      conversations.push(conv);
    }
  }

  if (conversations.length === 0) return null;

  const platformNames = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' };
  const platformCounts = {};
  for (const conv of conversations) {
    const name = platformNames[conv.platform] || conv.platform;
    platformCounts[name] = (platformCounts[name] || 0) + 1;
  }
  const platformSummary = Object.entries(platformCounts)
    .map(([name, count]) => `${count} ${name}`)
    .join(', ');

  const date = new Date().toISOString().slice(0, 10);

  // Build a content fingerprint from conversation IDs + counts so we can detect if memory was already loaded
  const fingerprintSource = conversations.map(c => c.id + ':' + (c.messages ? c.messages.length : 0)).join(',');
  const fingerprint = generateFingerprint(fingerprintSource);

  let md = `[AIM:${fingerprint}]\n`;
  md += `# My AI Conversation History\n`;
  md += `> Generated on ${date} | ${conversations.length} conversations (${platformSummary})\n\n`;
  md += `This is my conversation history across AI platforms. Use it to understand my background, interests, communication style, and what I've been working on.\n`;

  // Sort newest first
  conversations.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

  for (const conv of conversations) {
    const platform = platformNames[conv.platform] || conv.platform;
    const convDate = new Date(conv.lastUpdated).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
    const msgCount = conv.messages ? conv.messages.length : 0;

    md += `\n---\n\n`;
    md += `## "${conv.title}" — ${platform}, ${convDate} (${msgCount} messages)\n\n`;

    if (conv.messages && conv.messages.length > 0) {
      for (const msg of conv.messages) {
        const role = msg.role === 'human' ? 'Me' : platform;
        md += `**${role}:** ${msg.content}\n\n`;
      }
    }
  }

  return md;
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    switch (message.type) {
      case 'SAVE_CONVERSATION':
        return await saveConversation(message.conversation);

      case 'GET_INDEX':
        return await getConversationIndex();

      case 'GET_CONVERSATION':
        return await getConversation(message.id);

      case 'DELETE_CONVERSATION':
        await deleteConversation(message.id);
        return { deleted: true };

      case 'EXPORT_ALL':
        return await exportAll();

      case 'SEARCH':
        return await searchConversations(message.query);

      case 'GET_STATS':
        const statsData = await chrome.storage.local.get(STORAGE_KEY_STATS);
        return statsData[STORAGE_KEY_STATS] || { totalConversations: 0, totalSaves: 0, byPlatform: {} };

      case 'GET_STORAGE_USAGE':
        return await getStorageUsage();

      case 'CLEAR_ALL':
        await chrome.storage.local.clear();
        chrome.action.setBadgeText({ text: '' });
        return { cleared: true };

      case 'GET_SETTING': {
        const settingData = await chrome.storage.local.get('ai_memory_settings');
        const settings = settingData['ai_memory_settings'] || {};
        return settings[message.key] ?? null;
      }

      case 'SET_SETTING': {
        const settingsData = await chrome.storage.local.get('ai_memory_settings');
        const allSettings = settingsData['ai_memory_settings'] || {};
        allSettings[message.key] = message.value;
        await chrome.storage.local.set({ 'ai_memory_settings': allSettings });
        return { saved: true };
      }

      case 'GET_MEMORY_MARKDOWN':
        return await buildMemoryMarkdown(message.excludePlatform);

      default:
        return { error: 'Unknown message type' };
    }
  };

  handler().then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });

  return true; // Keep message channel open for async response
});

// Initialize badge on install and re-inject content scripts into open tabs
chrome.runtime.onInstalled.addListener(async () => {
  const index = await getConversationIndex();
  const count = index.length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#6B5CE7' });
  }

  // Re-inject content scripts into already-open matching tabs
  // (content scripts don't survive extension reload)
  const patterns = [
    { urlPattern: 'https://claude.ai/*', scripts: ['scripts/extractor-claude.js', 'scripts/content.js'] },
    { urlPattern: 'https://chat.openai.com/*', scripts: ['scripts/extractor-chatgpt.js', 'scripts/content.js'] },
    { urlPattern: 'https://chatgpt.com/*', scripts: ['scripts/extractor-chatgpt.js', 'scripts/content.js'] },
    { urlPattern: 'https://gemini.google.com/*', scripts: ['scripts/extractor-gemini.js', 'scripts/content.js'] }
  ];

  for (const { urlPattern, scripts } of patterns) {
    try {
      const tabs = await chrome.tabs.query({ url: urlPattern });
      for (const tab of tabs) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: scripts
        }).catch(() => {}); // Ignore errors for tabs that can't be injected
      }
    } catch {}
  }
});
