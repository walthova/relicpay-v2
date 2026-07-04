// Relic Pay Service Worker
// Reads user's stake tier from Solana devnet, caches discount percentage
// No private keys stored — read-only via @solana/web3.js

import { Connection, PublicKey } from "https://cdn.jsdelivr.net/npm/@solana/web3.js@1.95/+esm";

const SOLANA_RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = "5GPVYpyzdosbzWcdttcCdziJVqUCCARf98J857C3T6Gi";

const TIER_DISCOUNT_BPS = {
  0: 0,    // Unstaked
  1: 50,   // Bronze: 0.5%
  2: 100,  // Silver: 1%
  3: 200,  // Gold: 2%
  4: 300   // Platinum: 3%
};

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.action === "connectWallet") {
    const walletAddress = message.wallet;
    try {
      const tier = await fetchUserTier(walletAddress);
      const discountBps = TIER_DISCOUNT_BPS[tier] || 0;
      const discountPercent = (discountBps / 100).toFixed(2);

      await chrome.storage.local.set({
        walletAddress,
        tier,
        discountBps,
        discountPercent,
        connectedAt: Date.now()
      });

      sendResponse({ success: true, tier, discountPercent });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  if (message.action === "getStakeInfo") {
    const data = await chrome.storage.local.get([
      "walletAddress",
      "tier",
      "discountPercent"
    ]);
    sendResponse(data);
  }

  if (message.action === "disconnect") {
    await chrome.storage.local.remove([
      "walletAddress",
      "tier",
      "discountBps",
      "discountPercent",
      "connectedAt"
    ]);
    sendResponse({ success: true });
  }
});

async function fetchUserTier(walletAddress) {
  try {
    const connection = new Connection(SOLANA_RPC, "confirmed");
    const userPubkey = new PublicKey(walletAddress);

    // Derive UserStake PDA: seeds ["user_stake", user_pubkey]
    const [userStakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_stake"), userPubkey.toBuffer()],
      new PublicKey(PROGRAM_ID)
    );

    // Fetch account data
    const account = await connection.getAccountInfo(userStakePda);
    if (!account) {
      return 0; // No stake yet
    }

    // Parse tier from account data (offset varies; for now, estimate from account size)
    // In production: use proper Anchor IDL deserialization
    // For MVP: tier is stored at a known offset in the BorshDeserialized UserStake
    // UserStake layout: owner(32) + staked_amount(8) + yield_accrued(8) + last_update(8) + tier(1) + bump(1)
    const tierOffset = 32 + 8 + 8 + 8; // 56 bytes in
    const tier = account.data[tierOffset] || 0;

    return Math.min(4, Math.max(0, tier));
  } catch (error) {
    console.error("Failed to fetch user tier:", error);
    return 0;
  }
}
