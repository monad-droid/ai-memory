# AI Memory - Conversation Saver

A Chrome/Brave extension that automatically saves your conversations from Claude, ChatGPT, and Gemini locally. Never lose a thought again.

## Features

- **Auto-save**: Conversations are captured automatically as you chat
- **Multi-platform**: Works with Claude (claude.ai), ChatGPT (chatgpt.com), and Gemini (gemini.google.com)
- **Local storage**: All data stays in your browser - nothing is sent to external servers
- **Search**: Find any past conversation by title or content
- **Export**: Download conversations as JSON or Markdown
- **Bulk export**: Export your entire conversation history at once

## Installation

1. Clone or download this repository
2. Open Chrome/Brave and go to `chrome://extensions/`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `ai-memory` folder
5. The extension icon will appear in your toolbar

## How It Works

- When you visit Claude, ChatGPT, or Gemini, the extension monitors the page for conversation content
- Every 10 seconds (if changes are detected), the conversation is saved to `chrome.storage.local`
- Conversations are also saved when you navigate away from the page
- Click the extension icon to browse, search, and manage your saved conversations

## Usage

- **Auto-save**: Just use Claude, ChatGPT, or Gemini as normal. Conversations save automatically.
- **Manual save**: Click the extension icon and hit "Save Now" to force-capture the current page
- **View a conversation**: Click any conversation in the popup to open the full viewer
- **Export**: Use the Export button in the popup for bulk JSON export, or export individual conversations as JSON/Markdown from the viewer
- **Search**: Type in the search box to filter by conversation title
- **Filter by platform**: Use the tabs (All / Claude / ChatGPT / Gemini) to filter

## File Structure

```
ai-memory/
├── manifest.json              # Extension manifest (Manifest V3)
├── scripts/
│   ├── background.js          # Service worker - storage & coordination
│   ├── content.js             # Shared content script - auto-save logic
│   ├── extractor-claude.js    # Claude.ai conversation extractor
│   ├── extractor-chatgpt.js   # ChatGPT conversation extractor
│   └── extractor-gemini.js    # Gemini conversation extractor
├── pages/
│   ├── popup.html             # Extension popup
│   ├── popup.js               # Popup logic
│   ├── viewer.html            # Full conversation viewer
│   └── viewer.js              # Viewer logic
├── styles/
│   ├── popup.css              # Popup styles
│   └── viewer.css             # Viewer styles
└── icons/
    ├── icon.svg               # Source icon
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Privacy

All conversation data is stored locally in your browser using `chrome.storage.local`. No data is ever transmitted to any external server. The extension only runs on the specific AI chat domains listed in the manifest.

## License

MIT
