// 1. Dynamic Script URL from ?scriptUrl= parameter with fallback
const urlParams = new URLSearchParams(window.location.search);
const SCRIPT_URL = urlParams.get('scriptUrl') || "https://script.google.com/macros/s/AKfycbyCprd2xbGdpQ7zM2ueI-FTJ0ZpQumiEDCaOW0rSja7M4hj3GVmMdNLwBdItIr9o6rxOA/exec";

// 2. Secret Security Token (Must match SECRET_API_KEY in Code.gs)
const API_KEY = "COA_SEMINAR_2026_SECURE_TOKEN_9981";

const QUEUE_STORAGE_KEY = "attendance_offline_queue";

// Local Audio Elements & Status Badge
const successAudio = document.getElementById("scan-sound");
const errorAudio = document.getElementById("error-sound");
const queueBadge = document.getElementById("queue-status-badge");

// Global timer variable for clearing results
let resultDisplayTimeout = null;

// Prevents two syncs from running at the same time
let isSyncing = false;

// Initialize Offline Queue on startup
let offlineQueue = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");

// Network Status Listeners
window.addEventListener("online", syncOfflineQueue);
window.addEventListener("offline", updateNetworkUI);

// ====================================================
// PRIMARY SCAN & NETWORK ENGINE
// ====================================================

function onScanSuccess(decodedText, decodedResult) {
  // Cooldown Lock: Prevent rapid double-scans
  if (window.isProcessingScan) return;
  window.isProcessingScan = true;

  // Clean raw scanned text (supports raw IDs and URLs containing ?id=)
  let scannedId = decodedText.trim();
  if (scannedId.includes("id=")) {
    scannedId = scannedId.split("id=")[1];
    if (scannedId.includes("&")) scannedId = scannedId.split("&")[0];
    scannedId = scannedId.trim();
  }

  const scanData = {
    id: scannedId,
    timestamp: new Date().toISOString(), // Actual moment of the scan (kept even if synced later)
    userAgent: navigator.userAgent // Metadata for audit log
  };

  if (navigator.onLine) {
    sendScanToBackend(scanData);
  } else {
    saveToOfflineQueue(scanData);
  }

  // Release camera cooldown lock after 3 seconds
  setTimeout(() => {
    window.isProcessingScan = false;
  }, 3000);
}

function onScanError(errorMessage) {
  // Ignore continuous frame-scan errors
}

// Builds the request body so live scans and queued scans are sent identically
function buildPayload(item) {
  return JSON.stringify({
    id: item.id,
    apiKey: API_KEY,
    userAgent: item.userAgent,
    timestamp: item.timestamp // Server uses this as the real scan time
  });
}

function sendScanToBackend(scanData) {
  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: buildPayload(scanData)
  })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
      return response.json();
    })
    .then(data => {
      if (data.status === "success") {
        playSuccess(data.message);
      } else {
        playError(data.message || "ID Not Found or Cooldown Active");
      }
    })
    .catch(err => {
      console.warn("Network request failed. Saving scan to offline queue.", err);
      saveToOfflineQueue(scanData);
    });
}

function saveToOfflineQueue(scanData) {
  offlineQueue.push(scanData);
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineQueue));
  
  playSuccess(`Offline: Saved ID ${scanData.id} locally`);
  updateNetworkUI();
}

// Sends queued scans one at a time, oldest first.
// Each scan is removed from the queue only after the server has answered it,
// so a dropped connection never loses or duplicates scans.
async function syncOfflineQueue() {
  updateNetworkUI();

  if (isSyncing || !navigator.onLine || offlineQueue.length === 0) return;
  isSyncing = true;

  let synced = 0;
  let skipped = 0;

  try {
    while (offlineQueue.length > 0) {
      const item = offlineQueue[0];

      const response = await fetch(SCRIPT_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: buildPayload(item)
      });
      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const result = await response.json();
      const msg = result.message || "";

      // Final answers: logged, already logged, or ID not in Masterlist.
      // Anything else (bad key, missing sheet, server error) keeps the scan queued.
      const isFinal =
        result.status === "success" ||
        msg.includes("Already Logged") ||
        msg.includes("ID Not Found");
      if (!isFinal) throw new Error(msg || "Unexpected server response");

      if (result.status === "success") synced++; else skipped++;

      offlineQueue.shift();
      if (offlineQueue.length > 0) {
        localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineQueue));
      } else {
        localStorage.removeItem(QUEUE_STORAGE_KEY);
      }
      updateNetworkUI();
    }

    if (skipped === 0) {
      playSuccess(`All offline scans successfully synced! (${synced})`);
    } else {
      playSuccess(`Synced ${synced} offline scan(s). ${skipped} skipped (duplicate or ID not found).`);
    }
  } catch (err) {
    console.error("Failed to sync offline queue:", err);
  } finally {
    isSyncing = false;
    updateNetworkUI();
  }
}

// ====================================================
// UI & AUDIO FEEDBACK HELPERS
// ====================================================

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
  const idleNotice = document.getElementById("idle-notice");
  const resultBox = document.getElementById("scan-result");

  if (!resultBox) return;

  // Clear any pending timeout from previous scans
  if (resultDisplayTimeout) {
    clearTimeout(resultDisplayTimeout);
  }

  // Hide idle message and show result box
  if (idleNotice) idleNotice.style.display = "none";
  
  const alertClass = textClass.includes("success") ? "alert-success" : "alert-danger";
  resultBox.className = `alert ${alertClass} fw-bold text-center w-100 my-2 shadow-sm fs-5`;
  resultBox.innerHTML = msg;
  resultBox.style.display = "block";

  // Auto-disappear after 4 seconds and return to idle state
  resultDisplayTimeout = setTimeout(() => {
    resultBox.style.display = "none";
    resultBox.innerHTML = "";
    if (idleNotice) idleNotice.style.display = "block";
  }, 4000);
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

// ====================================================
// INITIALIZE SCANNER ENGINE
// ====================================================

document.addEventListener("DOMContentLoaded", () => {
  updateNetworkUI();

  // If scans were left in the queue (e.g. page was closed while offline), send them now
  syncOfflineQueue();

  const html5QrcodeScanner = new Html5QrcodeScanner(
    "reader",
    { 
      fps: 10, 
      qrbox: { width: 250, height: 250 },
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    },
    false
  );
  html5QrcodeScanner.render(onScanSuccess, onScanError);
});
