import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import cors from "cors";
import dotenv from "dotenv";
import { Snaptrade, SnaptradeAuth, CommercialApiKeyAuth } from "snaptrade-typescript-sdk";

dotenv.config();

// User storage file for caching SnapTrade userSecrets per Firebase UID
const USERS_CACHE_FILE = path.join(process.cwd(), ".snaptrade_users.json");

function loadUsersCache(): Record<string, { userId: string; userSecret: string }> {
  try {
    if (fs.existsSync(USERS_CACHE_FILE)) {
      const data = fs.readFileSync(USERS_CACHE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (err) {
    console.error("Error reading users cache file:", err);
  }
  return {};
}

function saveUsersCache(cache: Record<string, { userId: string; userSecret: string }>) {
  try {
    fs.writeFileSync(USERS_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving users cache file:", err);
  }
}

let userSecretsCache = loadUsersCache();

// SnapTrade Client Configuration
let snaptradeClientId = process.env.SNAPTRADE_CLIENT_ID || "";
let snaptradeConsumerKey = process.env.SNAPTRADE_CONSUMER_KEY || "";

function getSnapTradeClient(): Snaptrade<CommercialApiKeyAuth> | null {
  if (!snaptradeClientId || !snaptradeConsumerKey) {
    return null;
  }
  return new Snaptrade({
    auth: SnaptradeAuth.commercialApiKey({
      clientId: snaptradeClientId,
      consumerKey: snaptradeConsumerKey,
    }),
  });
}

// Fallback Mock Data for demo/unconnected states
const MOCK_ACCOUNTS = [
  {
    id: "mock-acc-tasty-01",
    brokerage_authorization: "mock-auth-01",
    name: "Tastytrade Margin",
    number: "5W881234",
    institution_name: "Tastytrade",
    created_date: "2025-01-10T12:00:00Z",
    sync_status: { initial_sync_completed: true },
    balance: {
      total: { amount: 48520.50, currency: "USD" },
      cash: { amount: 14250.00, currency: "USD" }
    }
  },
  {
    id: "mock-acc-rh-02",
    brokerage_authorization: "mock-auth-02",
    name: "Robinhood Individual",
    number: "RH-9482103",
    institution_name: "Robinhood",
    created_date: "2025-02-15T09:30:00Z",
    sync_status: { initial_sync_completed: true },
    balance: {
      total: { amount: 32180.75, currency: "USD" },
      cash: { amount: 8900.20, currency: "USD" }
    }
  },
  {
    id: "mock-acc-schwab-03",
    brokerage_authorization: "mock-auth-03",
    name: "Schwab Roth IRA",
    number: "CS-4410982",
    institution_name: "Charles Schwab",
    created_date: "2024-11-01T15:00:00Z",
    sync_status: { initial_sync_completed: true },
    balance: {
      total: { amount: 76430.00, currency: "USD" },
      cash: { amount: 5200.00, currency: "USD" }
    }
  }
];

const MOCK_ACTIVITIES: Record<string, any[]> = {
  "mock-acc-tasty-01": [
    {
      id: "act-t1",
      trade_date: "2026-08-01",
      settlement_date: "2026-08-03",
      type: "BUY",
      symbol: { symbol: "NVDA", description: "NVIDIA Corporation" },
      units: 25,
      price: 118.50,
      amount: -2962.50,
      fee: 1.00,
      description: "BOT 25 NVDA @ 118.50"
    },
    {
      id: "act-t2",
      trade_date: "2026-08-10",
      settlement_date: "2026-08-12",
      type: "SELL",
      symbol: { symbol: "NVDA", description: "NVIDIA Corporation" },
      units: -25,
      price: 128.20,
      amount: 3205.00,
      fee: 1.05,
      description: "SLD 25 NVDA @ 128.20"
    },
    {
      id: "act-t3",
      trade_date: "2026-07-15",
      settlement_date: "2026-07-17",
      type: "BUY",
      symbol: { symbol: "SPY", description: "SPDR S&P 500 ETF Trust" },
      units: 10,
      price: 545.00,
      amount: -5450.00,
      fee: 0,
      description: "BOT 10 SPY @ 545.00"
    },
    {
      id: "act-t4",
      trade_date: "2026-08-05",
      settlement_date: "2026-08-07",
      type: "SELL",
      symbol: { symbol: "SPY", description: "SPDR S&P 500 ETF Trust" },
      units: -10,
      price: 560.80,
      amount: 5608.00,
      fee: 0.15,
      description: "SLD 10 SPY @ 560.80"
    },
    {
      id: "act-t5",
      trade_date: "2026-08-12",
      settlement_date: "2026-08-14",
      type: "BUY",
      symbol: { symbol: "TSLA", description: "Tesla Inc" },
      units: 15,
      price: 215.00,
      amount: -3225.00,
      fee: 1.00,
      description: "BOT 15 TSLA @ 215.00"
    }
  ],
  "mock-acc-rh-02": [
    {
      id: "act-r1",
      trade_date: "2026-07-20",
      settlement_date: "2026-07-22",
      type: "BUY",
      symbol: { symbol: "AAPL", description: "Apple Inc" },
      units: 30,
      price: 218.00,
      amount: -6540.00,
      fee: 0,
      description: "Market Buy AAPL"
    },
    {
      id: "act-r2",
      trade_date: "2026-08-08",
      settlement_date: "2026-08-10",
      type: "SELL",
      symbol: { symbol: "AAPL", description: "Apple Inc" },
      units: -30,
      price: 226.40,
      amount: 6792.00,
      fee: 0.05,
      description: "Market Sell AAPL"
    },
    {
      id: "act-r3",
      trade_date: "2026-08-02",
      settlement_date: "2026-08-04",
      type: "BUY",
      symbol: { symbol: "MSFT", description: "Microsoft Corp" },
      units: 12,
      price: 430.00,
      amount: -5160.00,
      fee: 0,
      description: "Market Buy MSFT"
    }
  ],
  "mock-acc-schwab-03": [
    {
      id: "act-s1",
      trade_date: "2026-06-10",
      settlement_date: "2026-06-12",
      type: "BUY",
      symbol: { symbol: "QQQ", description: "Invesco QQQ Trust" },
      units: 40,
      price: 470.00,
      amount: -18800.00,
      fee: 0,
      description: "BOUGHT 40 QQQ"
    },
    {
      id: "act-s2",
      trade_date: "2026-07-28",
      settlement_date: "2026-07-30",
      type: "SELL",
      symbol: { symbol: "QQQ", description: "Invesco QQQ Trust" },
      units: -40,
      price: 492.50,
      amount: 19700.00,
      fee: 0.20,
      description: "SOLD 40 QQQ"
    }
  ]
};

const MOCK_POSITIONS: Record<string, any[]> = {
  "mock-acc-tasty-01": [
    {
      symbol: { symbol: "TSLA", description: "Tesla Inc" },
      units: 15,
      price: 222.40,
      average_purchase_price: 215.00,
      open_pnl: 111.00
    },
    {
      symbol: { symbol: "AMD", description: "Advanced Micro Devices" },
      units: 50,
      price: 148.50,
      average_purchase_price: 142.00,
      open_pnl: 325.00
    }
  ],
  "mock-acc-rh-02": [
    {
      symbol: { symbol: "MSFT", description: "Microsoft Corp" },
      units: 12,
      price: 442.10,
      average_purchase_price: 430.00,
      open_pnl: 145.20
    },
    {
      symbol: { symbol: "AMZN", description: "Amazon.com Inc" },
      units: 20,
      price: 185.00,
      average_purchase_price: 180.50,
      open_pnl: 90.00
    }
  ],
  "mock-acc-schwab-03": [
    {
      symbol: { symbol: "VOO", description: "Vanguard S&P 500 ETF" },
      units: 110,
      price: 512.30,
      average_purchase_price: 485.00,
      open_pnl: 3003.00
    }
  ]
};

async function getOrRegisterUser(snaptrade: Snaptrade<CommercialApiKeyAuth>, uid: string): Promise<{ userId: string; userSecret: string }> {
  const safeUid = uid.replace(/[^a-zA-Z0-9_-]/g, "_");
  const snapTradeUserId = `alphatrack_${safeUid}`;

  if (userSecretsCache[uid] && userSecretsCache[uid].userSecret) {
    return userSecretsCache[uid];
  }

  try {
    console.log(`[SnapTrade] Registering user in SnapTrade: ${snapTradeUserId}`);
    const regRes = await snaptrade.authentication.registerSnapTradeUser({
      userId: snapTradeUserId,
    });

    const userSecret = regRes.data.userSecret || "";
    userSecretsCache[uid] = {
      userId: snapTradeUserId,
      userSecret,
    };
    saveUsersCache(userSecretsCache);
    return userSecretsCache[uid];
  } catch (error: any) {
    console.warn(`[SnapTrade] Registration returned error/already exists:`, error.response?.data || error.message);
    if (userSecretsCache[uid]) {
      return userSecretsCache[uid];
    }
    try {
      console.log(`[SnapTrade] Attempting to reset user secret for: ${snapTradeUserId}`);
      const resetRes = await snaptrade.authentication.resetSnapTradeUserSecret({
        userId: snapTradeUserId,
        userSecret: "",
      });
      const userSecret = resetRes.data.userSecret || "";
      userSecretsCache[uid] = {
        userId: snapTradeUserId,
        userSecret,
      };
      saveUsersCache(userSecretsCache);
      return userSecretsCache[uid];
    } catch (resetErr: any) {
      console.error("[SnapTrade] Failed to reset user secret:", resetErr.response?.data || resetErr.message);
      throw error;
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // 1. Health check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      provider: "SnapTrade",
      configured: Boolean(snaptradeClientId && snaptradeConsumerKey)
    });
  });

  // 2. Status & Configuration info
  app.get("/api/snaptrade/status", (req, res) => {
    const isConfigured = Boolean(snaptradeClientId && snaptradeConsumerKey);
    res.json({
      isConfigured,
      clientIdMasked: snaptradeClientId ? `${snaptradeClientId.slice(0, 4)}...${snaptradeClientId.slice(-4)}` : null,
      mode: isConfigured ? "Live SnapTrade API" : "Interactive Demo Mode (Mock Brokerages)"
    });
  });

  // 3. Update SnapTrade Credentials dynamically
  app.post("/api/snaptrade/configure", (req, res) => {
    const { clientId, consumerKey } = req.body;
    if (!clientId || !consumerKey) {
      return res.status(400).json({ error: "clientId and consumerKey are required" });
    }
    snaptradeClientId = clientId.trim();
    snaptradeConsumerKey = consumerKey.trim();
    console.log(`[SnapTrade] Updated credentials. Client ID: ${snaptradeClientId.slice(0, 4)}...`);
    res.json({ success: true, isConfigured: true });
  });

  // 4. Generate Connection Portal Login Link
  app.post("/api/snaptrade/portal-url", async (req, res) => {
    const { uid, broker, immediateRedirect, customRedirect, connectionType } = req.body;
    if (!uid) {
      return res.status(400).json({ error: "Missing user UID" });
    }

    const snaptrade = getSnapTradeClient();
    if (!snaptrade) {
      return res.json({
        isMock: true,
        redirectURI: null,
        message: "SnapTrade API keys not configured. Operating in simulated multi-broker mode."
      });
    }

    try {
      const { userId, userSecret } = await getOrRegisterUser(snaptrade, uid);
      console.log(`[SnapTrade] Generating portal login URL for user: ${userId}`);

      const loginRes = await snaptrade.authentication.loginSnapTradeUser({
        userId,
        userSecret,
        broker: broker || undefined,
        immediateRedirect: immediateRedirect || false,
        customRedirect: customRedirect || undefined,
        connectionType: (connectionType as any) || "read",
        showCloseButton: true,
      });

      const responseData: any = loginRes.data;
      const redirectURI = responseData.redirectURI || responseData.loginRedirectURI;

      res.json({
        redirectURI,
        sessionId: responseData.sessionId,
        userId
      });
    } catch (error: any) {
      console.error("[SnapTrade] Error generating portal link:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to generate SnapTrade Connection Portal URL" });
    }
  });

  // 5. Get All Connected Accounts for User
  app.get("/api/snaptrade/accounts", async (req, res) => {
    const uid = (req.query.uid as string) || "";
    const snaptrade = getSnapTradeClient();

    if (!snaptrade || !uid) {
      return res.json({
        isMock: !snaptrade,
        items: MOCK_ACCOUNTS
      });
    }

    try {
      const { userId, userSecret } = await getOrRegisterUser(snaptrade, uid);
      const accRes = await snaptrade.accountInformation.listUserAccounts({
        userId,
        userSecret,
      });

      const accounts = accRes.data || [];
      console.log(`[SnapTrade] Fetched ${accounts.length} accounts for user ${userId}`);

      res.json({
        isMock: false,
        items: accounts.length > 0 ? accounts : []
      });
    } catch (error: any) {
      console.error("[SnapTrade] Error listing user accounts:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to list accounts" });
    }
  });

  // 6. Get Account Activities / Transactions
  app.get("/api/snaptrade/accounts/:accountId/activities", async (req, res) => {
    const { accountId } = req.params;
    const uid = (req.query.uid as string) || "";
    const startDate = (req.query.startDate as string) || undefined;
    const endDate = (req.query.endDate as string) || undefined;

    const snaptrade = getSnapTradeClient();
    if (!snaptrade || !uid || accountId.startsWith("mock-")) {
      const activities = MOCK_ACTIVITIES[accountId] || [];
      return res.json({
        isMock: true,
        data: activities
      });
    }

    try {
      const { userId, userSecret } = await getOrRegisterUser(snaptrade, uid);
      const actRes = await snaptrade.accountInformation.getAccountActivities({
        accountId,
        userId,
        userSecret,
        startDate,
        endDate,
      });

      const activitiesData: any = actRes.data;
      const items = Array.isArray(activitiesData) ? activitiesData : (activitiesData.data || activitiesData.items || []);
      res.json({
        isMock: false,
        data: items
      });
    } catch (error: any) {
      console.error(`[SnapTrade] Error fetching activities for ${accountId}:`, error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to fetch activities" });
    }
  });

  // 7. Get Account Positions
  app.get("/api/snaptrade/accounts/:accountId/positions", async (req, res) => {
    const { accountId } = req.params;
    const uid = (req.query.uid as string) || "";

    const snaptrade = getSnapTradeClient();
    if (!snaptrade || !uid || accountId.startsWith("mock-")) {
      const positions = MOCK_POSITIONS[accountId] || [];
      return res.json({
        isMock: true,
        positions
      });
    }

    try {
      const { userId, userSecret } = await getOrRegisterUser(snaptrade, uid);
      const posRes = await snaptrade.accountInformation.getAllAccountPositions({
        accountId,
        userId,
        userSecret,
      });

      const posData: any = posRes.data;
      const positions = Array.isArray(posData) ? posData : (posData.positions || []);
      res.json({
        isMock: false,
        positions
      });
    } catch (error: any) {
      console.error(`[SnapTrade] Error fetching positions for ${accountId}:`, error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to fetch positions" });
    }
  });

  // 8. Get Account Balances
  app.get("/api/snaptrade/accounts/:accountId/balances", async (req, res) => {
    const { accountId } = req.params;
    const uid = (req.query.uid as string) || "";

    const snaptrade = getSnapTradeClient();
    if (!snaptrade || !uid || accountId.startsWith("mock-")) {
      const acc = MOCK_ACCOUNTS.find(a => a.id === accountId);
      return res.json(acc?.balance || { total: { amount: 0, currency: "USD" }, cash: { amount: 0, currency: "USD" } });
    }

    try {
      const { userId, userSecret } = await getOrRegisterUser(snaptrade, uid);
      const balRes = await snaptrade.accountInformation.getUserAccountBalance({
        accountId,
        userId,
        userSecret,
      });

      res.json(balRes.data);
    } catch (error: any) {
      console.error(`[SnapTrade] Error fetching balances for ${accountId}:`, error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to fetch balances" });
    }
  });

  // 9. List Brokerage Authorizations / Connections
  app.get("/api/snaptrade/connections", async (req, res) => {
    const uid = (req.query.uid as string) || "";
    const snaptrade = getSnapTradeClient();

    if (!snaptrade || !uid) {
      return res.json([
        { id: "mock-auth-01", brokerage: { name: "Tastytrade", slug: "TASTYWORKS" }, disabled: false },
        { id: "mock-auth-02", brokerage: { name: "Robinhood", slug: "ROBINHOOD" }, disabled: false },
        { id: "mock-auth-03", brokerage: { name: "Charles Schwab", slug: "SCHWAB" }, disabled: false }
      ]);
    }

    try {
      const { userId, userSecret } = await getOrRegisterUser(snaptrade, uid);
      const connRes = await snaptrade.connections.listBrokerageAuthorizations({
        userId,
        userSecret,
      });
      res.json(connRes.data || []);
    } catch (error: any) {
      console.error("[SnapTrade] Error listing connections:", error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to list connections" });
    }
  });

  // 10. Delete / Disconnect Brokerage Connection
  app.delete("/api/snaptrade/connections/:authorizationId", async (req, res) => {
    const { authorizationId } = req.params;
    const uid = (req.query.uid as string) || "";
    const snaptrade = getSnapTradeClient();

    if (!snaptrade || !uid) {
      return res.json({ success: true, message: "Mock connection disconnected" });
    }

    try {
      const { userId, userSecret } = await getOrRegisterUser(snaptrade, uid);
      await snaptrade.connections.deleteConnection({
        connectionId: authorizationId,
        userId,
        userSecret,
      });
      res.json({ success: true });
    } catch (error: any) {
      console.error(`[SnapTrade] Error deleting connection ${authorizationId}:`, error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to disconnect brokerage" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({ error: { message: 'Internal Server Error' } });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`SnapTrade status: ${snaptradeClientId ? 'Configured (' + snaptradeClientId.slice(0, 4) + '...)' : 'Unset (Running in Demo/Mock mode)'}`);
  });
}

startServer();

