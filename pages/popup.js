// Popup script
'use strict';

const searchInput = document.getElementById('searchInput');
const conversationList = document.getElementById('conversationList');
const emptyState = document.getElementById('emptyState');
const filterTabs = document.getElementById('filterTabs');
const saveNowBtn = document.getElementById('saveNowBtn');
const exportBtn = document.getElementById('exportBtn');
const statsEl = document.getElementById('stats');
const storageWarning = document.getElementById('storageWarning');
const exportClearBtn = document.getElementById('exportClearBtn');

let currentFilter = 'all';
let allConversations = [];

const STORAGE_WARN_PERCENT = 70;
const STORAGE_CRITICAL_PERCENT = 90;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadConversations();
  await loadStats();
  await checkStorageUsage();
});

async function loadConversations() {
  allConversations = await sendMessage({ type: 'GET_INDEX' });
  renderConversations();
}

async function loadStats() {
  const stats = await sendMessage({ type: 'GET_STATS' });
  if (stats && stats.totalConversations > 0) {
    const parts = [`${stats.totalConversations} conversations`];
    if (stats.byPlatform) {
      for (const [platform, count] of Object.entries(stats.byPlatform)) {
        if (count > 0) {
          const name = { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini' }[platform] || platform;
          parts.push(`<span class="platform-count">${name}: ${count}</span>`);
        }
      }
    }
    statsEl.innerHTML = parts.join(' &middot; ');
  }
}

function renderConversations() {
  const query = searchInput.value.toLowerCase().trim();

  let filtered = allConversations;

  if (currentFilter !== 'all') {
    filtered = filtered.filter(c => c.platform === currentFilter);
  }

  if (query) {
    filtered = filtered.filter(c =>
      c.title.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    conversationList.innerHTML = '';
    conversationList.appendChild(emptyState);
    emptyState.style.display = 'flex';
    if (query) {
      emptyState.querySelector('p').textContent = 'No matching conversations.';
      emptyState.querySelector('.hint').textContent = 'Try a different search term.';
    } else {
      emptyState.querySelector('p').textContent = 'No saved conversations yet.';
      emptyState.querySelector('.hint').textContent = 'Visit Claude, ChatGPT, or Gemini to start saving!';
    }
    return;
  }

  emptyState.style.display = 'none';

  conversationList.innerHTML = filtered.map(conv => `
    <div class="conversation-item" data-id="${conv.id}" data-url="${conv.url}">
      <div class="platform-badge ${conv.platform}">${getPlatformLabel(conv.platform)}</div>
      <div class="conversation-info">
        <div class="conversation-title" title="${escapeHtml(conv.title)}">${escapeHtml(conv.title)}</div>
        <div class="conversation-meta">
          <span class="msg-count">${conv.messageCount} messages</span>
          <span>${timeAgo(conv.lastUpdated)}</span>
        </div>
      </div>
      <button class="delete-btn" data-id="${conv.id}" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  `).join('');

  // Click handlers
  conversationList.querySelectorAll('.conversation-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      const id = item.dataset.id;
      chrome.tabs.create({
        url: chrome.runtime.getURL(`pages/viewer.html?id=${encodeURIComponent(id)}`)
      });
    });
  });

  conversationList.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      await sendMessage({ type: 'DELETE_CONVERSATION', id });
      await loadConversations();
      await loadStats();
      showToast('Conversation deleted', 'success');
    });
  });
}

// Filter tabs
filterTabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;

  filterTabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  currentFilter = tab.dataset.filter;
  renderConversations();
});

// Search
searchInput.addEventListener('input', () => {
  renderConversations();
});

// Save now button
saveNowBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'MANUAL_SAVE' });
    if (response && response.success) {
      await sendMessage({ type: 'SAVE_CONVERSATION', conversation: response.conversation });
      await loadConversations();
      await loadStats();
      showToast('Conversation saved!', 'success');
    } else {
      showToast(response?.error || 'No AI conversation found on this page', 'error');
    }
  } catch {
    showToast('No AI conversation found on this page', 'error');
  }
});

// Export button
exportBtn.addEventListener('click', async () => {
  const data = await sendMessage({ type: 'EXPORT_ALL' });
  if (!data || !data.conversations || data.conversations.length === 0) {
    showToast('No conversations to export', 'error');
    return;
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-memory-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${data.conversations.length} conversations`, 'success');
});

// Storage usage check
async function checkStorageUsage() {
  const usage = await sendMessage({ type: 'GET_STORAGE_USAGE' });
  if (!usage) return;

  if (usage.percentUsed >= STORAGE_WARN_PERCENT) {
    storageWarning.style.display = 'flex';
    document.getElementById('storagePercent').textContent = usage.percentUsed;
    document.getElementById('storageDetail').textContent =
      `${usage.formattedUsed} of ${usage.formattedQuota} used (${usage.conversationCount} conversations)`;

    if (usage.percentUsed >= STORAGE_CRITICAL_PERCENT) {
      storageWarning.classList.add('critical');
    } else {
      storageWarning.classList.remove('critical');
    }
  } else {
    storageWarning.style.display = 'none';
  }
}

// Export & Clear handler
exportClearBtn.addEventListener('click', async () => {
  // First export
  const data = await sendMessage({ type: 'EXPORT_ALL' });
  if (!data || !data.conversations || data.conversations.length === 0) {
    showToast('No conversations to export', 'error');
    return;
  }

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-memory-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  // Then clear after a brief pause to ensure download started
  setTimeout(async () => {
    await sendMessage({ type: 'CLEAR_ALL' });
    allConversations = [];
    renderConversations();
    await loadStats();
    await checkStorageUsage();
    showToast(`Exported ${data.conversations.length} conversations and cleared storage`, 'success');
  }, 500);
});

// Helpers
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

function getPlatformLabel(platform) {
  return { claude: 'C', chatgpt: 'G', gemini: 'Ge' }[platform] || '?';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function showToast(message, type = 'success') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 2500);
}
