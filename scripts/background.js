// Background service worker - handles storage and coordination
'use strict';

// Storage keys
const STORAGE_KEY_CONVERSATIONS = 'ai_memory_conversations';
const STORAGE_KEY_INDEX = 'ai_memory_index';
const STORAGE_KEY_STATS = 'ai_memory_stats';

// All supported platforms and their new-chat URLs
const ALL_PLATFORMS = ['claude', 'chatgpt', 'gemini', 'grok'];
const PLATFORM_NAMES = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok' };
const PLATFORM_NEW_CHAT_URLS = {
  claude: 'https://claude.ai/new',
  chatgpt: 'https://chatgpt.com/',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com/'
};

// Check if a conversation is a memory dump (injected by this extension)
function isMemoryDumpConversation(conversation) {
  if (!conversation.messages || conversation.messages.length === 0) return false;
  const firstMsg = conversation.messages[0].content || '';
  return /\[AIM:[a-z0-9]+\]/i.test(firstMsg)
    || firstMsg.includes('# My AI Conversation History')
    || firstMsg.includes('# New AI Conversation History');
}

// Save a conversation to local storage
async function saveConversation(conversation) {
  // Reject memory dump conversations to prevent circular sync loops
  if (isMemoryDumpConversation(conversation)) {
    return { saved: false, reason: 'memory_dump' };
  }

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

  // Update badge to show unsent count
  await refreshBadge();

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

  await refreshBadge();
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

// Get the per-conversation tracking map for a platform
// Returns { conversationId: messageCount } for all convos already sent to that platform
// Each platform uses its own storage key to avoid race conditions when multiple
// tabs call updateSentTracker concurrently (e.g. during Upload All).
async function getSentTracker(platform) {
  const key = `ai_memory_sentTo_${platform}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || {};
}

// Update the tracker after successful injection
async function updateSentTracker(platform, sentMap) {
  const key = `ai_memory_sentTo_${platform}`;
  const data = await chrome.storage.local.get(key);
  const existing = data[key] || {};
  Object.assign(existing, sentMap);
  await chrome.storage.local.set({ [key]: existing });
}

// Filter messages from conversations that started as memory dumps
function stripMemoryDumpPrefix(conv) {
  if (!conv.messages || conv.messages.length === 0) return conv;
  const firstMsg = conv.messages[0].content || '';
  const isMemoryDump = /\[AIM:[a-z0-9]+\]/i.test(firstMsg)
    || firstMsg.includes('# My AI Conversation History')
    || firstMsg.includes('# New AI Conversation History');
  if (!isMemoryDump) return conv;
  // Skip the dump message + AI's response to it; keep only follow-up conversation
  let skipUntil = 1;
  if (conv.messages.length > 1 && conv.messages[1].role === 'assistant') {
    skipUntil = 2;
  }
  conv.messages = conv.messages.slice(skipUntil);
  return conv;
}

// Build memory markdown for injection into AI chats
// excludePlatform: skip conversations from this platform (e.g. don't load Claude convos into Claude)
// Returns { markdown, sentMap } where sentMap tracks what was included (to save after injection)
// Returns null if there's nothing new to inject
async function buildMemoryMarkdown(excludePlatform) {
  const index = await getConversationIndex();
  if (index.length === 0) return null;

  const alreadySent = await getSentTracker(excludePlatform);

  const conversations = [];
  const newSentMap = {}; // Track what we're including in this build

  for (const entry of index) {
    const conv = await getConversation(entry.id);
    if (!conv) continue;
    if (excludePlatform && conv.platform === excludePlatform) continue;
    if (!conv.messages || conv.messages.length === 0) continue;

    // Strip memory dump prefix (keep only follow-up conversation after a dump)
    stripMemoryDumpPrefix(conv);
    if (conv.messages.length === 0) continue;

    const msgCount = conv.messages.length;

    // Skip if this exact conversation + message count was already sent to this platform
    if (alreadySent[conv.id] && alreadySent[conv.id] >= msgCount) {
      continue;
    }

    conversations.push(conv);
    newSentMap[conv.id] = msgCount;
  }

  // Nothing new to inject
  if (conversations.length === 0) return null;

  const platformNames = PLATFORM_NAMES;
  const platformCounts = {};
  for (const conv of conversations) {
    const name = platformNames[conv.platform] || conv.platform;
    platformCounts[name] = (platformCounts[name] || 0) + 1;
  }
  const platformSummary = Object.entries(platformCounts)
    .map(([name, count]) => `${count} ${name}`)
    .join(', ');

  const date = new Date().toISOString().slice(0, 10);

  let md = `# New AI Conversation History\n`;
  md += `> Generated on ${date} | ${conversations.length} new/updated conversations (${platformSummary})\n\n`;
  md += `This is my latest conversation history across AI platforms. Use it to understand my background, interests, communication style, and what I've been working on.\n`;

  // Sort newest first
  conversations.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

  for (const conv of conversations) {
    const platform = platformNames[conv.platform] || conv.platform;
    const convDate = new Date(conv.lastUpdated).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
    const msgCount = conv.messages.length;
    const isUpdate = !!alreadySent[conv.id];

    md += `\n---\n\n`;
    md += `## "${conv.title}" — ${platform}, ${convDate} (${msgCount} messages)${isUpdate ? ' [UPDATED]' : ''}\n\n`;

    for (const msg of conv.messages) {
      const role = msg.role === 'human' ? 'Me' : platform;
      md += `**${role}:** ${msg.content}\n\n`;
    }
  }

  return { markdown: md, sentMap: newSentMap, targetPlatform: excludePlatform };
}

// Count how many conversations are not yet synced to ALL other platforms
async function getUnsentCount() {
  const index = await getConversationIndex();
  if (index.length === 0) return 0;

  // Load all sent trackers at once (each platform has its own storage key)
  const trackerKeys = ALL_PLATFORMS.map(p => `ai_memory_sentTo_${p}`);
  const trackerData = await chrome.storage.local.get(trackerKeys);
  const trackers = {};
  for (const p of ALL_PLATFORMS) {
    trackers[p] = trackerData[`ai_memory_sentTo_${p}`] || {};
  }

  let unsentCount = 0;
  for (const entry of index) {
    // Use messageCount from index — no need to load full conversation
    const msgCount = entry.messageCount;
    if (!msgCount || msgCount === 0) continue;

    // Check: has this conversation been sent to every OTHER platform?
    const targetPlatforms = ALL_PLATFORMS.filter(p => p !== entry.platform);

    for (const target of targetPlatforms) {
      const sentCount = trackers[target][entry.id] || 0;
      if (sentCount < msgCount) {
        unsentCount++;
        break; // Count this conv once even if missing from multiple platforms
      }
    }
  }

  return unsentCount;
}

// Refresh the badge to show unsent count
async function refreshBadge() {
  const count = await getUnsentCount();
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#6B5CE7' });
}

// Get upload-all status: which platforms need new conversations
async function getUploadAllStatus() {
  const index = await getConversationIndex();
  if (index.length === 0) return { platforms: [], totalUnsent: 0 };

  const trackerKeys = ALL_PLATFORMS.map(p => `ai_memory_sentTo_${p}`);
  const trackerData = await chrome.storage.local.get(trackerKeys);

  const platformStatus = {};
  for (const p of ALL_PLATFORMS) {
    platformStatus[p] = { unsent: 0, tracker: trackerData[`ai_memory_sentTo_${p}`] || {} };
  }

  for (const entry of index) {
    const msgCount = entry.messageCount;
    if (!msgCount || msgCount === 0) continue;
    const targets = ALL_PLATFORMS.filter(p => p !== entry.platform);
    for (const target of targets) {
      const sentCount = platformStatus[target].tracker[entry.id] || 0;
      if (sentCount < msgCount) {
        platformStatus[target].unsent++;
      }
    }
  }

  const platforms = ALL_PLATFORMS
    .filter(p => platformStatus[p].unsent > 0)
    .map(p => ({
      platform: p,
      name: PLATFORM_NAMES[p],
      unsent: platformStatus[p].unsent,
      url: PLATFORM_NEW_CHAT_URLS[p]
    }));

  const totalUnsent = platforms.reduce((sum, p) => sum + p.unsent, 0);
  return { platforms, totalUnsent };
}

// Get conversation index enriched with per-platform sync status
async function getIndexWithSync() {
  const index = await getConversationIndex();
  if (index.length === 0) return [];

  const trackerKeys = ALL_PLATFORMS.map(p => `ai_memory_sentTo_${p}`);
  const trackerData = await chrome.storage.local.get(trackerKeys);
  const trackers = {};
  for (const p of ALL_PLATFORMS) {
    trackers[p] = trackerData[`ai_memory_sentTo_${p}`] || {};
  }

  return index.map(entry => {
    const targets = ALL_PLATFORMS.filter(p => p !== entry.platform);
    const syncStatus = {};
    let allSynced = true;
    for (const target of targets) {
      const sentCount = trackers[target][entry.id] || 0;
      const synced = sentCount >= entry.messageCount;
      syncStatus[target] = synced;
      if (!synced) allSynced = false;
    }
    // The origin platform is always "synced" (it lives there)
    syncStatus[entry.platform] = true;
    return { ...entry, syncStatus, allSynced };
  });
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    switch (message.type) {
      case 'SAVE_CONVERSATION':
        return await saveConversation(message.conversation);

      case 'GET_INDEX':
        return await getConversationIndex();

      case 'GET_INDEX_WITH_SYNC':
        return await getIndexWithSync();

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

      case 'MARK_MEMORY_SENT':
        await updateSentTracker(message.platform, message.sentMap);
        await refreshBadge();
        return { saved: true };

      case 'GET_UNSENT_COUNT':
        return await getUnsentCount();

      case 'GET_UPLOAD_ALL_STATUS':
        return await getUploadAllStatus();

      case 'PURGE_MEMORY_DUMPS':
        await purgeMemoryDumps();
        return { purged: true };

      case 'REFRESH_BADGE':
        await refreshBadge();
        return { refreshed: true };

      default:
        return { error: 'Unknown message type' };
    }
  };

  handler().then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });

  return true; // Keep message channel open for async response
});

// Purge memory dump conversations from storage
// These are conversations created when memory was injected into an AI chat.
// They should never have been saved and they pollute the pending count forever.
async function purgeMemoryDumps() {
  const index = await getConversationIndex();
  let purged = 0;

  for (const entry of index) {
    const conv = await getConversation(entry.id);
    if (!conv) continue;
    if (isMemoryDumpConversation(conv)) {
      // Check if there's real conversation after stripping the dump prefix
      const stripped = stripMemoryDumpPrefix({ ...conv, messages: [...conv.messages] });
      if (stripped.messages.length === 0) {
        // Pure memory dump with no follow-up — delete entirely
        await deleteConversation(entry.id);
        purged++;
      } else {
        // Has real follow-up messages after the dump — mark it in the index
        // so count functions can handle the adjusted message count
        const convKey = `conv_${entry.id}`;
        const cleanConv = { ...conv, messages: stripped.messages, messageCount: stripped.messages.length };
        await chrome.storage.local.set({ [convKey]: cleanConv });

        // Update index with corrected message count
        const indexData = await chrome.storage.local.get(STORAGE_KEY_INDEX);
        const idx = indexData[STORAGE_KEY_INDEX] || {};
        if (idx[entry.id]) {
          idx[entry.id].messageCount = stripped.messages.length;
          await chrome.storage.local.set({ [STORAGE_KEY_INDEX]: idx });
        }
        purged++;
      }
    }
  }

  if (purged > 0) {
    console.log(`[AI Memory] Purged ${purged} memory dump conversations`);
    await refreshBadge();
  }
}

// Migrate sentTo trackers from nested ai_memory_settings to per-platform keys
async function migrateSentTrackers() {
  const data = await chrome.storage.local.get('ai_memory_settings');
  const settings = data['ai_memory_settings'] || {};
  const updates = {};
  let migrated = false;
  for (const p of ALL_PLATFORMS) {
    const oldKey = `sentTo_${p}`;
    if (settings[oldKey] && Object.keys(settings[oldKey]).length > 0) {
      const newKey = `ai_memory_sentTo_${p}`;
      // Merge with any existing data in the new key
      const existing = (await chrome.storage.local.get(newKey))[newKey] || {};
      Object.assign(existing, settings[oldKey]);
      updates[newKey] = existing;
      delete settings[oldKey];
      migrated = true;
    }
  }
  if (migrated) {
    updates['ai_memory_settings'] = settings;
    await chrome.storage.local.set(updates);
  }
}

// Initialize badge on install and re-inject content scripts into open tabs
chrome.runtime.onInstalled.addListener(async () => {
  await migrateSentTrackers();
  await purgeMemoryDumps();
  await refreshBadge();

  // Re-inject content scripts into already-open matching tabs
  const patterns = [
    { urlPattern: 'https://claude.ai/*', scripts: ['scripts/extractor-claude.js', 'scripts/content.js'] },
    { urlPattern: 'https://chat.openai.com/*', scripts: ['scripts/extractor-chatgpt.js', 'scripts/content.js'] },
    { urlPattern: 'https://chatgpt.com/*', scripts: ['scripts/extractor-chatgpt.js', 'scripts/content.js'] },
    { urlPattern: 'https://gemini.google.com/*', scripts: ['scripts/extractor-gemini.js', 'scripts/content.js'] },
    { urlPattern: 'https://x.com/i/grok*', scripts: ['scripts/extractor-grok.js', 'scripts/content.js'] },
    { urlPattern: 'https://grok.com/*', scripts: ['scripts/extractor-grok.js', 'scripts/content.js'] }
  ];

  for (const { urlPattern, scripts } of patterns) {
    try {
      const tabs = await chrome.tabs.query({ url: urlPattern });
      for (const tab of tabs) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: scripts
        }).catch(() => {});
      }
    } catch {}
  }
});

// Refresh badge on startup (not just install)
chrome.runtime.onStartup.addListener(async () => {
  await migrateSentTrackers();
  await purgeMemoryDumps();
  await refreshBadge();
});
