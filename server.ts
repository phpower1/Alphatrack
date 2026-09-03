import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { Snaptrade, SnaptradeAuth, CommercialApiKeyAuth } from "snaptrade-typescript-sdk";

dotenv.config();

const TASTYTRADE_API_BASE = "https://api.tastytrade.com";

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

// Local cache file for Tastytrade direct sessions
const TASTYTRADE_SESSIONS_FILE = path.join(process.cwd(), ".tastytrade_sessions.json");

let tastytradeClientId = process.env.TASTYTRADE_CLIENT_ID || "";
let tastytradeClientSecret = process.env.TASTYTRADE_CLIENT_SECRET || "";
let tastytradeRedirectUri = process.env.TASTYTRADE_REDIRECT_URI || "";

interface TastytradeSessionData {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // Epoch timestamp in ms
  clientId?: string;
  clientSecret?: string;
  user?: any;
  login?: string;
  updatedAt: string;
  // Legacy session tokens fallback
  sessionToken?: string;
  rememberToken?: string;
}

function loadTastytradeSessionsCache(): Record<string, TastytradeSessionData> {
  try {
    if (fs.existsSync(TASTYTRADE_SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(TASTYTRADE_SESSIONS_FILE, "utf-8"));
    }
  } catch (e) {}
  return {};
}

function saveTastytradeSessionsCache(cache: Record<string, TastytradeSessionData>) {
  try {
    fs.writeFileSync(TASTYTRADE_SESSIONS_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (e) {}
}

let tastytradeSessionsCache = loadTastytradeSessionsCache();

function getTastytradeAuthHeader(session: TastytradeSessionData): string {
  if (session.accessToken) {
    return session.accessToken.startsWith("Bearer ") ? session.accessToken : `Bearer ${session.accessToken}`;
  }
  if (session.sessionToken) {
    return session.sessionToken;
  }
  return "";
}

async function refreshTastytradeOAuthToken(uid: string, session: TastytradeSessionData): Promise<TastytradeSessionData | null> {
  if (!session.refreshToken) return null;
  const clientId = session.clientId || tastytradeClientId;
  const clientSecret = session.clientSecret || tastytradeClientSecret;

  try {
    console.log(`[Tastytrade OAuth] Refreshing access token for user ${uid}...`);
    const tokenRes = await axios.post(`${TASTYTRADE_API_BASE}/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: clientId || undefined,
      client_secret: clientSecret || undefined
    }, {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Alphatrack/1.0"
      },
      timeout: 10000
    });

    const data = tokenRes.data?.data || tokenRes.data || {};
    const newAccessToken = data.access_token || data["access-token"] || data.accessToken;
    const newRefreshToken = data.refresh_token || data["refresh-token"] || data.refreshToken || session.refreshToken;
    const expiresIn = Number(data.expires_in || data["expires-in"] || 900); // 15 mins default

    if (newAccessToken) {
      session = {
        ...session,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresAt: Date.now() + (expiresIn * 1000),
        updatedAt: new Date().toISOString()
      };

      // Also ensure user profile info is up to date
      if (!session.user) {
        try {
          const userRes = await axios.get(`${TASTYTRADE_API_BASE}/customers/me`, {
            headers: {
              Authorization: `Bearer ${newAccessToken}`,
              Accept: "application/json",
              "User-Agent": "Alphatrack/1.0"
            },
            timeout: 5000
          });
          session.user = userRes.data?.data || userRes.data;
        } catch (uErr) {}
      }

      await saveTastytradeSession(uid, session);
      console.log(`[Tastytrade OAuth] Successfully refreshed access token for user ${uid}`);
      return session;
    }
  } catch (err: any) {
    console.error(`[Tastytrade OAuth] Refresh token error for ${uid}:`, err.response?.data || err.message);
  }
  return null;
}

async function getTastytradeSession(uid: string): Promise<TastytradeSessionData | null> {
  if (!uid) return null;
  let session = tastytradeSessionsCache[uid];
  if (!session && firestoreDb) {
    try {
      const snap = await firestoreDb.collection("tastytrade_sessions").doc(uid).get();
      if (snap.exists) {
        session = snap.data() as TastytradeSessionData;
        tastytradeSessionsCache[uid] = session;
      }
    } catch (e: any) {
      console.warn(`[Firestore Admin] Could not read Tastytrade session for ${uid}:`, e.message);
    }
  }

  if (!session) return null;

  // 1. Check OAuth 2.0 session (has refreshToken)
  if (session.refreshToken) {
    const isExpired = !session.accessToken || !session.expiresAt || (Date.now() >= session.expiresAt - 120000); // 2 min buffer
    if (isExpired) {
      const refreshed = await refreshTastytradeOAuthToken(uid, session);
      if (refreshed) {
        session = refreshed;
      }
    }
    return session;
  }

  // 2. Fallback for legacy session token
  if (session.sessionToken) {
    try {
      // Test if session is still alive
      await axios.get(`${TASTYTRADE_API_BASE}/customers/me`, {
        headers: {
          Authorization: session.sessionToken,
          Accept: "application/json",
          "User-Agent": "Alphatrack/1.0"
        },
        timeout: 4000
      });
      return session;
    } catch (err: any) {
      // If 401 and rememberToken exists, refresh session with Tastytrade
      if (err.response?.status === 401 && session.rememberToken && session.login) {
        try {
          console.log(`[Tastytrade] Session expired for ${uid}. Re-authenticating with rememberToken...`);
          const refreshRes = await axios.post(`${TASTYTRADE_API_BASE}/sessions`, {
            login: session.login,
            "remember-token": session.rememberToken,
            remember_token: session.rememberToken,
            "remember-me": true,
            remember_me: true
          }, {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "User-Agent": "Alphatrack/1.0"
            }
          });

          const newSessionToken = refreshRes.data?.data?.["session-token"];
          const newRememberToken = refreshRes.data?.data?.["remember-token"] || session.rememberToken;
          const user = refreshRes.data?.data?.user || session.user;

          if (newSessionToken) {
            session = {
              sessionToken: newSessionToken,
              rememberToken: newRememberToken,
              user,
              login: session.login,
              updatedAt: new Date().toISOString()
            };
            await saveTastytradeSession(uid, session);
            console.log(`[Tastytrade] Successfully re-authenticated user ${uid}`);
            return session;
          }
        } catch (rErr: any) {
          console.warn(`[Tastytrade] RememberToken re-auth failed for ${uid}:`, rErr.response?.data || rErr.message);
        }
      }
      return session;
    }
  }

  return session || null;
}

async function saveTastytradeSession(uid: string, data: TastytradeSessionData) {
  tastytradeSessionsCache[uid] = data;
  saveTastytradeSessionsCache(tastytradeSessionsCache);
  if (firestoreDb) {
    try {
      await firestoreDb.collection("tastytrade_sessions").doc(uid).set(data, { merge: true });
      console.log(`[Firestore Admin] Persisted Tastytrade session for ${uid}`);
    } catch (e: any) {
      console.warn(`[Firestore Admin] Could not persist Tastytrade session for ${uid}:`, e.message);
    }
  }
}

async function deleteTastytradeSession(uid: string) {
  delete tastytradeSessionsCache[uid];
  saveTastytradeSessionsCache(tastytradeSessionsCache);
  if (firestoreDb) {
    try {
      await firestoreDb.collection("tastytrade_sessions").doc(uid).delete();
      console.log(`[Firestore Admin] Deleted Tastytrade session for ${uid}`);
    } catch (e: any) {
      console.warn(`[Firestore Admin] Could not delete Tastytrade session for ${uid}:`, e.message);
    }
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
      required_capital: 193.00,
      cap_req: 193.00,
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
      required_capital: 1160.38,
      cap_req: 1160.38,
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
      required_capital: 900.55,
      cap_req: 900.55,
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
      price: 18.79,
      average_purchase_price: 81.00,
      cost_basis: 324.00,
      open_pnl: 125.79,
      cap_req: 1160.38,
      required_capital: 1160.38
    },
    {
      symbol: { symbol: "/MNQU6", raw_symbol: "/MNQU6 260918P26100", description: "/MNQU6 Sep 18 26100 Put" },
      option_symbol: { ticker: "260918P26100", expiration_date: "2026-09-18", strike_price: "26100", option_type: "PUT" },
      units: 1,
      price: 58.90,
      average_purchase_price: 96.50,
      cost_basis: -193.00,
      open_pnl: -75.44,
      cap_req: 0,
      required_capital: 193.00
    },
    // /MESU6 Sep 18 Futures Option
    {
      symbol: { symbol: "/MESU6", raw_symbol: "/MESU6 260918P7050", description: "/MESU6 Sep 18 7050 Put" },
      option_symbol: { ticker: "260918P7050", expiration_date: "2026-09-18", strike_price: "7050", option_type: "PUT" },
      units: -1,
      price: 8.25,
      average_purchase_price: 23.75,
      cost_basis: 118.75,
      open_pnl: 60.75,
      cap_req: 900.55,
      required_capital: 900.55
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

  // Prevent caching on all API endpoints so refresh always returns real-time data
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });

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

  // ==========================================
  // TASTYTRADE DIRECT OAUTH 2.0 & API PROXY
  // ==========================================

  // T0. Tastytrade OAuth Status & Configuration
  app.get("/api/tastytrade/config", (req, res) => {
    const isConfigured = Boolean(tastytradeClientId && tastytradeClientSecret);
    res.json({
      isConfigured,
      clientIdMasked: tastytradeClientId ? `${tastytradeClientId.slice(0, 6)}...${tastytradeClientId.slice(-4)}` : null,
      redirectUri: tastytradeRedirectUri || null
    });
  });

  // T0.1 Update Tastytrade OAuth Credentials dynamically
  app.post("/api/tastytrade/configure", (req, res) => {
    const { clientId, clientSecret, redirectUri } = req.body;
    if (clientId) tastytradeClientId = clientId.trim();
    if (clientSecret) tastytradeClientSecret = clientSecret.trim();
    if (redirectUri) tastytradeRedirectUri = redirectUri.trim();

    console.log(`[Tastytrade OAuth] Configured Client ID: ${tastytradeClientId ? `${tastytradeClientId.slice(0, 6)}...` : 'empty'}`);
    res.json({
      success: true,
      isConfigured: Boolean(tastytradeClientId && tastytradeClientSecret)
    });
  });

  // T0.2 Generate Tastytrade OAuth 2.0 Authorization URL
  app.get("/api/tastytrade/oauth/url", (req, res) => {
    const uid = (req.query.uid as string) || "";
    if (!uid) {
      return res.status(400).json({ error: "Missing user UID in request" });
    }

    const clientId = (req.query.clientId as string) || tastytradeClientId;
    if (!clientId) {
      return res.status(400).json({ 
        error: "Tastytrade OAuth Client ID is not configured. Please configure your Tastytrade Client ID and Secret in settings or .env file." 
      });
    }

    const host = req.get("host") || "localhost:3000";
    const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
    const defaultCallback = `${protocol}://${host}/api/tastytrade/oauth/callback`;
    const redirectUri = (req.query.redirectUri as string) || tastytradeRedirectUri || defaultCallback;

    // Tastytrade OAuth Authorization URL (hosted at /auth.html)
    const authUrl = `https://my.tastytrade.com/auth.html?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=read&state=${encodeURIComponent(uid)}`;

    console.log(`[Tastytrade OAuth] Generated OAuth URL for UID: ${uid} (Callback: ${redirectUri})`);
    res.json({
      authUrl,
      redirectUri,
      clientId: `${clientId.slice(0, 6)}...`
    });
  });

  // T0.3 OAuth 2.0 Callback Handler (Exchanges code for tokens)
  app.get("/api/tastytrade/oauth/callback", async (req, res) => {
    const code = (req.query.code as string) || "";
    const state = (req.query.state as string) || ""; // Carries the Firebase UID
    const errorParam = (req.query.error as string) || (req.query.error_description as string) || "";

    if (errorParam) {
      console.error(`[Tastytrade OAuth Callback] Error from Tastytrade:`, errorParam);
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Tastytrade Authorization Failed</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="background:#0b0e14;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:16px;box-sizing:border-box;">
          <div style="text-align:center;padding:32px;background:#131722;border-radius:16px;border:1px solid #ef444455;max-width:420px;width:100%;">
            <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
            <h2 style="color:#ef4444;margin:0 0 8px 0;font-size:18px;">Tastytrade Connection Denied</h2>
            <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:20px;">${errorParam}</p>
            <button onclick="window.close()" style="background:#ef4444;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">Close Window</button>
          </div>
        </body>
        </html>
      `);
    }

    if (!code || !state) {
      return res.status(400).send("Missing code or state parameter in OAuth callback");
    }

    const uid = state;
    const host = req.get("host") || "localhost:3000";
    const protocol = req.protocol === "https" || req.get("x-forwarded-proto") === "https" ? "https" : "http";
    const defaultCallback = `${protocol}://${host}/api/tastytrade/oauth/callback`;
    const redirectUri = tastytradeRedirectUri || defaultCallback;

    try {
      console.log(`[Tastytrade OAuth] Exchanging authorization code for UID: ${uid}...`);
      const tokenRes = await axios.post(`${TASTYTRADE_API_BASE}/oauth/token`, {
        grant_type: "authorization_code",
        code,
        client_id: tastytradeClientId,
        client_secret: tastytradeClientSecret,
        redirect_uri: redirectUri
      }, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Alphatrack/1.0"
        },
        timeout: 15000
      });

      const tokenData = tokenRes.data?.data || tokenRes.data || {};
      const accessToken = tokenData.access_token || tokenData["access-token"] || tokenData.accessToken;
      const refreshToken = tokenData.refresh_token || tokenData["refresh-token"] || tokenData.refreshToken;
      const expiresIn = Number(tokenData.expires_in || tokenData["expires-in"] || 900);

      if (!accessToken || !refreshToken) {
        throw new Error("Tastytrade OAuth did not return access_token or refresh_token");
      }

      // Fetch user info with new Bearer token
      let user = null;
      try {
        const userRes = await axios.get(`${TASTYTRADE_API_BASE}/customers/me`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "User-Agent": "Alphatrack/1.0"
          },
          timeout: 5000
        });
        user = userRes.data?.data || userRes.data;
      } catch (uErr: any) {
        console.warn(`[Tastytrade OAuth] Could not fetch customer info immediately:`, uErr.message);
      }

      const sessionData: TastytradeSessionData = {
        accessToken,
        refreshToken,
        expiresAt: Date.now() + (expiresIn * 1000),
        clientId: tastytradeClientId,
        clientSecret: tastytradeClientSecret,
        user,
        login: user?.email || user?.["external-id"] || undefined,
        updatedAt: new Date().toISOString()
      };

      await saveTastytradeSession(uid, sessionData);
      console.log(`[Tastytrade OAuth] Successfully authenticated and saved OAuth 2.0 session for user ${uid}`);

      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Tastytrade Connected</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="background:#0b0e14;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:16px;box-sizing:border-box;">
          <div style="text-align:center;padding:32px;background:#131722;border-radius:16px;border:1px solid #22c55e55;max-width:420px;width:100%;">
            <div style="font-size:36px;margin-bottom:12px;">🍒</div>
            <h2 style="color:#22c55e;margin:0 0 8px 0;font-size:18px;">Tastytrade Connected!</h2>
            <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:16px;">OAuth 2.0 persistent session successfully authorized. Alphatrack is syncing your live accounts and positions.</p>
            <div style="font-size:11px;color:#64748b;">This window will close automatically...</div>
          </div>
          <script>
            try {
              if (window.opener && !window.opener.closed) {
                window.opener.postMessage({ type: 'TASTYTRADE_OAUTH_SUCCESS', uid: '${uid}' }, '*');
                setTimeout(() => window.close(), 1200);
              } else {
                setTimeout(() => { window.location.href = '/'; }, 1500);
              }
            } catch (e) {
              setTimeout(() => { window.location.href = '/'; }, 1500);
            }
          </script>
        </body>
        </html>
      `);
    } catch (err: any) {
      console.error(`[Tastytrade OAuth Callback Error]:`, err.response?.data || err.message);
      const errMsg = err.response?.data?.error?.message || err.response?.data?.error_description || err.message || "Failed to exchange OAuth token";
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Tastytrade OAuth Error</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="background:#0b0e14;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:16px;box-sizing:border-box;">
          <div style="text-align:center;padding:32px;background:#131722;border-radius:16px;border:1px solid #ef444455;max-width:420px;width:100%;">
            <div style="font-size:32px;margin-bottom:12px;">⚠️</div>
            <h2 style="color:#ef4444;margin:0 0 8px 0;font-size:18px;">Authentication Failed</h2>
            <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin-bottom:20px;">${errMsg}</p>
            <button onclick="window.close()" style="background:#ef4444;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:13px;font-weight:bold;cursor:pointer;">Close Window</button>
          </div>
        </body>
        </html>
      `);
    }
  });

  // T0.4 Manual Personal OAuth Grant / Refresh Token Connection
  app.post("/api/tastytrade/oauth/manual", async (req, res) => {
    const { uid, refreshToken, clientId, clientSecret } = req.body;
    if (!uid || !refreshToken) {
      return res.status(400).json({ error: "UID and Refresh Token are required" });
    }

    const effectiveClientId = clientId ? clientId.trim() : tastytradeClientId;
    const effectiveClientSecret = clientSecret ? clientSecret.trim() : tastytradeClientSecret;

    try {
      console.log(`[Tastytrade OAuth Manual] Authenticating user ${uid} with personal Refresh Token...`);
      const tokenRes = await axios.post(`${TASTYTRADE_API_BASE}/oauth/token`, {
        grant_type: "refresh_token",
        refresh_token: refreshToken.trim(),
        client_id: effectiveClientId || undefined,
        client_secret: effectiveClientSecret || undefined
      }, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Alphatrack/1.0"
        },
        timeout: 10000
      });

      const tokenData = tokenRes.data?.data || tokenRes.data || {};
      const accessToken = tokenData.access_token || tokenData["access-token"] || tokenData.accessToken;
      const newRefreshToken = tokenData.refresh_token || tokenData["refresh-token"] || tokenData.refreshToken || refreshToken.trim();
      const expiresIn = Number(tokenData.expires_in || tokenData["expires-in"] || 900);

      if (!accessToken) {
        return res.status(500).json({ error: "No access token received from Tastytrade" });
      }

      // Fetch user profile info
      let user = null;
      try {
        const userRes = await axios.get(`${TASTYTRADE_API_BASE}/customers/me`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "User-Agent": "Alphatrack/1.0"
          },
          timeout: 5000
        });
        user = userRes.data?.data || userRes.data;
      } catch (uErr) {}

      const sessionData: TastytradeSessionData = {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: Date.now() + (expiresIn * 1000),
        clientId: effectiveClientId || undefined,
        clientSecret: effectiveClientSecret || undefined,
        user,
        login: user?.email || undefined,
        updatedAt: new Date().toISOString()
      };

      await saveTastytradeSession(uid, sessionData);
      console.log(`[Tastytrade OAuth Manual] Session saved for user ${uid}`);

      res.json({
        success: true,
        user,
        accessTokenMasked: `${accessToken.slice(0, 6)}...`
      });
    } catch (err: any) {
      console.error(`[Tastytrade OAuth Manual Error]:`, err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ 
        error: err.response?.data?.error?.message || err.response?.data?.error_description || err.message || "Failed to authenticate with Refresh Token" 
      });
    }
  });

  // T1. Legacy Tastytrade Login / 2FA verification fallback
  app.post("/api/tastytrade/login", async (req, res) => {
    const { login, password, otp, rememberMe, uid } = req.body;

    if (!uid) {
      return res.status(400).json({ error: "Missing Firebase User UID" });
    }
    if (!login && !otp) {
      return res.status(400).json({ error: "Login username/email and password are required" });
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Alphatrack/1.0"
      };

      if (otp) {
        headers["X-Tastyworks-OTP"] = String(otp).trim();
      }

      console.log(`[Tastytrade] Authenticating user ${login || uid}${otp ? ' with 2FA OTP code' : ''}...`);

      const sessionRes = await axios.post(`${TASTYTRADE_API_BASE}/sessions`, {
        login: login ? login.trim() : undefined,
        password: password || undefined,
        remember_me: rememberMe !== false
      }, {
        headers,
        validateStatus: (status) => status < 500
      });

      if (sessionRes.status === 201) {
        const sessionToken = sessionRes.data?.data?.["session-token"];
        const rememberToken = sessionRes.data?.data?.["remember-token"];
        const user = sessionRes.data?.data?.user;

        if (!sessionToken) {
          return res.status(500).json({ error: "No session token received from Tastytrade" });
        }

        await saveTastytradeSession(uid, {
          sessionToken,
          rememberToken,
          user,
          login: login ? login.trim() : undefined,
          updatedAt: new Date().toISOString()
        });

        console.log(`[Tastytrade] Authentication successful for user ${user?.email || login}`);
        return res.json({
          success: true,
          user,
          login: login ? login.trim() : undefined,
          sessionToken,
          rememberToken,
          sessionTokenMasked: `${sessionToken.slice(0, 6)}...`
        });
      }

      // Check if 2FA or Device Authentication Challenge is required (HTTP 401)
      const resStr = JSON.stringify(sessionRes.data || {}).toLowerCase();
      const otpHeader = String(sessionRes.headers["x-tastyworks-otp"] || sessionRes.headers["X-Tastyworks-OTP"] || "").toLowerCase();

      const is2FARequired = sessionRes.status === 401 && (
        otpHeader.includes("required") ||
        resStr.includes("device") ||
        resStr.includes("challenge") ||
        resStr.includes("two-factor") ||
        resStr.includes("2fa") ||
        resStr.includes("otp") ||
        resStr.includes("verification")
      );

      if (is2FARequired) {
        console.log(`[Tastytrade] 2FA / Device Authentication Challenge triggered for user ${login}`);
        return res.json({
          requires2FA: true,
          message: "Device verification required. Please enter the 6-digit verification code sent to your phone (SMS) or Authenticator App."
        });
      }

      const errMsg = sessionRes.data?.error?.message || sessionRes.data?.message || "Invalid Tastytrade credentials";
      console.warn(`[Tastytrade] Login rejected:`, errMsg);
      return res.status(sessionRes.status || 401).json({ error: errMsg });

    } catch (err: any) {
      console.error(`[Tastytrade] Login error:`, err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ error: err.response?.data?.error?.message || err.message || "Failed to authenticate with Tastytrade" });
    }
  });

  // T2. Tastytrade Connection Status
  app.get("/api/tastytrade/status", async (req, res) => {
    const uid = (req.query.uid as string) || "";
    if (!uid) {
      return res.json({ isConnected: false });
    }

    const session = await getTastytradeSession(uid);
    if (!session || (!session.accessToken && !session.sessionToken)) {
      return res.json({ isConnected: false });
    }

    res.json({
      isConnected: true,
      user: session.user,
      login: session.login || session.user?.email,
      authType: session.refreshToken ? "oauth" : "legacy",
      updatedAt: session.updatedAt
    });
  });

  // T3. Get User Accounts from Tastytrade
  app.get("/api/tastytrade/accounts", async (req, res) => {
    const uid = (req.query.uid as string) || "";
    const session = await getTastytradeSession(uid);

    if (!session || (!session.accessToken && !session.sessionToken)) {
      return res.status(401).json({ error: "Tastytrade account is not connected. Please connect with OAuth." });
    }

    try {
      const accRes = await axios.get(`${TASTYTRADE_API_BASE}/customers/me/accounts`, {
        headers: {
          Authorization: getTastytradeAuthHeader(session),
          Accept: "application/json",
          "User-Agent": "Alphatrack/1.0"
        }
      });

      const items = accRes.data?.data?.items || [];
      const formattedAccounts = items.map((item: any) => {
        const a = item.account || item;
        return {
          id: `tasty-${a["account-number"]}`,
          brokerage_authorization: `tasty-auth-${a["account-number"]}`,
          number: a["account-number"],
          name: a.nickname || `Tastytrade ${a["account-type-name"] || "Account"}`,
          institution_name: "Tastytrade",
          is_futures_approved: a["is-futures-approved"],
          account_type: a["account-type-name"],
          is_closed: a["is-closed"],
          sync_status: { initial_sync_completed: true }
        };
      });

      console.log(`[Tastytrade] Fetched ${formattedAccounts.length} live accounts for user ${uid}`);
      res.json({
        success: true,
        items: formattedAccounts
      });
    } catch (err: any) {
      console.error(`[Tastytrade] Error fetching accounts:`, err.response?.data || err.message);
      if (err.response?.status === 401) {
        await deleteTastytradeSession(uid);
      }
      res.status(err.response?.status || 500).json({ error: err.response?.data?.error?.message || "Failed to fetch Tastytrade accounts" });
    }
  });

  // T4. Get Live Native Positions (Includes /MES, /MNQ Micro Futures Options)
  app.get("/api/tastytrade/accounts/:accountNumber/positions", async (req, res) => {
    const { accountNumber } = req.params;
    const cleanAccNum = accountNumber.replace(/^tasty-/, "");
    const uid = (req.query.uid as string) || "";
    const session = await getTastytradeSession(uid);

    if (!session || (!session.accessToken && !session.sessionToken)) {
      return res.status(401).json({ error: "Tastytrade account not connected" });
    }

    try {
      const posRes = await axios.get(`${TASTYTRADE_API_BASE}/accounts/${cleanAccNum}/positions`, {
        headers: {
          Authorization: getTastytradeAuthHeader(session),
          Accept: "application/json",
          "User-Agent": "Alphatrack/1.0"
        }
      });

      const rawItems = posRes.data?.data?.items || [];
      console.log(`[Tastytrade] Fetched ${rawItems.length} native positions for account ${cleanAccNum}`);

      // Normalize raw Tastytrade position records
      const positions = rawItems.map((p: any) => {
        const symbol = p.symbol || p["symbol"] || "";
        const underlyingSymbol = p["underlying-symbol"] || p.underlying_symbol || "";
        const instrumentType = p["instrument-type"] || p.instrument_type || "Option";
        const rawUnits = Math.abs(parseFloat(p.quantity || p["quantity"] || "1"));
        const isShort = p["quantity-direction"] === "Short" || p.quantity_direction === "Short" || parseFloat(p.quantity || "0") < 0;
        const quantity = isShort ? -rawUnits : rawUnits;
        const multiplier = parseFloat(p.multiplier || p["multiplier"] || "1");
        const avgPrice = parseFloat(p["average-open-price"] || p.average_open_price || "0");
        const closePrice = parseFloat(p["close-price"] || p["mark-price"] || p.mark || "0");
        const costBasis = parseFloat(p["cost-basis"] || p.cost_basis || "0");
        const realizedDayGain = parseFloat(p["realized-day-gain"] || p.realized_day_gain || "0");
        const extrinsicValue = parseFloat(p["extrinsic-value"] || p.extrinsic_value || "0");
        const capReq = parseFloat(
          p["margin-requirement"] ||
          p.margin_requirement ||
          p["buying-power-requirement"] ||
          p.buying_power_requirement ||
          p["cap-req"] ||
          p.cap_req ||
          p["capital-requirement"] ||
          p.capital_requirement ||
          p["maintenance-requirement"] ||
          p.maintenance_requirement ||
          "0"
        );

        // Calculate exact open PnL based on position direction
        let openPnl = 0;
        if (p["unrealized-gain"] !== undefined && p["unrealized-gain"] !== null && !isNaN(parseFloat(p["unrealized-gain"]))) {
          openPnl = parseFloat(p["unrealized-gain"]);
        } else if (p.unrealized_gain !== undefined && p.unrealized_gain !== null && !isNaN(parseFloat(p.unrealized_gain))) {
          openPnl = parseFloat(p.unrealized_gain);
        } else {
          const pnlPoints = isShort ? (avgPrice - closePrice) : (closePrice - avgPrice);
          openPnl = +(pnlPoints * rawUnits * multiplier).toFixed(2);
        }

        const marketValue = +(rawUnits * closePrice * multiplier).toFixed(2);

        return {
          symbol,
          underlying_symbol: underlyingSymbol,
          instrument_type: instrumentType,
          quantity,
          action: isShort ? "STO" : "BTO",
          multiplier,
          average_purchase_price: avgPrice,
          price: closePrice,
          current_price: closePrice,
          cost_basis: costBasis,
          total_value: marketValue,
          extrinsic_value: extrinsicValue,
          realized_day_gain: realizedDayGain,
          open_pnl: openPnl,
          cap_req: capReq > 0 ? capReq : undefined,
          required_capital: capReq > 0 ? capReq : undefined,
          raw: p
        };
      });

      res.json({
        success: true,
        positions,
        rawItems
      });
    } catch (err: any) {
      console.error(`[Tastytrade] Error fetching positions for ${cleanAccNum}:`, err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ error: err.response?.data?.error?.message || "Failed to fetch live positions from Tastytrade" });
    }
  });

  // T5. Get Live Account Balances
  app.get("/api/tastytrade/accounts/:accountNumber/balances", async (req, res) => {
    const { accountNumber } = req.params;
    const cleanAccNum = accountNumber.replace(/^tasty-/, "");
    const uid = (req.query.uid as string) || "";
    const session = await getTastytradeSession(uid);

    if (!session || (!session.accessToken && !session.sessionToken)) {
      return res.status(401).json({ error: "Tastytrade account not connected" });
    }

    try {
      const balRes = await axios.get(`${TASTYTRADE_API_BASE}/accounts/${cleanAccNum}/balances`, {
        headers: {
          Authorization: getTastytradeAuthHeader(session),
          Accept: "application/json",
          "User-Agent": "Alphatrack/1.0"
        }
      });

      const b = balRes.data?.data || {};
      const netLiq = parseFloat(b["net-liquidating-value"] || "0");
      const cash = parseFloat(b["cash-balance"] || "0");
      const derivativeBuyingPower = parseFloat(b["derivative-buying-power"] || "0");
      const equityBuyingPower = parseFloat(b["equity-buying-power"] || "0");
      const maintenanceReq = parseFloat(b["maintenance-requirement"] || "0");

      res.json({
        success: true,
        total: { amount: netLiq, currency: "USD" },
        cash: { amount: cash, currency: "USD" },
        derivative_buying_power: derivativeBuyingPower,
        equity_buying_power: equityBuyingPower,
        maintenance_requirement: maintenanceReq,
        raw: b
      });
    } catch (err: any) {
      console.error(`[Tastytrade] Error fetching balances for ${cleanAccNum}:`, err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ error: err.response?.data?.error?.message || "Failed to fetch balances from Tastytrade" });
    }
  });

  // T6. Get Live Account Transactions / Trades History
  app.get("/api/tastytrade/accounts/:accountNumber/transactions", async (req, res) => {
    const { accountNumber } = req.params;
    const cleanAccNum = accountNumber.replace(/^tasty-/, "");
    const uid = (req.query.uid as string) || "";
    const startDate = (req.query.startDate as string) || undefined;
    const session = await getTastytradeSession(uid);

    if (!session || (!session.accessToken && !session.sessionToken)) {
      return res.status(401).json({ error: "Tastytrade account not connected" });
    }

    try {
      let url = `${TASTYTRADE_API_BASE}/accounts/${cleanAccNum}/transactions?per-page=250`;
      if (startDate) {
        url += `&start-date=${encodeURIComponent(startDate)}`;
      }

      const txRes = await axios.get(url, {
        headers: {
          Authorization: getTastytradeAuthHeader(session),
          Accept: "application/json",
          "User-Agent": "Alphatrack/1.0"
        }
      });

      const items = txRes.data?.data?.items || [];
      console.log(`[Tastytrade] Fetched ${items.length} transactions for account ${cleanAccNum}`);

      res.json({
        success: true,
        data: items
      });
    } catch (err: any) {
      console.error(`[Tastytrade] Error fetching transactions for ${cleanAccNum}:`, err.response?.data || err.message);
      res.status(err.response?.status || 500).json({ error: err.response?.data?.error?.message || "Failed to fetch transactions from Tastytrade" });
    }
  });

  // T7. Logout Tastytrade Direct Connection
  app.post("/api/tastytrade/logout", async (req, res) => {
    const { uid } = req.body;
    if (uid) {
      await deleteTastytradeSession(uid);
    }
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    // Development SPA HTML fallback with transformIndexHtml
    app.use("*", async (req, res, next) => {
      if (req.originalUrl.startsWith("/api")) {
        return next();
      }
      try {
        const url = req.originalUrl;
        const indexPath = path.resolve(process.cwd(), "index.html");
        let template = fs.readFileSync(indexPath, "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({
          "Content-Type": "text/html",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, {
      index: false,
      maxAge: "1d",
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
      }
    }));
    app.get('*', (req, res) => {
      if (req.originalUrl.startsWith("/api")) {
        return res.status(404).json({ error: "API endpoint not found" });
      }
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      });
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

