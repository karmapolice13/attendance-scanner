// ====================================================
// OFFLINE QUEUE & NETWORK MANAGEMENT ENGINE
// ====================================================

const SCRIPT_URL = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE"; // Replace with your deployment URL
const QUEUE_STORAGE_KEY = "attendance_offline_queue";

// Elements & Audio
const successAudio = document.getElementById("sound-success");
const errorAudio = document.getElementById("sound-error");
const queueBadge = document.getElementById("queue-status-badge");

// Initialize Queue on startup
let offlineQueue = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");
updateNetworkUI();

// Watch Network Connection Status
window.addEventListener("online", syncOfflineQueue);
window.addEventListener("offline", updateNetworkUI);

/**
 * Primary QR Scan Callback Handler
 */
function onScanSuccess(decodedText, decodedResult) {
  // Prevent rapid double-scans in short succession
  if (window.isProcessingScan) return;
  window.isProcessingScan = true;

  const scannedId = decodedText.trim();
  const scanData = {
    id: scannedId,
    timestamp: new Date().toISOString()
  };

  if (navigator.onLine) {
    // Online: Send immediately to Google Apps Script
    sendScanToBackend(scanData);
  } else {
    // Offline: Save to browser LocalStorage queue
    saveToOfflineQueue(scanData);
  }

  // Cooldown reset after 3 seconds
  setTimeout(() => {
    window.isProcessingScan = false;
  }, 3000);
}

/**
 * Send Scan Data to Google Apps Script
 */
function sendScanToBackend(scanData) {
  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ id: scanData.id })
  })
    .then(response => response.json())
    .then(data => {
      if (data.status === "success") {
        playSuccess(data.message);
      } else {
        playError(data.message || "ID Not Found in Masterlist");
      }
    })
    .catch(err => {
      // Handle mid-request network failure by queueing
      console.warn("Network request failed. Saving scan to offline queue.", err);
      saveToOfflineQueue(scanData);
    });
}

/**
 * Save Scan to LocalStorage Queue
 */
function saveToOfflineQueue(scanData) {
  offlineQueue.push(scanData);
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineQueue));
  
  playSuccess(`Offline: Saved ID ${scanData.id} locally`);
  updateNetworkUI();
}

/**
 * Synchronize Queued Offline Scans to Backend when Connection Restores
 */
function syncOfflineQueue() {
  updateNetworkUI();
  
  if (!navigator.onLine || offlineQueue.length === 0) return;

  const queueToSync = [...offlineQueue];
  console.log(`Syncing ${queueToSync.length} offline scans...`);

  // Process queue sequentially
  Promise.all(
    queueToSync.map(item =>
      fetch(SCRIPT_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ id: item.id })
      }).then(res => res.json())
    )
  )
    .then(() => {
      // Clear queue upon successful sync
      offlineQueue = [];
      localStorage.removeItem(QUEUE_STORAGE_KEY);
      playSuccess("All offline scans successfully synced!");
      updateNetworkUI();
    })
    .catch(err => {
      console.error("Failed to sync offline queue:", err);
      updateNetworkUI();
    });
}

/**
 * Audio & UI Visual Feedback Helpers
 */
function playSuccess(msg) {
  if (successAudio) {
    successAudio.currentTime = 0;
    successAudio.play().catch(() => {});
  }
  displayResultOnScreen(msg, "text-success");
}

function playError(msg) {
  if (errorAudio) {
    errorAudio.currentTime = 0;
    errorAudio.play().catch(() => {});
  }
  displayResultOnScreen(msg, "text-danger");
}

function displayResultOnScreen(msg, textClass) {
  const resultContainer = document.getElementById("scan-result");
  if (resultContainer) {
    resultContainer.className = `fw-bold text-center h4 my-3 ${textClass}`;
    resultContainer.textContent = msg;
  }
}

function updateNetworkUI() {
  if (!queueBadge) return;

  if (!navigator.onLine) {
    queueBadge.className = "badge bg-warning text-dark px-3 py-2";
    queueBadge.innerHTML = `⚠️ Offline Mode (${offlineQueue.length} Queued)`;
  } else if (offlineQueue.length > 0) {
    queueBadge.className = "badge bg-info text-dark px-3 py-2";
    queueBadge.innerHTML = `🔄 Syncing ${offlineQueue.length} Scans...`;
  } else {
    queueBadge.className = "badge bg-success px-3 py-2";
    queueBadge.innerHTML = `✓ Online & Synced`;
  }
}
