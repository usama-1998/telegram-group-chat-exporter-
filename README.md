# Telegram Group Chat Exporter

A Chrome extension to export Telegram Web group chat messages to various formats (JSON, CSV, HTML, TXT).

## Features

- **Multiple Export Formats**: Export chats to JSON, CSV, HTML, or plain text
- **Auto-Scroll**: Automatically scrolls through chat history to capture all messages
- **Date & Time Extraction**: Captures both message time and calendar dates from date separator bubbles
- **Clean Text Extraction**: Removes metadata, reactions, and other UI elements for clean message text
- **Chronological Sorting**: Messages are sorted from oldest to newest

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your toolbar

## Usage

1. Open [Telegram Web](https://web.telegram.org) and navigate to a group chat
2. Click the extension icon in your toolbar
3. Select your preferred export format (JSON, CSV, HTML, or TXT)
4. Click "Start Export" - the extension will auto-scroll to capture messages
5. Click "Stop & Download" when you've captured enough messages
6. The file will be downloaded automatically

## Export Formats

| Format | Description |
|--------|-------------|
| **JSON** | Full structured data with all metadata |
| **CSV** | Spreadsheet-compatible with ID, Timestamp, Sender, Message columns |
| **HTML** | Nicely formatted web page for viewing |
| **TXT** | Plain text with sender and message content |

## Permissions

- `activeTab`: Access to the current Telegram Web tab
- `scripting`: Inject content script for message extraction
- `storage`: Save extension preferences
- `downloads`: Download exported files

## Notes

- Works with both Telegram Web A (`web.telegram.org/a`) and Web K (`web.telegram.org/k`)
- Large chats may take time to fully scroll and capture
- Dates are extracted using multiple strategies:
  - From `.message-date-group` containers (Web A)
  - From `.sticky-date` separator bubbles
  - From message time elements (e.g., "Dec 1, 2025 at 07:30 AM")
  - Date context is maintained across messages for consistent timestamping

## License

MIT License
