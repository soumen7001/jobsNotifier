# How to Run Jobs Notifier

To start the server (includes Web Dashboard at `http://localhost:3000` & automated cron notifications with deduplication):

```powershell
node server.js
```

Or double-click `start.bat` / `auto-start.bat`.

All sent job notifications are tracked in `sent-history.json` to prevent duplicate alerts.

