# Fashion Fusion ITAMLS — Mobile

React Native (Expo) companion app for IT technicians and store managers.

## What's in Phase 1

- Login (JWT against the same API as the web app), session persisted in AsyncStorage
- Bottom-tab navigation: Home · Scan · Audits · Me
- Home: live KPIs (assets in scope, active alerts, warranty bands)
- Scan: native camera with QR overlay; resolves an asset QR (`/assets/:id`) to an Asset Detail screen
- Asset Detail: tag, model, status, location, store, warranty, supplier, history timeline
- Audits: list scheduled/in-progress audits with status
- Me: profile, store, configured API base URL, sign-out

Coming next (Phase 2): receive dispatch with on-device signature; log fault from an asset; offline cache + queued mutations; audit scan + variance flagging.

## Requirements

- Node 20+, pnpm 9+ (managed at the monorepo root)
- Expo Go app on your phone (App Store / Play Store) **OR** Android Studio / Xcode for emulators

## First-time setup

From the monorepo root:

```powershell
pnpm install
```

## Configure the API URL

The mobile app cannot reach `localhost:4000` on your laptop — `localhost` on a phone means *the phone itself*. Use your laptop's LAN IP.

1. Find your laptop's IP. In PowerShell:
   ```powershell
   ipconfig | findstr IPv4
   ```
   Use something like `192.168.1.42`.
2. Open `apps/mobile/app.json` and edit:
   ```json
   "extra": { "apiBaseUrl": "http://192.168.1.42:4000/api/v1" }
   ```
3. The API must be reachable from your phone's network. Make sure your laptop's firewall allows inbound port 4000 from the LAN.

## Run it

```powershell
pnpm --filter @itamls/mobile start
```

This opens Metro. Either:

- **Phone**: install Expo Go, scan the QR code shown in the terminal (must be on the same Wi-Fi).
- **Android emulator**: press `a` in the terminal.
- **iOS simulator** (macOS only): press `i`.

## Branding

The login screen expects the logo image at:

```
apps/mobile/assets/fusion-logo.png
```

Drop the same PNG you used for `apps/web/public/fusion-logo.png` in there.

## Sign in

Same credentials as the web app (`password` for the demo users). For day-to-day use, sign in as `tech@fashionfusion.local`.
