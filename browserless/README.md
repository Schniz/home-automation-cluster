# Browserless

Headless Chromium at `https://browser.home.hagever.com`, token-authenticated
(the token lives in `environment.secret` next to this file).

## Two ways to use it

1. **Stateless HTTP** (`POST /chromium/function`, `/chromium/content`, ...):
   every call gets a fresh browser with no cookies. Good for one-off reads of
   pages that block datacenter IPs.
2. **WebSocket (Puppeteer)**: connect to
   `wss://browser.home.hagever.com/chromium?token=<TOKEN>` and drive a live
   session. This is the mode for anything interactive: multi-step flows,
   waiting on a human (2FA codes), screenshots.

## Persistent profile

The service config directory is mounted at `/profiles` in the container.
WebSocket clients that want logins and cookies to survive across sessions
launch Chrome with a fixed user data dir inside it:

```
wss://browser.home.hagever.com/chromium?token=<TOKEN>&launch={"userDataDir":"/profiles/main"}
```

Sessions are still stateless unless the client asks for that data dir, so
existing one-off fetches are unaffected. The host directory must be writable
by the container user, otherwise Chrome fails to open the profile.

`TIMEOUT=600000` (10 minutes) because interactive sessions pause on humans;
the previous 60s timeout reaped sessions mid-login.

## Posture

The persistent profile holds live, logged-in sessions on disk. Only log into
accounts that are approved for agent use in this profile, and treat the
service token as a key to those sessions.
