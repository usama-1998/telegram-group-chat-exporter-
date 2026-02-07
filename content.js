
// State
let isScraping = false;
let scrapedMessages = new Map(); // using Map to ensure unique by ID
let scrollInterval = null;
let lastHeight = 0;
let sameHeightCount = 0;
let autoScrollEnabled = true;
let currentFormat = 'json';
let dateContextMap = new Map(); // Maps message IDs to their date context

// Listeners
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'START_SCRAPING') {
        startScraping(request.format);
    } else if (request.type === 'STOP_SCRAPING') {
        stopScraping();
    } else if (request.type === 'GET_STATUS') {
        sendResponse({
            isScraping,
            count: scrapedMessages.size,
            hasData: scrapedMessages.size > 0
        });
    }
    return true; // async response possibility
});

function startScraping(format) {
    if (isScraping) return;
    isScraping = true;
    currentFormat = format || 'json';
    scrapedMessages.clear();
    dateContextMap.clear();
    currentDateContext = "";
    lastHeight = 0;
    sameHeightCount = 0;

    console.log("Telegram Chat Export: Started");

    scrollInterval = setInterval(() => {
        if (!isScraping) return;

        parseVisibleMessages();

        // Report progress
        chrome.runtime.sendMessage({
            type: 'UPDATE_COUNT',
            count: scrapedMessages.size
        }).catch(() => { });

        if (autoScrollEnabled) {
            performScrollUp();
        }
    }, 1500);
}

function stopScraping() {
    isScraping = false;
    clearInterval(scrollInterval);

    // Format and return data
    const data = exportData();
    chrome.runtime.sendMessage({
        type: 'SCRAPING_FINISHED',
        count: scrapedMessages.size,
        data: data
    });
}

// Track the current date context as we parse messages
let currentDateContext = "";

// Helper function to find date from date separator bubbles
function findDateFromSeparator(node) {
    // STRATEGY 1: Check if message is inside a .message-date-group container (Telegram Web A)
    // In Web A, the structure is:
    // .message-date-group
    //   ├── .sticky-date ("Today", "January 22", etc.)
    //   └── .Message (multiple messages)
    const dateGroup = node.closest('.message-date-group');
    if (dateGroup) {
        const stickyDate = dateGroup.querySelector('.sticky-date');
        if (stickyDate) {
            let dateText = stickyDate.querySelector('span')?.innerText?.trim() || stickyDate.innerText?.trim();
            if (dateText && dateText.length < 50) {
                return dateText;
            }
        }
    }

    // STRATEGY 2: Check for sticky-date as a previous sibling at the parent level
    // Some layouts have date groups as siblings to messages
    const parent = node.parentElement;
    if (parent) {
        let prevGroup = node.previousElementSibling;
        let searchCount = 0;
        while (prevGroup && searchCount < 10) {
            if (prevGroup.classList.contains('message-date-group')) {
                const stickyDate = prevGroup.querySelector('.sticky-date');
                if (stickyDate) {
                    let dateText = stickyDate.querySelector('span')?.innerText?.trim() || stickyDate.innerText?.trim();
                    if (dateText && dateText.length < 50) {
                        return dateText;
                    }
                }
            }
            // Direct sticky-date sibling
            if (prevGroup.classList.contains('sticky-date')) {
                let dateText = prevGroup.querySelector('span')?.innerText?.trim() || prevGroup.innerText?.trim();
                if (dateText && dateText.length < 50) {
                    return dateText;
                }
            }
            prevGroup = prevGroup.previousElementSibling;
            searchCount++;
        }
    }

    // STRATEGY 3: Fall back to sibling search for Telegram Web K
    let prevSibling = node.previousElementSibling;
    let searchCount = 0;

    while (prevSibling && searchCount < 50) {
        // Check for Telegram Web A's sticky-date class
        const isStickyDate = prevSibling.classList.contains('sticky-date');

        // Check for Telegram Web K's date separators
        const isDateSeparator =
            isStickyDate ||
            prevSibling.classList.contains('service') ||
            prevSibling.classList.contains('bubble-date') ||
            prevSibling.classList.contains('bubble-date-group') ||
            prevSibling.classList.contains('date-group') ||
            prevSibling.classList.contains('is-date') ||
            (prevSibling.classList.contains('bubble') && prevSibling.classList.contains('is-date')) ||
            prevSibling.querySelector('.service-msg, .bubble-service, .date-group-title, .sticky-date');

        if (isDateSeparator) {
            // For sticky-date, the text is often in a span inside
            let dateText = "";
            const spanEl = prevSibling.querySelector('span');
            if (spanEl) {
                dateText = spanEl.innerText?.trim();
            }
            if (!dateText) {
                dateText = prevSibling.innerText?.trim();
            }

            // Date separators are usually short text without colons (no time format)
            // and contain date-like patterns
            if (dateText && dateText.length < 50) {
                // Check if it looks like a date (contains month name or date pattern)
                const monthPattern = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|\d{1,2}[\/\-\.]\d{1,2})/i;
                if (monthPattern.test(dateText) || /^\d{1,2}\s+\w+(\s+\d{4})?$/.test(dateText) || /^\w+\s+\d{1,2}/.test(dateText)) {
                    return dateText;
                }
                // Also check for "Today", "Yesterday" etc.
                if (/^(today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(dateText)) {
                    return dateText;
                }
            }
        }

        prevSibling = prevSibling.previousElementSibling;
        searchCount++;
    }

    return null;
}

// Helper function to extract date from message-time text
// Telegram Web A shows "Dec 1, 2025 at 07:30 AM" for older messages
function parseMessageTime(timeText) {
    if (!timeText) return { date: "", time: "" };

    timeText = timeText.trim();

    // Pattern: "Dec 1, 2025 at 07:30 AM" or "December 1, 2025 at 07:30 AM"
    const fullDateTimePattern = /^(.+?)\s+at\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i;
    const match = timeText.match(fullDateTimePattern);

    if (match) {
        return {
            date: match[1].trim(),
            time: match[2].trim()
        };
    }

    // Just time: "07:30 AM" or "19:30"
    const timeOnlyPattern = /^(\d{1,2}:\d{2}\s*(?:AM|PM)?)$/i;
    if (timeOnlyPattern.test(timeText)) {
        return {
            date: "",
            time: timeText
        };
    }

    // Fallback: return as time
    return {
        date: "",
        time: timeText
    };
}

function parseVisibleMessages() {
    let container = document;

    // Attempt to find the main chat container
    const bubbles = document.querySelector('.bubbles, .MessageList, .history, .bubbles-group');
    if (bubbles) {
        container = bubbles;
    }

    // Selectors for different TG Web versions
    let messageNodes = container.querySelectorAll('.message, .bubble, .Message');

    messageNodes.forEach(node => {
        // Skip sidebar/contact list items
        if (node.closest('.sidebar-header') || node.closest('.chat-list') || node.closest('.left-column')) return;

        // Try to get stable ID
        const id = node.getAttribute('data-message-id') || node.getAttribute('data-mid') || node.id || Math.random().toString();

        if (scrapedMessages.has(id)) return;

        // --- EXTRACT DATE AND TIME ---
        let time = "";
        let calendarDate = "";

        // First, extract the TIME from within the message bubble
        const timeSelectors = [
            '.message-time',
            '.time',
            '.time-inner',
            '.inner-time',
            '.bubble-time',
            '.time-part'
        ];

        let timeNode = null;
        for (const sel of timeSelectors) {
            timeNode = node.querySelector(sel);
            if (timeNode) break;
        }

        if (timeNode) {
            // Get the time text - could be "03:01 PM" or "Dec 1, 2025 at 07:30 AM"
            const rawTimeText = timeNode.innerText?.trim() ||
                timeNode.getAttribute('title')?.trim() ||
                "";

            // Parse the time text to extract date and time separately
            const parsed = parseMessageTime(rawTimeText);
            time = parsed.time;
            if (parsed.date) {
                calendarDate = parsed.date;
            }
        }

        // Try data-timestamp for full datetime (if available)
        const timestampAttr = node.getAttribute('data-timestamp') ||
            node.getAttribute('data-time');
        if (timestampAttr && !calendarDate) {
            const ts = parseInt(timestampAttr);
            if (!isNaN(ts)) {
                const dateObj = ts < 10000000000 ? new Date(ts * 1000) : new Date(ts);
                // Extract both date and time from timestamp
                calendarDate = dateObj.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                if (!time) {
                    time = dateObj.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            }
        }

        // If we still don't have a calendar date, look for date separator bubbles
        if (!calendarDate) {
            const separatorDate = findDateFromSeparator(node);
            if (separatorDate) {
                calendarDate = separatorDate;
                // Update the current date context for future messages
                currentDateContext = separatorDate;
            } else if (currentDateContext) {
                // Use the last known date context
                calendarDate = currentDateContext;
            }
        } else {
            // Update current date context with what we found
            currentDateContext = calendarDate;
        }

        // Combine date and time into a full date string
        let date = "";
        if (calendarDate && time) {
            date = `${calendarDate}, ${time}`;
        } else if (calendarDate) {
            date = calendarDate;
        } else if (time) {
            date = time;
        }

        // --- EXTRACT SENDER ---
        let sender = "Unknown";

        // PRIORITY 1: Check if this is an outgoing message (your own message)
        if (node.classList.contains('own')) {
            sender = "You";
        } else {
            // PRIORITY 2: Look for sender node that is NOT inside a junk container (reply/forward)
            const senderSelectors = ['.sender-title', '.name', '.message-title', '.peer-title', '.message-title-name'];
            const junkContainers = ['.EmbeddedMessage', '.message-subheader', '.reply', '.reply-wrapper', '.forward-title-container'];

            let senderNode = null;
            for (const sel of senderSelectors) {
                const nodes = node.querySelectorAll(sel);
                for (const n of nodes) {
                    // Make sure this sender node is NOT inside a junk container
                    const isInsideJunk = junkContainers.some(junk => n.closest(junk));
                    if (!isInsideJunk) {
                        senderNode = n;
                        break;
                    }
                }
                if (senderNode) break;
            }

            if (senderNode) {
                sender = senderNode.innerText?.trim();
            } else {
                // PRIORITY 3: For consecutive messages without visible sender, look at previous siblings
                // Find the first message in this group that has a sender name
                let prevSibling = node.previousElementSibling;
                let searchCount = 0;

                while (prevSibling && searchCount < 20) {
                    // Stop if we hit a date separator or non-message element
                    if (!prevSibling.classList.contains('Message') &&
                        !prevSibling.classList.contains('message-list-item')) {
                        break;
                    }

                    // Check if this sibling has a sender name
                    for (const sel of senderSelectors) {
                        const nodes = prevSibling.querySelectorAll(sel);
                        for (const n of nodes) {
                            const isInsideJunk = junkContainers.some(junk => n.closest(junk));
                            if (!isInsideJunk) {
                                sender = n.innerText?.trim();
                                break;
                            }
                        }
                        if (sender !== "Unknown") break;
                    }

                    // Check if sibling is own message
                    if (sender === "Unknown" && prevSibling.classList.contains('own')) {
                        sender = "You";
                    }

                    if (sender !== "Unknown") break;

                    prevSibling = prevSibling.previousElementSibling;
                    searchCount++;
                }
            }
        }

        // --- EXTRACT TEXT (CLEAN STRATEGY) ---
        let text = "";

        // Priority: Look for specific content block first
        let contentNode = node.querySelector('.text-content, .message-text, .content-inner, .bubble-content');

        // If we found a specific content node, work on that. Else use the whole node (fallback).
        let targetNode = contentNode || node;

        // Clone to avoid modifying DOM
        let clone = targetNode.cloneNode(true);

        // Remove known junk/metadata from clone
        const junkSelectors = [
            '.message-time', '.time', '.inner-time', // Time
            '.sender-title', '.name', '.message-title', '.peer-title', // Sender
            '.reply', '.reply-wrapper', // Quoted replies (Web K)
            '.EmbeddedMessage', '.embedded-text-wrapper', '.embedded-sender', // Quoted replies (Web A)
            '.message-subheader', // Reply preview container (Web A)
            '.reply-markup', // Bot buttons and inline keyboards
            '.avatar', '.peer-avatar',
            '.reactions', '.reaction-list',
            '.forwarded-message', '.forward-title-container', // Forward headers
            '.admin-badge', '.badge', // Badges
            'svg', 'img' // Icons
        ];

        junkSelectors.forEach(sel => {
            clone.querySelectorAll(sel).forEach(el => el.remove());
        });

        // innerText preserves newlines for block elements and <br>
        text = clone.innerText;

        // Clean up
        text = text.trim();
        sender = sender.trim();
        date = date.trim();

        // Fallback checks
        if (!date && text.match(/\d{2}:\d{2}\s?(AM|PM)?$/i)) {
            const match = text.match(/\d{2}:\d{2}\s?(AM|PM)?$/i);
            if (match) {
                date = match[0];
                text = text.replace(match[0], '').trim();
            }
        }

        if (text) {
            scrapedMessages.set(id, {
                id,
                sender,
                text,
                date,
                timestamp: new Date().toISOString()
            });
        }
    });
}

function performScrollUp() {
    // Find the scrollable container
    const bubbles = document.querySelector('.bubbles, .MessageList, .history, .bubbles-group');
    let scrollContainer = bubbles;

    // Fallback search
    if (!scrollContainer || (scrollContainer.scrollHeight <= scrollContainer.clientHeight)) {
        scrollContainer = Array.from(document.querySelectorAll('div')).find(div => {
            const style = window.getComputedStyle(div);
            return (style.overflowY === 'auto' || style.overflowY === 'scroll') && div.scrollHeight > div.clientHeight + 100;
        });
    }

    if (scrollContainer) {
        if (scrollContainer.scrollTop === 0) {
            if (scrollContainer.scrollHeight === lastHeight) {
                sameHeightCount++;
            } else {
                sameHeightCount = 0;
                lastHeight = scrollContainer.scrollHeight;
                // Wiggle
                scrollContainer.scrollTop = 10;
            }
        } else {
            // Not at top, scroll to top
            if (scrollContainer.scrollTop > 3000) {
                scrollContainer.scrollTop = 500;
            } else {
                scrollContainer.scrollTop = 0;
            }
            sameHeightCount = 0;
        }

        if (sameHeightCount > 15) {
            console.log("Auto-scroll: No new content loading. Might be at the start.");
        }
    } else {
        window.scrollBy(0, -1000);
    }
}

function exportData() {
    // Sort messages by ID (Chronological: Oldest -> Newest)
    const messages = Array.from(scrapedMessages.values()).sort((a, b) => {
        // Try integers stripping non-digits
        const idA = parseInt(a.id.replace(/\D/g, '')) || 0;
        const idB = parseInt(b.id.replace(/\D/g, '')) || 0;
        return idA - idB;
    });

    let content = "";
    let mime = "text/plain";
    let ext = "txt";

    switch (currentFormat) {
        case 'json':
            content = JSON.stringify(messages, null, 2);
            mime = 'application/json';
            ext = 'json';
            break;

        case 'csv':
            const headers = ["ID", "Timestamp", "Sender", "Message"];
            const csvRows = [headers.join(",")];

            messages.forEach(msg => {
                const safeSender = (msg.sender || "").replace(/"/g, '""');
                const safeText = (msg.text || "").replace(/"/g, '""');
                const safeDate = (msg.date || "").replace(/"/g, '""');

                const row = [
                    `"${msg.id}"`,
                    `"${safeDate}"`,
                    `"${safeSender}"`,
                    `"${safeText}"`
                ];
                csvRows.push(row.join(","));
            });
            content = csvRows.join("\n");
            mime = 'text/csv';
            ext = 'csv';
            break;

        case 'html':
            content = `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Telegram Chat History</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #eef1f5; padding: 20px; margin: 0; }
    .container { max-width: 700px; margin: 0 auto; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
    h1 { text-align: center; color: #333; font-size: 24px; margin-bottom: 20px; }
    .stat { text-align: center; color: #777; font-size: 14px; margin-bottom: 30px; }
    .msg { display: flex; flex-direction: column; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #f0f0f0; }
    .msg:last-child { border-bottom: none; }
    .header { display: flex; justify-content: space-between; margin-bottom: 6px; font-size: 13px; }
    .sender { font-weight: 700; color: #3390ec; }
    .time { color: #999; font-size: 12px; }
    .content { color: #111; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
</style>
</head>
<body>
<div class="container">
    <h1>Chat History</h1>
    <div class="stat">Exported ${messages.length} messages</div>
    
${messages.map(m => `
    <div class="msg">
        <div class="header">
            <span class="sender">${m.sender}</span>
            <span class="time">${m.date}</span>
        </div>
        <div class="content">${m.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    </div>`).join('')}

</div>
</body>
</html>`;
            mime = 'text/html';
            ext = 'html';
            break;

        case 'txt':
        default:
            // Formatting for nice text output
            content = messages.map(m => {
                const dateStr = m.date ? ` [${m.date}]` : "";
                return `${m.sender}${dateStr}\n\n${m.text}\n`; // Double newline for clarity
            }).join("\n------------------------------------------------\n");
            mime = 'text/plain';
            ext = 'txt';
            break;
    }

    return {
        content: content,
        mime: mime,
        filename: `telegram_chat_export.${ext}`
    };
}
