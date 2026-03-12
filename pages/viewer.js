// Conversation viewer page
'use strict';

const convTitle = document.getElementById('convTitle');
const convMeta = document.getElementById('convMeta');
const platformBadge = document.getElementById('platformBadge');
const messagesContainer = document.getElementById('messages');
const copyBtn = document.getElementById('copyBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const exportMdBtn = document.getElementById('exportMdBtn');
const backBtn = document.getElementById('backBtn');

let conversation = null;

document.addEventListener('DOMContentLoaded', loadConversation);

async function loadConversation() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) {
    messagesContainer.innerHTML = '<div class="loading">No conversation ID provided.</div>';
    return;
  }

  conversation = await sendMessage({ type: 'GET_CONVERSATION', id });

  if (!conversation) {
    messagesContainer.innerHTML = '<div class="loading">Conversation not found.</div>';
    return;
  }

  // Update header
  document.title = `${conversation.title} - AI Memory`;
  convTitle.textContent = conversation.title;
  convMeta.textContent = `${conversation.platformName} \u00b7 ${conversation.messageCount} messages \u00b7 Last updated ${formatDate(conversation.lastUpdated)}`;

  const platformLabels = { claude: 'C', chatgpt: 'G', gemini: 'Ge' };
  platformBadge.textContent = platformLabels[conversation.platform] || '?';
  platformBadge.className = `platform-badge ${conversation.platform}`;

  // Render messages
  renderMessages(conversation.messages);
}

function renderMessages(messages) {
  messagesContainer.innerHTML = messages.map(msg => `
    <div class="message ${msg.role}">
      <div class="message-role">${msg.role === 'human' ? 'You' : conversation.platformName}</div>
      <div class="message-content">${escapeHtml(msg.content)}</div>
    </div>
  `).join('');
}

// Copy as plain text
copyBtn.addEventListener('click', async () => {
  if (!conversation) return;

  const text = conversation.messages.map(msg => {
    const role = msg.role === 'human' ? 'You' : conversation.platformName;
    return `${role}:\n${msg.content}`;
  }).join('\n\n---\n\n');

  await navigator.clipboard.writeText(text);
  showToast('Copied to clipboard!');
});

// Export as JSON
exportJsonBtn.addEventListener('click', () => {
  if (!conversation) return;
  downloadFile(
    JSON.stringify(conversation, null, 2),
    `${slugify(conversation.title)}.json`,
    'application/json'
  );
});

// Export as Markdown
exportMdBtn.addEventListener('click', () => {
  if (!conversation) return;

  let md = `# ${conversation.title}\n\n`;
  md += `**Platform:** ${conversation.platformName}  \n`;
  md += `**Date:** ${formatDate(conversation.lastUpdated)}  \n`;
  md += `**Messages:** ${conversation.messageCount}  \n`;
  md += `**Source:** ${conversation.url}\n\n---\n\n`;

  conversation.messages.forEach(msg => {
    const role = msg.role === 'human' ? 'You' : conversation.platformName;
    md += `### ${role}\n\n${msg.content}\n\n---\n\n`;
  });

  downloadFile(md, `${slugify(conversation.title)}.md`, 'text/markdown');
});

// Back button
backBtn.addEventListener('click', (e) => {
  e.preventDefault();
  window.close();
});

// Helpers
function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleString();
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 2000);
}
