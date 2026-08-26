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

// Initialize Offline Queue on startup
let offlineQueue = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || "[]");
updateNetworkUI();

// Network Status Listeners
window.addEventListener("online", syncOfflineQueue);
window.addEventListener("offline", updateNetworkUI);

// ====================================================
// PRIMARY SCAN & NETWORK ENGINE
// ====================================================

/**
 * Primary QR Scan Callback Handler (Triggered by HTML5-QRCode Scanner)
 */
function onScanSuccess(decodedText, decodedResult) {
  // 1. Camera Cooldown Lock: Prevent rapid double-scans
  if (window.isProcessingScan) return;
  window.isProcessingScan = true;

  const scannedId = decodedText.trim();
  const scanData = {
    id: scannedId,
    timestamp: new Date().toISOString()
  };

  if (navigator.onLine) {
    // Online: Send directly to Google Apps Script
    sendScanToBackend(scanData);
  } else {
    // Offline: Save to browser LocalStorage queue
    saveToOfflineQueue(scanData);
  }

  // Release camera cooldown after 3 seconds
  setTimeout(() => {
    window.isProcessingScan = false;
  }, 3000);
}

/**
 * Optional Scan Error Handler (Ignored during continuous scanning)
 */
function onScanError(errorMessage) {
  // Low-level scan errors happen every frame when no QR is visible; safe to ignore
}

/**
 * Send Scan Data to Google Apps Script with Security Token
 */
function sendScanToBackend(scanData) {
  fetch(SCRIPT_URL, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ 
      id: scanData.id,
      apiKey: API_KEY // Secret security token
    })
  })
    .then(response => response.json())
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

/**
 * Save Scan to LocalStorage Queue when Offline
 */
function saveToOfflineQueue(scanData) {
  offlineQueue.push(scanData);
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(offlineQueue));
  
  playSuccess(`Offline: Saved ID ${scanData.id} locally`);
  updateNetworkUI();
}

/**
 * Synchronize Queued Offline Scans when Internet Restores
 */
function syncOfflineQueue() {
  updateNetworkUI();
  
  if (!navigator.onLine || offlineQueue.length === 0) return;

  const queueToSync = [...offlineQueue];
  console.log(`Syncing ${queueToSync.length} offline scans...`);

  Promise.all(
    queueToSync.map(item =>
      fetch(SCRIPT_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ 
          id: item.id,
          apiKey: API_KEY 
        })
      }).then(res => res.json())
    )
  )
    .then(() => {
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

  if (resultBox) {
    // Hide idle notice and display result box
    if (idleNotice) idleNotice.style.display = "none";
    
    // Convert textClass (e.g. "text-success") to Bootstrap alert classes
    const alertClass = textClass.includes("success") ? "alert-success" : "alert-danger";
    
    resultBox.className = `alert ${alertClass} fw-bold text-center w-100 my-2 shadow-sm`;
    resultBox.innerHTML = msg; // Allows formatted participant names / HTML line breaks
    resultBox.style.display = "block";
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

// ====================================================
// INITIALIZE SCANNER ENGINE
// ====================================================

document.addEventListener("DOMContentLoaded", () => {
  const html5QrcodeScanner = new Html5QrcodeScanner(
    "reader",
    { 
      fps: 10, 
      qrbox: { width: 250, height: 250 },
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    },
    /* verbose= */ false
  );
  html5QrcodeScanner.render(onScanSuccess, onScanError);
});
