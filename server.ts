import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { Snaptrade, SnaptradeAuth, CommercialApiKeyAuth } from "snaptrade-typescript-sdk";

dotenv.config();

// Firebase Admin & Firestore initialization for persistent credential storage
let firestoreDb: admin.firestore.Firestore | null = null;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  let projectId = process.env.FIREBASE_PROJECT_ID || "alphatrack-87d15";
  let databaseId = "(default)";
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (cfg.projectId) projectId = cfg.projectId;
      if (cfg.firestoreDatabaseId && cfg.firestoreDatabaseId !== "(default)") {
        databaseId = cfg.firestoreDatabaseId;
      }
    } catch (e) {}
  }
  const app = admin.apps.length > 0 && admin.apps[0]
    ? admin.apps[0]
    : admin.initializeApp({ projectId });

  firestoreDb = databaseId && databaseId !== "(default)"
    ? getFirestore(app, databaseId)
    : getFirestore(app);
  console.log(`[Firestore Admin] Initialized persistent storage with database: ${databaseId}`);
} catch (err) {
  console.warn("[Firestore Admin] Fallback to local cache file storage:", err);
}

// User storage file for local caching SnapTrade userSecrets per Firebase UID
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

async function loadUserFromFirestore(uid: string): Promise<{ userId: string; userSecret: string } | null> {
  if (!firestoreDb) return null;
  try {
    const docSnap = await firestoreDb.collection("snaptrade_users").doc(uid).get();
    if (docSnap.exists) {
      const data = docSnap.data();
      if (data?.userId && data?.userSecret) {
        return { userId: data.userId, userSecret: data.userSecret };
      }
    }
  } catch (err: any) {
    console.warn(`[Firestore Admin] Could not read user ${uid}:`, err.message);
  }
  return null;
}

async function saveUserToFirestore(uid: string, data: { userId: string; userSecret: string }) {
  if (!firestoreDb) return;
  try {
    await firestoreDb.collection("snaptrade_users").doc(uid).set({
      ...data,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`[Firestore Admin] Persisted SnapTrade credentials for user ${uid}`);
  } catch (err: any) {
    console.warn(`[Firestore Admin] Could not save user ${uid}:`, err.message);
  }
}

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
    // /MNQU6 Put Ratio Spread - Aug 21 Expiration
    {
      id: "act-mnq-aug-1",
      trade_date: "2026-07-27",
      settlement_date: "2026-07-28",
      type: "BUY_TO_OPEN",
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260821P24800", description: "/MNQU6 Aug 21 24800 Put" },
      option_symbol: { ticker: "260821P24800", expiration_date: "2026-08-21", strike_price: "24800", option_type: "PUT" },
      units: 1,
      price: 117.00,
      amount: -234.00,
      fee: 1.25,
      description: "BOT +1 /MNQU6 Aug 21 24800 Put @ 117.00"
    },
    {
      id: "act-mnq-aug-2",
      trade_date: "2026-07-27",
      settlement_date: "2026-07-28",
      type: "SELL_TO_OPEN",
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260821P24500", description: "/MNQU6 Aug 21 24500 Put" },
      option_symbol: { ticker: "260821P24500", expiration_date: "2026-08-21", strike_price: "24500", option_type: "PUT" },
      units: -2,
      price: 93.00,
      amount: 372.00,
      fee: 2.50,
      description: "SLD -2 /MNQU6 Aug 21 24500 Put @ 93.00"
    },
    // /MNQU6 Put Ratio Spread - Sep 18 Expiration
    {
      id: "act-mnq-sep-1",
      trade_date: "2026-08-10",
      settlement_date: "2026-08-11",
      type: "BUY_TO_OPEN",
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260918P26100", description: "/MNQU6 Sep 18 26100 Put" },
      option_symbol: { ticker: "260918P26100", expiration_date: "2026-09-18", strike_price: "26100", option_type: "PUT" },
      units: 1,
      price: 96.50,
      amount: -193.00,
      fee: 1.25,
      description: "BOT +1 /MNQU6 Sep 18 26100 Put @ 96.50"
    },
    {
      id: "act-mnq-sep-2",
      trade_date: "2026-08-10",
      settlement_date: "2026-08-11",
      type: "SELL_TO_OPEN",
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260918P25800", description: "/MNQU6 Sep 18 25800 Put" },
      option_symbol: { ticker: "260918P25800", expiration_date: "2026-09-18", strike_price: "25800", option_type: "PUT" },
      units: -2,
      price: 81.00,
      amount: 324.00,
      fee: 2.50,
      description: "SLD -2 /MNQU6 Sep 18 25800 Put @ 81.00"
    },
    // /MESU6 Futures Option - Sep 18 Expiration
    {
      id: "act-mes-sep-1",
      trade_date: "2026-08-11",
      settlement_date: "2026-08-12",
      type: "SELL_TO_OPEN",
      symbol: { symbol: "/MESU6", raw_symbol: "/MESU6 260918P7050", description: "/MESU6 Sep 18 7050 Put" },
      option_symbol: { ticker: "260918P7050", expiration_date: "2026-09-18", strike_price: "7050", option_type: "PUT" },
      units: -1,
      price: 23.75,
      amount: 118.75,
      fee: 1.25,
      description: "SLD -1 /MESU6 Sep 18 7050 Put @ 23.75"
    },
    // Historical closed NVDA & TSLA trades
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
    // /MNQU6 Aug 21 Put Ratio Spread
    {
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260821P24500", description: "/MNQU6 Aug 21 24500 Put" },
      option_symbol: { ticker: "260821P24500", expiration_date: "2026-08-21", strike_price: "24500", option_type: "PUT" },
      units: -2,
      price: 5.68,
      average_purchase_price: 93.00,
      open_pnl: 365.52
    },
    {
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260821P24800", description: "/MNQU6 Aug 21 24800 Put" },
      option_symbol: { ticker: "260821P24800", expiration_date: "2026-08-21", strike_price: "24800", option_type: "PUT" },
      units: 1,
      price: 2.89,
      average_purchase_price: 117.00,
      open_pnl: -230.71
    },
    // /MNQU6 Sep 18 Put Ratio Spread
    {
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260918P25800", description: "/MNQU6 Sep 18 25800 Put" },
      option_symbol: { ticker: "260918P25800", expiration_date: "2026-09-18", strike_price: "25800", option_type: "PUT" },
      units: -2,
      price: 14.39,
      average_purchase_price: 81.00,
      open_pnl: 53.39
    },
    {
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260918P26100", description: "/MNQU6 Sep 18 26100 Put" },
      option_symbol: { ticker: "260918P26100", expiration_date: "2026-09-18", strike_price: "26100", option_type: "PUT" },
      units: 1,
      price: 8.90,
      average_purchase_price: 96.50,
      open_pnl: -34.40
    },
    // /MESU6 Sep 18 Futures Option
    {
      symbol: { symbol: "/MESU6", raw_symbol: "/MESU6 260918P7050", description: "/MESU6 Sep 18 7050 Put" },
      option_symbol: { ticker: "260918P7050", expiration_date: "2026-09-18", strike_price: "7050", option_type: "PUT" },
      units: -1,
      price: 2.25,
      average_purchase_price: 23.75,
      open_pnl: 39.75
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

  // 1. Check in-memory cache
  if (userSecretsCache[uid] && userSecretsCache[uid].userSecret) {
    return userSecretsCache[uid];
  }

  // 2. Check persistent Firestore database
  const firestoreUser = await loadUserFromFirestore(uid);
  if (firestoreUser && firestoreUser.userSecret) {
    userSecretsCache[uid] = firestoreUser;
    saveUsersCache(userSecretsCache);
    return firestoreUser;
  }

  // 3. Check local file cache
  const localCache = loadUsersCache();
  if (localCache[uid] && localCache[uid].userSecret) {
    userSecretsCache[uid] = localCache[uid];
    await saveUserToFirestore(uid, localCache[uid]);
    return localCache[uid];
  }

  // 4. Register new user in SnapTrade
  try {
    console.log(`[SnapTrade] Registering user in SnapTrade: ${snapTradeUserId}`);
    const regRes = await snaptrade.authentication.registerSnapTradeUser({
      userId: snapTradeUserId,
    });

    const userSecret = regRes.data.userSecret || "";
    const userCredentials = {
      userId: snapTradeUserId,
      userSecret,
    };
    userSecretsCache[uid] = userCredentials;
    saveUsersCache(userSecretsCache);
    await saveUserToFirestore(uid, userCredentials);
    return userCredentials;
  } catch (error: any) {
    console.warn(`[SnapTrade] User already exists or registration issue:`, error.response?.data || error.message);
    
    // If the user already exists in SnapTrade but credentials were lost from legacy storage, 
    // cleanly delete the orphaned SnapTrade user registration and re-register
    try {
      console.log(`[SnapTrade] Recreating user registration for: ${snapTradeUserId}`);
      await snaptrade.authentication.deleteSnapTradeUser({
        userId: snapTradeUserId,
      });
      const reRegRes = await snaptrade.authentication.registerSnapTradeUser({
        userId: snapTradeUserId,
      });
      const userSecret = reRegRes.data.userSecret || "";
      const userCredentials = {
        userId: snapTradeUserId,
        userSecret,
      };
      userSecretsCache[uid] = userCredentials;
      saveUsersCache(userSecretsCache);
      await saveUserToFirestore(uid, userCredentials);
      return userCredentials;
    } catch (resetErr: any) {
      console.error("[SnapTrade] Failed to recreate SnapTrade user:", resetErr.response?.data || resetErr.message);
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

  // 4. Generate Connection Portal Login Link (supports Reconnect mode)
  app.post("/api/snaptrade/portal-url", async (req, res) => {
    const { uid, broker, immediateRedirect, customRedirect, connectionType, reconnect } = req.body;
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
      console.log(`[SnapTrade] Generating portal login URL for user: ${userId}${reconnect ? ` (reconnect: ${reconnect})` : ''}`);

      const loginRes = await snaptrade.authentication.loginSnapTradeUser({
        userId,
        userSecret,
        broker: broker || undefined,
        immediateRedirect: immediateRedirect || false,
        customRedirect: customRedirect || undefined,
        reconnect: reconnect || undefined,
        connectionType: (connectionType as any) || "trade-if-available",
        showCloseButton: true,
        darkMode: true,
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
      let rawPositions: any[] = [];
      let rawData: any = null;

      // 1. Try getUserHoldings first (has full option positions, real open_pnl and average_purchase_price)
      try {
        const holdingsRes = await snaptrade.accountInformation.getUserHoldings({
          accountId,
          userId,
          userSecret,
        });
        rawData = holdingsRes.data;
        const hData: any = holdingsRes.data;
        if (hData) {
          if (Array.isArray(hData.positions)) {
            rawPositions.push(...hData.positions);
          }
          if (Array.isArray(hData.option_positions)) {
            rawPositions.push(...hData.option_positions);
          }
          if (Array.isArray(hData.options_positions)) {
            rawPositions.push(...hData.options_positions);
          }
        }
      } catch (hErr: any) {
        console.warn(`[SnapTrade] getUserHoldings attempt for ${accountId}:`, hErr.message);
      }

      // 2. Fallback to getAllAccountPositions if holdings returned no positions
      if (rawPositions.length === 0) {
        try {
          const posRes = await snaptrade.accountInformation.getAllAccountPositions({
            accountId,
            userId,
            userSecret,
          });
          rawData = rawData || posRes.data;
          const posData: any = posRes.data;
          if (Array.isArray(posData)) {
            rawPositions = posData;
          } else if (posData) {
            const rawResults = posData.results || posData.positions || posData.data || posData.items || [];
            rawPositions = Array.isArray(rawResults) ? [...rawResults] : [];
            if (Array.isArray(posData.options_positions)) {
              rawPositions.push(...posData.options_positions);
            }
            if (Array.isArray(posData.option_positions)) {
              rawPositions.push(...posData.option_positions);
            }
          }
        } catch (pErr: any) {
          console.warn(`[SnapTrade] getAllAccountPositions fallback for ${accountId}:`, pErr.message);
        }
      }

      // 3. Normalize position fields with rich broker metrics
      const positions = rawPositions.map((p: any) => {
        const sym = p.symbol || (p.instrument ? {
          symbol: p.instrument.symbol,
          raw_symbol: p.instrument.raw_symbol,
          description: p.instrument.description
        } : undefined);

        const units = p.units !== undefined ? p.units : (p.quantity !== undefined ? p.quantity : 0);
        const price = p.price !== undefined ? p.price : (p.current_price !== undefined ? p.current_price : (p.market_price !== undefined ? p.market_price : null));
        const avgPrice = p.average_purchase_price !== undefined ? p.average_purchase_price : (p.cost_basis !== undefined ? p.cost_basis : (p.average_price !== undefined ? p.average_price : price));
        const openPnl = p.open_pnl !== undefined ? p.open_pnl : (p.unrealized_pnl !== undefined ? p.unrealized_pnl : (p.pnl !== undefined ? p.pnl : null));
        const totalValue = p.total_value !== undefined ? p.total_value : (p.market_value !== undefined ? p.market_value : (p.value !== undefined ? p.value : null));
        const multiplier = p.multiplier || p.contract_multiplier || p.instrument?.multiplier || p.option_symbol?.multiplier || null;

        return {
          ...p,
          symbol: sym,
          units,
          price,
          average_purchase_price: avgPrice,
          open_pnl: openPnl,
          total_value: totalValue,
          multiplier: multiplier
        };
      });

      console.log(`[SnapTrade] Fetched ${positions.length} positions for account ${accountId}`);
      res.json({
        isMock: false,
        positions,
        raw: rawData
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

  // 10. Force Refresh Brokerage Authorization / Live Data Sync
  app.post("/api/snaptrade/connections/:authorizationId/refresh", async (req, res) => {
    const { authorizationId } = req.params;
    const uid = (req.body.uid as string) || (req.query.uid as string) || "";
    const snaptrade = getSnapTradeClient();

    if (!snaptrade || !uid || authorizationId.startsWith("mock-")) {
      return res.json({ success: true, message: "Mock connection refreshed" });
    }

    try {
      const { userId, userSecret } = await getOrRegisterUser(snaptrade, uid);
      console.log(`[SnapTrade] Refreshing brokerage authorization ${authorizationId} for user ${userId}`);
      
      const refreshRes = await snaptrade.connections.refreshBrokerageAuthorization({
        authorizationId,
        userId,
        userSecret,
      });

      // Also trigger transaction / positions background sync
      try {
        await snaptrade.connections.syncBrokerageAuthorizationTransactions({
          authorizationId,
          userId,
          userSecret,
        });
      } catch (syncErr: any) {
        console.warn(`[SnapTrade] Optional transaction sync notice:`, syncErr.message);
      }

      res.json({ success: true, data: refreshRes.data });
    } catch (error: any) {
      console.error(`[SnapTrade] Error refreshing connection ${authorizationId}:`, error.response?.data || error.message);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to refresh brokerage connection" });
    }
  });

  // 11. Delete / Disconnect Brokerage Connection
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

