# Wiring your scheduler to a Google Sheets database

Nothing about the app's look, feel, or behavior changed. `index.html` and
`styles.css` are untouched. `script.js` got small additions only — every
original line is still there, unmodified (see the diff logic below). All
it does differently now is also push/pull data to a Google Sheet.

## How it works

- The app still keeps an instant local cache (localStorage) exactly like
  before, so it opens and responds with zero delay, same as today.
- Every time it *saves* something (a new booking, a status change, a Zoom
  account edit, the admin email), it now also fires a background request
  to your Google Sheet so the data lands there too.
- On page load, and whenever the admin panel is opened, it quietly pulls
  the latest data from the Sheet and refreshes the screen — so if a
  booking was approved from one device, other devices catch up.
- If the Sheet isn't reachable (or you haven't set it up yet), the app
  just keeps using localStorage like it always has — nothing breaks.

## Setup (10 minutes, one time)

1. **Create the spreadsheet.** Go to sheets.new to create a blank Google Sheet.
   Name it something like "Zoom Scheduler DB".

2. **Add the backend script.**
   - In the Sheet, go to **Extensions → Apps Script**.
   - Delete the placeholder code and paste in the contents of `Code.gs`
     (included alongside this file).
   - Click the disk icon (or Ctrl/Cmd+S) to save the project.

3. **Seed the database.**
   - In the Apps Script editor toolbar, pick `setupSheets` from the
     function dropdown next to the ▶ Run button, then click ▶ Run.
   - The first time, Google will ask you to authorize the script —
     approve it (it only touches this one spreadsheet).
   - Check the spreadsheet — you should now see 3 tabs: `Bookings`,
     `Accounts`, `Settings`, each pre-filled with the same sample data
     your app already ships with.

4. **Deploy as a Web App.**
   - Top-right **Deploy → New deployment**.
   - Click the gear icon next to "Select type" → choose **Web app**.
   - Execute as: **Me**. Who has access: **Anyone**.
   - Click **Deploy**, authorize again if prompted.
   - Copy the **Web app URL** (it ends in `/exec`).

5. **Connect the frontend.**
   - Open `script.js`, find this near the top:
     ```js
     const DB_API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
     ```
   - Replace the placeholder with the URL you copied. Save.

6. That's it — reload the app. Bookings, Zoom accounts, and the admin
   notification email are now backed by your Google Sheet.

## If you change the Apps Script code later

Google doesn't auto-update a deployed `/exec` URL when you edit the
script. After changing `Code.gs`, go to **Deploy → Manage deployments**,
click the pencil icon on your existing deployment, and choose
**New version** → **Deploy**. The URL stays the same.

## Notes

- Multiple admins/users share the same spreadsheet, so it acts as the
  single source of truth — same as a real database, just spreadsheet-shaped.
- You can open the spreadsheet directly any time to eyeball or manually
  fix data; the app will pick up manual edits on its next background sync.
- This only replaces *where data lives* — every validation rule, conflict
  check, approval flow, and calendar rendering rule in `script.js` is
  exactly as it was.
