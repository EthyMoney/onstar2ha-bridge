import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger.js";

const HOUR = 60 * 60 * 1000;
const MAX_BLOCK_MS = 7 * 24 * HOUR;

// GM sometimes returns a token without vehicle info; the saved login is still good.
const INCOMPLETE_TOKEN = /missing vehicle information/i;
const INCOMPLETE_TOKEN_PAUSE_MS = 4 * 60 * 1000;
const LOGIN_REQUIRED = /manual sign-in required/i;
// Failures of the scripted browser login (only reachable with ONSTAR_BROWSER_LOGIN=true).
const BROWSER_LOGIN_FAILED =
  /access denied|timeout \d+ms exceeded|authorization code|\bMFA\b|\bTOTP\b/i;

// Protects the GM login from being hammered. Keeps its state next to the
// tokens so a container restart doesn't reset a pause, and lifts the pause as
// soon as a new microsoft_tokens.json shows up.
export class AuthGuard {
  constructor(tokenLocation) {
    this.msTokenPath = path.join(tokenLocation, "microsoft_tokens.json");
    this.gmTokenPath = path.join(tokenLocation, "gm_tokens.json");
    this.statePath = path.join(tokenLocation, "auth_state.json");
    this.state = this.loadState();
    this.restoreSidelinedTokens();
  }

  // onstarjs2 <= 2.16.7 renames good tokens to *.old when GM returns a token
  // without vehicle info. Put them back so the saved login is used again.
  restoreSidelinedTokens() {
    for (const file of [this.msTokenPath, this.gmTokenPath]) {
      const sidelined = `${file}.old`;
      try {
        if (!fs.existsSync(file) && fs.existsSync(sidelined)) {
          fs.renameSync(sidelined, file);
          logger.warn(`Restored saved login ${path.basename(file)} from ${path.basename(sidelined)}`);
          // Give the restored login a chance even if we were waiting for a new one.
          if (this.state.loginRequired) {
            this.state = { strikes: this.state.strikes };
            this.saveState();
          }
        }
      } catch (err) {
        logger.warn(`Could not restore ${path.basename(sidelined)}:`, err.message);
      }
    }
  }

  loadState() {
    try {
      return JSON.parse(fs.readFileSync(this.statePath, "utf8"));
    } catch {
      return {};
    }
  }

  saveState() {
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(this.state));
    } catch (err) {
      logger.warn("Could not save auth state:", err.message);
    }
  }

  tokenStamp() {
    try {
      return fs.statSync(this.msTokenPath).mtimeMs;
    } catch {
      return 0;
    }
  }

  // Returns a human-readable reason while requests must not be sent, else null.
  blockedReason() {
    const { loginRequired, blockedUntil = 0 } = this.state;
    if (!loginRequired && Date.now() >= blockedUntil) return null;
    const stamp = this.tokenStamp();
    // A transient pause just runs out: the library itself may have refreshed
    // the token file during the failed request, which is not a new login.
    if (!this.state.transient && stamp !== 0 && stamp !== this.state.tokenStamp) {
      logger.info("New microsoft_tokens.json detected, resuming OnStar requests");
      // Keep the strike count: if this login fails too, the next pause is longer.
      this.state = { strikes: this.state.strikes };
      this.saveState();
      return null;
    }
    if (loginRequired) return "login required";
    const until = new Date(blockedUntil).toISOString();
    return this.state.transient
      ? `GM returned an incomplete token, retrying after ${until}`
      : `login paused until ${until}`;
  }

  recordSuccess() {
    if (Object.keys(this.state).length === 0) return;
    this.state = {};
    this.saveState();
  }

  // tokenStamp: tokenStamp() taken before the failed request started, so a
  // token file swapped in while it was in flight still counts as new.
  recordFailure(err, tokenStamp = this.tokenStamp()) {
    const message = err?.message ?? String(err);
    if (INCOMPLETE_TOKEN.test(message)) {
      // Short pause so the rest of this poll doesn't repeat the token exchange.
      // Not a login failure: no strike, and never shortens a longer pause.
      const blockedUntil = Date.now() + INCOMPLETE_TOKEN_PAUSE_MS;
      if (this.state.loginRequired || (this.state.blockedUntil ?? 0) >= blockedUntil) return;
      this.state = { strikes: this.state.strikes, blockedUntil, transient: true };
      this.saveState();
      logger.warn(
        `GM returned a token without vehicle information. Keeping the saved login and pausing requests until ${new Date(blockedUntil).toISOString()}.`,
      );
    } else if (LOGIN_REQUIRED.test(message)) {
      this.state = { strikes: this.state.strikes, loginRequired: true, tokenStamp };
      this.saveState();
      logger.error(
        "OnStar login required. Requests are paused until a new microsoft_tokens.json " +
          `is placed at ${this.msTokenPath} (create it with the OnStar Auth Token Saver ` +
          "Firefox extension: https://github.com/metheos/onstar_firefox). No restart needed.",
      );
    } else if (BROWSER_LOGIN_FAILED.test(message)) {
      // Every failed browser login raises GM's lockout score, so wait longer each time.
      const strikes = (this.state.strikes ?? 0) + 1;
      const blockedUntil =
        Date.now() + Math.min(6 * HOUR * 2 ** (strikes - 1), MAX_BLOCK_MS);
      this.state = { strikes, blockedUntil, tokenStamp };
      this.saveState();
      logger.error(
        `GM rejected the browser login (failure #${strikes}). Pausing all requests until ` +
          `${new Date(blockedUntil).toISOString()}, or until a new microsoft_tokens.json is provided.`,
      );
    }
  }
}
