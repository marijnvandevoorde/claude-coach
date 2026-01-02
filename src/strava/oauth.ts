import { createServer } from "http";
import { URL } from "url";
import open from "open";
import {
  loadConfig,
  loadTokens,
  saveTokens,
  tokensExist,
  tokensExpired,
  type Tokens,
} from "../lib/config.js";
import { log } from "../lib/logging.js";
import type { StravaTokenResponse } from "./types.js";

const REDIRECT_PORT = 8765;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";

export async function authorize(): Promise<Tokens> {
  const config = loadConfig();
  const { client_id, client_secret } = config.strava;

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set("client_id", client_id);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", "activity:read_all");
  authUrl.searchParams.set("approval_prompt", "auto");

  log.info("Opening browser for Strava authorization...");

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Authorization Failed</h1><p>${error}</p>`);
          server.close();
          reject(new Error(`Authorization failed: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>✅ Authorization Successful!</h1><p>You can close this window.</p>");
          server.close();
          resolve(code);
        }
      }
    });

    server.listen(REDIRECT_PORT, () => {
      open(authUrl.toString());
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server: ${err.message}`));
    });
  });

  log.success("Authorization code received, exchanging for tokens...");

  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id,
      client_secret,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    const error = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data: StravaTokenResponse = await tokenResponse.json();

  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete_id: data.athlete.id,
  };

  saveTokens(tokens);
  log.success(`Authenticated as ${data.athlete.firstname} ${data.athlete.lastname}`);

  return tokens;
}

export async function refreshTokens(): Promise<Tokens> {
  const config = loadConfig();
  const oldTokens = loadTokens();
  const { client_id, client_secret } = config.strava;

  log.start("Refreshing access token...");

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id,
      client_secret,
      refresh_token: oldTokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data: StravaTokenResponse = await response.json();

  const tokens: Tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete_id: oldTokens.athlete_id,
  };

  saveTokens(tokens);
  log.success("Token refreshed");
  return tokens;
}

export async function getValidTokens(): Promise<Tokens> {
  if (!tokensExist()) {
    return authorize();
  }

  const tokens = loadTokens();

  if (tokensExpired(tokens)) {
    return refreshTokens();
  }

  return tokens;
}
