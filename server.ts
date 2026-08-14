import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import axios from "axios";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  const TASTY_BASE_URL = "https://api.tastyworks.com"; // Production Tastyworks API
  const TASTY_OAUTH_URL = "https://api.tastytrade.com"; // Newer Tastytrade OAuth Domain

  const TASTY_CLIENT_ID = process.env.TASTYTRADE_CLIENT_ID || "c8f263c2-f7a9-4e98-b940-59b2eb0ba34b";
  const TASTY_CLIENT_SECRET = process.env.TASTYTRADE_CLIENT_SECRET || "3f851f707017fb8914f1f3005f8aaa567197ab5e";
  
  // NOTE: You must add this exact URI to your Tastytrade Developer Dashboard under "Redirect URIs"
  const TASTY_REDIRECT_URI = process.env.TASTYTRADE_REDIRECT_URI || "https://tastytrade-analytics-j6cuv4cgma-uc.a.run.app/api/tastytrade/callback";
  
  const TASTY_USER_AGENT = "Alphatrack/1.0";

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // 1. Connect / Create Session
  app.post("/api/tt/connect", async (req, res) => {
    console.log("--> Express received POST /api/tt/connect");
    try {
      const { userIdentifier, secretToken, otpCode, isDeveloperMode, clientSecret, refreshToken } = req.body;
      
      // Developer API Route (Using Client Secret + Refresh Token)
      if (isDeveloperMode) {
        if (!clientSecret || !refreshToken) {
          return res.status(400).json({ error: "Client Secret and Refresh Token are required in Developer Mode." });
        }
        
        const payload = {
          refresh_token: refreshToken,
          client_secret: clientSecret,
          grant_type: 'refresh_token'
        };

        const response = await axios.post(`${TASTY_BASE_URL}/oauth/token`, payload, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
          }
        });

        // The OAuth token response returns { access_token: "..." } whereas old sessions return { "session-token": "..." }
        // We MUST prefix it with "Bearer " so the proxy routes pass it correctly to the Tastytrade API
        return res.json({
          "session-token": `Bearer ${response.data.access_token}`,
          ...response.data
        });
      }

      // Standard Legacy Retail Login
      if (!userIdentifier || !secretToken) {
        return res.status(400).json({ error: "Login and password required" });
      }

      const payload: any = {
        login: userIdentifier,
        password: secretToken,
        rememberMe: true
      };

      if (otpCode) {
        payload["remember-token"] = otpCode;
        payload["two-factor-token"] = otpCode;
      }

      const response = await axios.post(`${TASTY_BASE_URL}/sessions`, payload, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });

      res.json(response.data.data); // Contains session-token
    } catch (error: any) {
      console.error("Tastytrade Session Error:", typeof error.response?.data === 'string' ? error.response?.data.substring(0, 100) : error.response?.data || error.message);
      const status = error.response?.status || 500;
      let errorData = error.response?.data;
      
      // Ensure we always return an object with an error message
      if (typeof errorData === 'string') {
        errorData = { error: { message: `Gateway Error (${status}): ` + errorData.substring(0, 150) } };
      } else if (!errorData) {
        errorData = { error: { message: "Failed to authenticate with Tastytrade" } };
      }

      res.status(status).json(errorData);
    }
  });

  // 2. Get Accounts
  app.get("/api/tastytrade/accounts", async (req, res) => {
    console.log("--> Express received GET /api/tastytrade/accounts");
    try {
      const token = req.headers.authorization;
      if (!token) return res.status(401).json({ error: "Missing session token" });

      const response = await axios.get(`${TASTY_BASE_URL}/customers/me/accounts`, {
        headers: { 
          Authorization: token,
          'User-Agent': TASTY_USER_AGENT,
          'Accept': 'application/json'
        }
      });

      console.log("Success fetching accounts. Found:", response.data.data?.items?.length || 0);
      res.json(response.data.data);
    } catch (error: any) {
      console.error("Error fetching accounts:", error.message, error.code, error.response?.status, error.response?.data);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to fetch accounts" });
    }
  });

  // 3. Get Transactions / Trades
  app.get("/api/tastytrade/accounts/:accountId/transactions", async (req, res) => {
    console.log(`--> Express received GET /api/tastytrade/accounts/${req.params.accountId}/transactions`);
    try {
      const token = req.headers.authorization;
      const { accountId } = req.params;
      if (!token) return res.status(401).json({ error: "Missing session token" });

      const response = await axios.get(`${TASTY_BASE_URL}/accounts/${accountId}/transactions`, {
        headers: { 
          Authorization: token,
          'User-Agent': TASTY_USER_AGENT,
          'Accept': 'application/json'
        }
      });

      console.log(`Success fetching transactions for ${accountId}. Found:`, response.data.data?.items?.length || 0);
      res.json(response.data.data);
    } catch (error: any) {
      console.error(`Error fetching transactions for ${req.params.accountId}:`, error.message, error.code, error.response?.status, error.response?.data);
      res.status(error.response?.status || 500).json(error.response?.data || { error: error.message || "Failed to fetch transactions" });
    }
  });

  // 4. Get Balances
  app.get("/api/tastytrade/accounts/:accountId/balances", async (req, res) => {
    try {
      const token = req.headers.authorization;
      const { accountId } = req.params;
      if (!token) return res.status(401).json({ error: "Missing session token" });

      const response = await axios.get(`${TASTY_BASE_URL}/accounts/${accountId}/balances`, {
        headers: { 
          Authorization: token,
          'User-Agent': TASTY_USER_AGENT,
          'Accept': 'application/json'
        }
      });

      res.json(response.data.data);
    } catch (error: any) {
      res.status(error.response?.status || 500).json(error.response?.data || { error: "Failed to fetch balances" });
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
  });
}

startServer();
