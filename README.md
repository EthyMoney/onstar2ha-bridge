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
4. Node.js 20+ (or Docker).
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
npm install     # postinstall downloads a patched Chromium for the GM login flow
npm run vehicles   # optional: verify auth + list VINs on your account
npm start
```

### Run with Docker (recommended for 24/7 use)

```bash
docker compose up -d --build
docker compose logs -f
```

Tokens are cached in `./tokens/` so the full browser login only happens rarely.
**Keep that folder persistent** — re-authenticating too often trips GM's bot detection.

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
- **"Access Denied" errors**: GM's bot detection. The bridge automatically pauses all
  requests for 6 hours when this happens. Don't restart-loop the app — waiting is the fix.
  If it persists, generate `microsoft_tokens.json` manually with the
  [OnStar Auth Token Saver Firefox extension](https://github.com/metheos/onstar_firefox)
  and drop it into your token folder; it will be used and refreshed for ~60 days.
- **Lock state is optimistic** — OnStar doesn't report live lock status, so the lock entity
  reflects the last command sent from HA.
- **Charge target slider** seeds itself from EV metrics when the vehicle reports it.
- The raw EV metrics JSON is attached to the "EV Charging Metrics Updated" sensor —
  build [template sensors](https://www.home-assistant.io/integrations/template/) from any
  field you want that isn't already a discovered sensor.

## Disclaimer

Unofficial, not affiliated with GM/OnStar. Use at your own risk.
