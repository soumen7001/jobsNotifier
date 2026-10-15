# ?? Sarkari Jobs Notifier

A powerful WhatsApp bot that automatically scrapes government job postings from [sarkariresult.com](https://www.sarkariresult.com/) and delivers real-time, formatted notifications to your WhatsApp group. With a built-in **deduplication engine**, it ensures you receive each job alert exactly once, keeping your feed clean and relevant.

---

## ? Features

| Feature | Description |
|---|---|
| ?? **Automated Scraping** | Scrapes the latest jobs, admit cards, results, and admissions every 2 hours, ensuring you never miss an opportunity. |
| ?? **WhatsApp Integration** | Sends rich, well-formatted messages directly to your designated WhatsApp group using Baileys, keeping your team informed. |
| ??? **Deduplication Engine** | Intelligently tracks every sent notification in sent-history.json to prevent duplicate alerts and maintain a clean history. |
| ?? **Web Dashboard** | A modern, intuitive glassmorphism command center accessible at http://localhost:3000 for easy monitoring and control. |
| ?? **REST API** | Provides programmatic access to trigger notifications, view history, and integrate with other systems. |
| ?? **Auto-Reconnect** | Ensures high availability with an exponential backoff reconnect mechanism and connection timeout. |
| ?? **Graceful Shutdown** | Safely saves all crucial state on Ctrl+C / SIGTERM to prevent data loss. |
| ?? **Docker Ready** | Includes a production-ready Dockerfile for seamless deployment and scalability. |

---

## ?? Quick Start

### Prerequisites
- **Node.js** v18+
- A WhatsApp account to link via QR code

### 1. Clone & Install

`ash
git clone https://github.com/your-username/jobsNotifier.git
cd jobsNotifier
npm install
`

### 2. Configure Environment

`ash
cp .env.example .env
`

Edit .env and set your WhatsApp group invite link:

`env
WP_GROUP=https://chat.whatsapp.com/YOUR_GROUP_INVITE_CODE
PORT=3000
`

### 3. Start the Server

`ash
node server.js
`

On first run, scan the QR code displayed in your terminal with WhatsApp.

### 4. Access the Dashboard

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ?? REST API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/status | Provides connection status, counters, and uptime. |
| GET | /api/history | Retrieves the full deduplication history of all sent items. |
| GET | /api/send-jobs | Manually triggers job notifications. |
| GET | /api/send-admit-cards | Manually triggers admit card alerts. |
| GET | /api/send-results | Manually triggers result alerts. |
| GET | /api/send-admissions | Manually triggers admission alerts. |

---

## ? Cron Schedule

| Time | Task |
|---|---|
| Every 2 hours | Automatically checks for and sends new job postings. |
| 06:30 AM | Dispatches a digest of new admit cards. |
| 12:10 PM | Sends a mid-day dispatch of new job opportunities. |
| 04:30 PM | Delivers a digest of new results. |
| 08:30 PM | Sends a digest of new admissions. |

---

## ?? Project Structure

`
jobsNotifier-main/
+-- server.js              # Express server, dashboard, and cron engine
+-- scrapper.js            # Standalone scraper (alternative to server.js)
+-- send-notifications.js  # One-shot bulk notification sender
+-- whatsapp.js            # Manages WhatsApp connection with auto-reconnect
+-- history-store.js       # Deduplication engine and sent-history.json management
+-- index.html             # Web dashboard user interface
+-- .env.example           # Template for environment variables
+-- Dockerfile             # Production Docker image configuration
+-- package.json           # Project dependencies and scripts
+-- README.md              # This documentation file
`

---

## ?? Docker Deployment

`ash
docker build -t jobs-notifier .
docker run -d --name jobs-bot \
  -e WP_GROUP="https://chat.whatsapp.com/YOUR_CODE" \
  -p 3000:3000 \
  -v C:\Users\soume\project\jobsNotifier-main/auth:/app/auth \
  -v C:\Users\soume\project\jobsNotifier-main/sent-history.json:/app/sent-history.json \
  jobs-notifier
`

> **Note:** Mount the uth/ folder to persist your WhatsApp session across container restarts, preventing repeated QR code scans.

---

## ??? Deduplication Mechanism

Every notification URL is meticulously tracked in sent-history.json. Before any item is sent, it's filtered through ilterUnsent() — if a URL has already been recorded, it is silently skipped, guaranteeing no duplicate alerts.

To maintain optimal performance and file size, the history is automatically pruned after 60 days.

---

## ?? Contact

**Soumen Bera**
- ?? WhatsApp/Call: +91 7001123760
- ?? Email: soumenbera8509@gmail.com

---

## ?? License

Distributed under the ISC License. See LICENSE for more information.
