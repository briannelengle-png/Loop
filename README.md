# Loop v0.1

Loop is a private, local-first "next attention" queue.

## What it does

- Personal and Work streams
- Pinned priorities
- Today-only rolling queue
- Future items stay out of the main queue until their date arrives
- Tap any task -> Done or Move forward
- Fast move buttons: 10m, 1h, 3h, 24h, or exact date/time
- Completed queue
- Future queue
- Rename, pin/unpin, move between streams
- Local on-device storage (IndexedDB)
- Offline app shell after first load
- Export/restore JSON backups
- No account or login

## Important privacy note

The app files contain NO personal task data. Your tasks are created after Loop runs on your device and are stored locally in that device's browser/web-app storage.

## Easiest hosting route: GitHub Pages

1. Create a free GitHub account if you do not already have one.
2. Create a new PUBLIC repository named something like `loop`.
3. Upload ALL files from this folder to the repository root.
4. In the repository, open Settings -> Pages.
5. Under "Build and deployment", choose "Deploy from a branch".
6. Choose the `main` branch and `/ (root)`, then Save.
7. GitHub will show the published HTTPS address after deployment finishes.

## Put Loop on your iPhone Home Screen

1. Open the published Loop address in Safari.
2. Tap Share.
3. Tap "Add to Home Screen".
4. Turn on "Open as Web App" if iOS shows that option.
5. Name it Loop and tap Add.

After that, open Loop from its Home Screen icon.

## Backups

Inside Loop, tap `•••` -> Export backup.

Save the JSON file in Files or iCloud Drive. To restore, use `•••` -> Restore backup.

## Updating later

If a newer Loop package is uploaded to the same GitHub repository, the service worker will refresh the app files. Your local task database is separate from the app files.

## Files

- `index.html` - app structure
- `styles.css` - visual design
- `app.js` - behavior and local database
- `manifest.webmanifest` - Home Screen/PWA metadata
- `sw.js` - offline caching
- `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` - app icons
