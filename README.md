# onstarjs-2-ha-blazer

A bridge that pulls data from your **Chevy Blazer EV** through
[OnStarJS (onstarjs2)](https://github.com/BigThunderSR/OnStarJS) and publishes it to
**Home Assistant** over MQTT with automatic discovery — no manual YAML needed.

## What you get in Home Assistant

One "Blazer EV" device with:

- **Sensors** for every diagnostic value OnStar reports: EV battery level, EV range,
  charge state, plug state, tire pressures, odometer, ambient temp, 12V battery voltage, etc.
- **Device tracker** — vehicle location on the HA map
- **Lock** entity — lock/unlock doors
- **Number** entity — set the target charge level
- **Buttons** — flash/stop lights, remote start/cancel, stop charging, refresh data,
  refresh EV metrics (wakes the vehicle for fresh telemetry)
- **Diagnostics** — last poll timestamp and poll status

## Prerequisites

1. **An active OnStar plan** (even the basic connected-access tier works for data).
2. **MQTT broker** reachable by both this app and Home Assistant — the
   [Mosquitto add-on](https://www.home-assistant.io/integrations/mqtt/) is the usual choice,
   with the MQTT integration enabled in HA (discovery on, which is the default).
3. **GM account MFA set to "Third-Party Authenticator App"** (required by GM since Nov 2024):
   - From a **desktop browser**, log in at your GM/Chevrolet account security settings.
   - Choose "Third-Party Authenticator App" as your MFA method.
   - During setup, capture the **TOTP secret key** (hover/inspect the link under the QR code,
     or view it in an authenticator like Bitwarden/Stratum). That's your `ONSTAR_TOTP_KEY`.
4. Node.js 24+ (or Docker).
5. **Accurate system clock** (NTP) — TOTP auth fails with clock drift.

## Setup

```bash
git clone <this repo>
cd onstarjs-2-ha-blazer
cp .env.example .env
# edit .env with your credentials, VIN, and MQTT broker details
```

Generate a random v4 UUID once for `ONSTAR_DEVICE_ID` and never change it
(changing it looks like a new device to GM and can trigger bot detection).

### Run directly

```bash
npm install     # postinstall downloads Chromium (optional browser login) and patches onstarjs2
npm run vehicles   # optional: verify auth + list VINs on your account
npm start
```

### Run with Docker (recommended for 24/7 use)

```bash
docker compose up -d --build
docker compose logs -f
```

Tokens are cached in `./tokens/`. **Keep that folder persistent** — it holds your saved GM login.

### Signing in (first run, and about every 60 days)

GM's bot detection now blocks scripted logins, so the bridge does not try to log in by
itself. Instead you sign in once in your own browser and hand it the resulting token file:

1. Install the [OnStar Auth Token Saver](https://github.com/metheos/onstar_firefox) Firefox
   extension and sign in to your GM/Chevrolet account with it, including the verification step.
2. Copy the `microsoft_tokens.json` it saves into the token folder (`./tokens/`, or wherever
   `/app/tokens` is mapped). Treat this file like a password.
3. That's it — the bridge notices the new file on its next poll (no restart needed) and keeps
   it refreshed for about 60 days.

While it is waiting for a sign-in, the **Poll Status** sensor in Home Assistant reads
`login required` and no requests are sent to GM.

Setting `ONSTAR_BROWSER_LOGIN=true` re-enables the old automatic browser login (one attempt,
then an increasing pause of 6 hours up to 7 days after each failure). Not recommended: failed
attempts make GM's block last longer.

### Publish the image to Docker Hub (maintainers)

```bash
docker login
npm run docker:deploy   # build ultimate360/onstar2ha-bridge:<version> and :latest, then push both
```

`npm run docker:build` and `npm run docker:push` run the two halves separately.
The version tag comes from `package.json`, so bump it there before a release.

## MQTT topics

Everything lives under `onstar2ha/<VIN>/`:

| Topic | Purpose |
| --- | --- |
| `available` | `online`/`offline` (LWT) |
| `sensor/<name>/state` | Individual diagnostic values |
| `device_tracker/attributes` | GPS coordinates |
| `ev/attributes` | Full raw EV charging metrics JSON |
| `command` | Accepts: `refresh`, `refresh_ev`, `flash_lights`, `stop_lights`, `start`, `cancel_start`, `stop_charging` |
| `lock/set` | `LOCK` / `UNLOCK` |
| `charge_target/set` | Target charge percent (e.g. `80`) |

## Notes & troubleshooting

- **Polling interval**: default 30 minutes. GM rate-limits aggressively; polling more often
  than every ~10–15 minutes risks temporary blocks. `refresh_ev` wakes the vehicle and uses
  more 12V battery — use it sparingly.
- **Poll Status says `login required`**: the saved login is missing, expired or was rejected.
  Follow [Signing in](#signing-in-first-run-and-about-every-60-days). Restarting won't help
  (and won't hurt — the paused state is remembered in `tokens/auth_state.json`).
- **"Access Denied" errors**: GM's bot detection, only reachable with
  `ONSTAR_BROWSER_LOGIN=true`. Turn that off and sign in with the Firefox extension. If the
  extension's sign-in is refused too, wait a few days and check that the myChevrolet app
  still lets you in.
- **"GM API token was missing vehicle information"**: GM occasionally returns an incomplete
  token. The bridge keeps the saved login, pauses for a few minutes and tries again on the
  next poll. (Older
  versions threw the login away here; any `*.old` token files left behind are restored
  automatically at startup.)
- **Upgrading `onstarjs2`**: the version is pinned because `scripts/patch-onstarjs.mjs`
  patches its login handling at install time. The install fails loudly if the patch no
  longer applies.
- **Lock state is optimistic** — OnStar doesn't report live lock status, so the lock entity
  reflects the last command sent from HA.
- **Charge target slider** seeds itself from EV metrics when the vehicle reports it.
- The raw EV metrics JSON is attached to the "EV Charging Metrics Updated" sensor —
  build [template sensors](https://www.home-assistant.io/integrations/template/) from any
  field you want that isn't already a discovered sensor.

## Disclaimer

Unofficial, not affiliated with GM/OnStar. Use at your own risk.
