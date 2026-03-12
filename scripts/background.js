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

  // Only update if message count increased (conversation grew)
  if (existingEntry && conversation.messageCount <= existingEntry.messageCount) {
    return { saved: false, reason: 'no_new_messages' };
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

      default:
        return { error: 'Unknown message type' };
    }
  };

  handler().then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });

  return true; // Keep message channel open for async response
});

// Initialize badge on install
chrome.runtime.onInstalled.addListener(async () => {
  const index = await getConversationIndex();
  const count = index.length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#6B5CE7' });
  }
});
