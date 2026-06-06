# Sales Tracker App Build Guide

This project now has the foundation for:

- PWA install from browser
- Windows/macOS/Linux desktop app through Electron
- iOS app through Capacitor

## 1. PWA

Deploy the website to Vercel, then visit:

```txt
https://use-sales-tracker.vercel.app/signin.html
```

The browser can install the app because these files now exist:

- `manifest.webmanifest`
- `sw.js`
- `pwa.js`

## 2. Desktop App

Install desktop dependencies:

```bash
npm install electron electron-builder --save-dev
```

Run locally:

```bash
npm run desktop
```

Build installer:

```bash
npm run desktop:build
```

Windows output will be created under `dist/`.

## 3. iOS App

iOS requires a Mac with Xcode.

Install iOS package:

```bash
npm install @capacitor/ios
```

Create iOS project:

```bash
npx cap add ios
npx cap sync ios
npx cap open ios
```

Then build/sign from Xcode with an Apple Developer account.

Windows cannot build the iOS app. The iOS project is scaffolded, but final build, signing, and App Store upload must be done on macOS with Xcode.

## 4. Payment Rule

Keep Paystack payments on the website. Users should subscribe on the website, then log into the desktop/mobile app. This avoids app-store payment rule problems.

## 5. Backend

All app versions use the same backend:

```txt
https://sales-tracker-app-cd7k.onrender.com
```

Keep Render and Supabase running before publishing app builds.

## 6. API URL Rule

The app shell uses the live backend on packaged mobile/desktop apps:

```txt
https://sales-tracker-app-cd7k.onrender.com
```

It only uses the local backend when opened from a browser dev server with a local port, such as:

```txt
http://127.0.0.1:5500
```
