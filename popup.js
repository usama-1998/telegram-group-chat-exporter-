
document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const views = {
        setup: document.getElementById('setup-view'),
        processing: document.getElementById('processing-view'),
        completion: document.getElementById('completion-view')
    };

    const elements = {
        startBtn: document.getElementById('start-btn'),
        stopBtn: document.getElementById('stop-btn'),
        downloadBtn: document.getElementById('download-btn'),
        resetBtn: document.getElementById('reset-btn'),
        statusText: document.getElementById('status-text'),
        msgCount: document.getElementById('msg-count'),
        finalCount: document.getElementById('final-count'),
        formatSelect: document.getElementById('format')
    };

    let currentData = null; // Store data for download if popup is kept open

    // Helper to switch views
    function showView(viewName) {
        Object.values(views).forEach(el => el.classList.add('hidden'));
        views[viewName].classList.remove('hidden');
    }

    // Helper to send message to active tab
    async function sendMessageToTab(message) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        try {
            return await chrome.tabs.sendMessage(tab.id, message);
        } catch (e) {
            console.error("Could not send message to tab", e);
            // If we can't connect, maybe inject the script or warn user
            elements.statusText.textContent = "Error: Refresh Telegram tab";
        }
    }

    // Check status on load
    try {
        const response = await sendMessageToTab({ type: 'GET_STATUS' });
        if (response && response.isScraping) {
            showView('processing');
            elements.msgCount.textContent = response.count;
        } else if (response && response.hasData) {
            // Maybe they finished but didn't download?
            // For now, simpler to just reset or show setup
            showView('setup');
        }
    } catch (e) {
        console.log("Content script likely not ready yet");
    }

    // Event Listeners
    elements.startBtn.addEventListener('click', () => {
        const format = elements.formatSelect.value;
        sendMessageToTab({ type: 'START_SCRAPING', format });
        showView('processing');
        elements.msgCount.textContent = '0';
        elements.statusText.textContent = 'Starting...';
    });

    elements.stopBtn.addEventListener('click', () => {
        sendMessageToTab({ type: 'STOP_SCRAPING' });
        elements.statusText.textContent = 'Stopping...';
        // The content script will send a 'FINISHED' message, we wait for that
    });

    elements.downloadBtn.addEventListener('click', () => {
        if (currentData) {
            downloadFile(currentData.content, currentData.filename, currentData.mime);
        }
    });

    elements.resetBtn.addEventListener('click', () => {
        showView('setup');
        currentData = null;
    });

    // Listen for updates from content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'UPDATE_COUNT') {
            elements.msgCount.textContent = request.count;
            elements.statusText.textContent = 'Scraping...';
        } else if (request.type === 'SCRAPING_FINISHED') {
            showView('completion');
            elements.finalCount.textContent = request.count;
            currentData = request.data;
        } else if (request.type === 'ERROR') {
            alert("Error: " + request.message);
            showView('setup');
        }
    });

    function downloadFile(content, filename, mimeType) {
        console.log("Attempting to download:", filename);
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: true
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download failed:", chrome.runtime.lastError);
                alert("Download failed: " + chrome.runtime.lastError.message);
            } else {
                console.log("Download started, ID:", downloadId);
            }
        });
    }
});
