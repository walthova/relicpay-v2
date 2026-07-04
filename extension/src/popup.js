// Relic Pay Extension Popup
// Connects Phantom wallet, displays stake info, manages connection

const TIER_COLORS = {
  0: { name: "Unstaked", color: "#6b7280" },
  1: { name: "Bronze", color: "#b45309" },
  2: { name: "Silver", color: "#9ca3af" },
  3: { name: "Gold", color: "#eab308" },
  4: { name: "Platinum", color: "#22d3ee" },
};

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const disconnectedSection = document.getElementById("disconnected");
const connectedSection = document.getElementById("connected");
const walletAddrEl = document.getElementById("walletAddress");
const tierBadgeEl = document.getElementById("tierBadge");
const discountAmountEl = document.getElementById("discountAmount");

async function loadStakeInfo() {
  chrome.runtime.sendMessage({ action: "getStakeInfo" }, (response) => {
    if (response && response.walletAddress) {
      showConnected(response);
    } else {
      showDisconnected();
    }
  });
}

function showConnected(stakeInfo) {
  disconnectedSection.classList.add("hidden");
  connectedSection.classList.remove("hidden");

  const addr = stakeInfo.walletAddress || "";
  walletAddrEl.textContent =
    addr.slice(0, 4) + "•••" + addr.slice(-4);

  const tier = stakeInfo.tier || 0;
  const tierInfo = TIER_COLORS[tier];
  tierBadgeEl.textContent = tierInfo.name;
  tierBadgeEl.style.color = tierInfo.color;
  tierBadgeEl.style.borderColor = tierInfo.color;

  discountAmountEl.textContent = (stakeInfo.discountPercent || "0.0") + "%";
}

function showDisconnected() {
  disconnectedSection.classList.remove("hidden");
  connectedSection.classList.add("hidden");
}

connectBtn.addEventListener("click", async () => {
  // Use Phantom provider if available
  if (window.solana && window.solana.isPhantom) {
    try {
      const response = await window.solana.connect();
      const walletAddress = response.publicKey.toString();

      // Send to background worker to fetch tier
      chrome.runtime.sendMessage(
        { action: "connectWallet", wallet: walletAddress },
        (response) => {
          if (response.success) {
            loadStakeInfo();
          } else {
            alert("Failed to connect: " + response.error);
          }
        }
      );
    } catch (error) {
      alert("Phantom connection failed: " + error.message);
    }
  } else {
    alert(
      "Phantom wallet not found. Please install it from https://phantom.app"
    );
  }
});

disconnectBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "disconnect" }, () => {
    showDisconnected();
  });
});

// Load state on popup open
loadStakeInfo();
