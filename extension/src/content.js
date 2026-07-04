// Relic Pay Content Script
// Detects prices on e-commerce sites, overlays Relic Pay discount

class RelicPayContentScript {
  constructor() {
    this.isEnabled = false;
    this.discountPercent = 0;
    this.relicPayOverlays = new Set();
    this.init();
  }

  async init() {
    // Check if user has connected wallet + has a stake
    const stakeInfo = await this.getStakeInfo();
    this.isEnabled = !!stakeInfo.walletAddress && stakeInfo.tier > 0;
    this.discountPercent = parseFloat(stakeInfo.discountPercent || "0");

    if (this.isEnabled) {
      this.detectPrices();
      this.setupMutationObserver();
    }
  }

  async getStakeInfo() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "getStakeInfo" },
        (response) => {
          resolve(response || {});
        }
      );
    });
  }

  detectPrices() {
    const priceSelectors = [
      // Common e-commerce price patterns
      '[data-testid*="price"]',
      ".price",
      ".product-price",
      "[aria-label*='price']",
      ".amount",
      ".cost",
      ".sale-price",
      "[class*='price']",
      "span:contains('$')", // very loose fallback
    ];

    // Find all price elements on page
    const priceElements = [];
    priceSelectors.forEach((selector) => {
      if (selector.includes("contains")) return; // Skip loose selectors for now
      try {
        document.querySelectorAll(selector).forEach((el) => {
          if (
            el.textContent.match(/\$[\d.,]+/) &&
            !this.relicPayOverlays.has(el)
          ) {
            priceElements.push(el);
          }
        });
      } catch (e) {
        // Invalid selector
      }
    });

    // Add overlay to each price found
    priceElements.forEach((el) => {
      this.addRelicPayOverlay(el);
    });
  }

  addRelicPayOverlay(priceEl) {
    if (this.relicPayOverlays.has(priceEl)) return;

    const originalPrice = priceEl.textContent.trim();
    const priceMatch = originalPrice.match(/\$?([\d.,]+)/);
    if (!priceMatch) return;

    const priceValue = parseFloat(priceMatch[1].replace(/,/g, ""));
    const discountAmount = priceValue * (this.discountPercent / 100);
    const discountedPrice = (priceValue - discountAmount).toFixed(2);

    const overlay = document.createElement("div");
    overlay.className = "relic-pay-overlay";
    overlay.innerHTML = `
      <span class="relic-pay-price">
        <strong>Relic Pay:</strong> $${discountedPrice}
        <span class="discount-badge">${this.discountPercent.toFixed(1)}% off</span>
      </span>
    `;

    priceEl.parentElement.insertBefore(overlay, priceEl.nextSibling);
    this.relicPayOverlays.add(priceEl);
  }

  setupMutationObserver() {
    const observer = new MutationObserver(() => {
      // Recheck prices every 500ms if page updates
      setTimeout(() => this.detectPrices(), 500);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: false,
    });
  }
}

// Init on page load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    new RelicPayContentScript();
  });
} else {
  new RelicPayContentScript();
}
