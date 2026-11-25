import { expect, test, Page } from "@playwright/test";
import { PublicKey } from "@solana/web3.js";

// An injected wallet double and intercepted RPC only: no keys or transactions.
const merchant = new PublicKey(new Uint8Array(32).fill(7));

async function installWallet(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<Function>>();
    const publicKey = (value: number) => ({
      toBytes: () => new Uint8Array(32).fill(value),
    });
    const wallet = {
      isPhantom: true,
      isConnected: false,
      publicKey: publicKey(7),
      async connect() {
        this.isConnected = true;
        return { publicKey: this.publicKey };
      },
      async disconnect() {
        this.isConnected = false;
      },
      on(event: string, callback: Function) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(callback);
      },
      off(event: string, callback: Function) {
        listeners.get(event)?.delete(callback);
      },
      switchAccount() {
        this.publicKey = publicKey(8);
        listeners
          .get("accountChanged")
          ?.forEach((callback) => callback(this.publicKey));
      },
      async signTransaction() {
        throw new Error("Unexpected signing request");
      },
      async signAllTransactions() {
        throw new Error("Unexpected signing request");
      },
    };
    Object.assign(window, {
      isPhantomInstalled: true,
      phantom: { solana: wallet },
    });
  });
}

async function connect(page: Page) {
  await page.goto("/merchant");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Phantom/ }).click();
}

test("first-time merchant can choose Phantom without installing a wallet", async ({
  page,
}) => {
  await page.goto("/merchant");
  await expect(
    page.getByRole("heading", { name: "Connect your payout wallet" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("link", { name: "Need a wallet? Get Phantom" }),
  ).toHaveAttribute("href", "https://phantom.com/");
  await expect(
    page.locator('[aria-label="Agreement summary"] strong'),
  ).toHaveText(["—", "—", "—", "—", "—"]);
  await expect(
    page.getByRole("link", { name: "Merchant", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /Phantom/ })).toBeVisible();
});

test("connected merchant can recover from a failed request and refresh an empty wallet", async ({
  page,
}) => {
  await installWallet(page);
  let fail = true;
  let requests = 0;
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    requests++;
    const { id, params } = route.request().postDataJSON();
    expect(params[1].filters).toContainEqual({
      memcmp: { offset: 40, bytes: merchant.toBase58(), encoding: "base58" },
    });
    await route.fulfill({
      json: fail
        ? {
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: "Test RPC unavailable" },
          }
        : { jsonrpc: "2.0", id, result: [] },
    });
  });
  await connect(page);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "We couldn’t load your agreements" }),
  ).toBeVisible();
  await expect(
    page.locator('[aria-label="Agreement summary"] strong'),
  ).toHaveText(["—", "—", "—", "—", "—"]);
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Your first agreement starts at checkout",
    }),
  ).toBeVisible();
  await expect(
    page.locator('[aria-label="Agreement summary"] strong'),
  ).toHaveText(["0", "0.00", "0.00", "0.00", "0.00"]);
  const before = requests;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => requests).toBeGreaterThan(before);
  await expect(
    page.getByRole("heading", {
      name: "Your first agreement starts at checkout",
    }),
  ).toBeVisible();
});

test("switching wallets resets the summary and disconnecting restores onboarding", async ({
  page,
}) => {
  await installWallet(page);
  let release: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const { id, params } = route.request().postDataJSON();
    const firstWallet = params[1].filters.some(
      (filter: any) => filter.memcmp?.bytes === merchant.toBase58(),
    );
    if (!firstWallet) await pending;
    await route.fulfill({
      json: { jsonrpc: "2.0", id, result: [] },
    });
  });
  await connect(page);
  await expect(
    page.getByRole("heading", {
      name: "Your first agreement starts at checkout",
    }),
  ).toBeVisible();
  await expect(
    page.locator('[aria-label="Agreement summary"] strong'),
  ).toHaveText(["0", "0.00", "0.00", "0.00", "0.00"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
  await page.evaluate(() => (window as any).phantom.solana.switchAccount());
  await expect(page.getByRole("status")).toContainText(
    "Loading your agreements",
  );
  await expect(
    page.locator('[aria-label="Agreement summary"] strong'),
  ).toHaveText(["—", "—", "—", "—", "—"]);
  release!();
  await expect(
    page.getByRole("heading", {
      name: "Your first agreement starts at checkout",
    }),
  ).toBeVisible();
  await page.locator(".wallet-adapter-button-trigger").click();
  await page.getByText("Disconnect", { exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your payout wallet" }),
  ).toBeVisible();
  await expect(
    page.locator('[aria-label="Agreement summary"] strong'),
  ).toHaveText(["—", "—", "—", "—", "—"]);
});

test("navigation reaches the buyer checkout and wallet-free demo", async ({
  page,
}) => {
  await page.goto("/merchant");
  await page.getByRole("link", { name: "Buyer checkout", exact: true }).click();
  await expect(page).toHaveURL("/checkout");
  await expect(
    page.getByRole("heading", { name: "Relic Pay", exact: true }),
  ).toBeInViewport();
  await page.goto("/merchant");
  await expect(
    page.getByText(/The simulation previews a separate/),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Credit simulation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(
    page.getByRole("heading", { name: /Agent credit. Owner control./ }),
  ).toBeInViewport();
});
