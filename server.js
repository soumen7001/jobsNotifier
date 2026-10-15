import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";
import cron from "node-cron";
import dotenv from "dotenv";
import { connectWhatsApp } from "./whatsapp.js";
import fs from "fs";
import path from "path";
import { filterUnsent, markSent, pruneOldHistory, loadHistory } from "./history-store.js";

dotenv.config();

// ─── Configuration ──────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const SCRAPE_URL = "https://www.sarkariresult.com/";
const AXIOS_TIMEOUT = 15000;
const SEND_DELAY_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0"
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── State ──────────────────────────────────────────────────────
let sock = null;
let groupJid = null;
let isConnected = false;
const startTime = Date.now();
const COUNTER_FILE = path.join(process.cwd(), "notification-count.json");

// ─── Counter Persistence ────────────────────────────────────────
function getToday() {
    return new Date().toISOString().split("T")[0];
}

function loadCounter() {
    try {
        if (fs.existsSync(COUNTER_FILE)) {
            const data = JSON.parse(fs.readFileSync(COUNTER_FILE, "utf-8"));
            const today = getToday();
            if (data.date !== today) {
                return { total: data.total || 0, today: 0, date: today };
            }
            return { total: data.total || 0, today: data.today || 0, date: data.date || today };
        }
    } catch (err) {
        console.error("⚠️ Error loading counter:", err.message);
    }
    return { total: 0, today: 0, date: getToday() };
}

function saveCounter(total, todayCount) {
    try {
        fs.writeFileSync(COUNTER_FILE, JSON.stringify({
            total,
            today: todayCount,
            date: getToday(),
            lastUpdated: new Date().toISOString()
        }));
    } catch (err) {
        console.error("⚠️ Error saving counter:", err.message);
    }
}

let counter = loadCounter();
let totalNotificationsSent = counter.total;
let todayNotificationsSent = counter.today;

// ─── HTTP Fetch with Retry ──────────────────────────────────────
async function fetchWithRetry(url, retries = MAX_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const { data } = await axios.get(url, {
                timeout: AXIOS_TIMEOUT,
                headers: { "User-Agent": getRandomUserAgent() }
            });
            return data;
        } catch (err) {
            const isLast = attempt === retries;
            console.error(`⚠️ Fetch attempt ${attempt}/${retries} failed for ${url}: ${err.message}`);
            if (isLast) throw err;
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        }
    }
}

// ─── Contact Footer ─────────────────────────────────────────────
function getContactFooter() {
    return `\n\n💼 *Need Help Applying?*\nGet professional assistance to complete your job application:\n👤 *Contact:* Soumen Bera\n📞 *Call/WhatsApp:* +91 7001123760\n✉️ *Email:* soumenbera8509@gmail.com`;
}

function getDigestFooter() {
    return `━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ *End of Notification Digest*\n\n📲 *Stay Connected & Never Miss an Opportunity:*\n👉 Join/Follow: *@governmentdailyjob*\n⏰ *Daily updates dispatched every 6 hours.*\n${getContactFooter()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

// ─── WhatsApp Initialization ────────────────────────────────────
app.use(express.json());

async function initWhatsApp() {
    try {
        sock = await connectWhatsApp();
        const groupLink = process.env.WP_GROUP;

        if (!groupLink) {
            throw new Error("WP_GROUP environment variable is not set.");
        }

        if (groupLink.startsWith("https://chat.whatsapp.com/")) {
            const inviteCode = groupLink.split("/").pop();
            groupJid = await sock.groupAcceptInvite(inviteCode);
        } else {
            groupJid = groupLink;
        }

        isConnected = true;
        console.log("✅ WhatsApp connected, group:", groupJid);
    } catch (err) {
        console.error("❌ WhatsApp connection error:", err.message);
        isConnected = false;
    }
}

// ─── Send Helpers ───────────────────────────────────────────────
async function sendMessageWithCounter(chatId, text) {
    try {
        await sock.sendMessage(chatId, { text });
        totalNotificationsSent++;
        todayNotificationsSent++;
        saveCounter(totalNotificationsSent, todayNotificationsSent);
        return true;
    } catch (err) {
        console.error("❌ Send error:", err.message);
        return false;
    }
}

function delay(ms = SEND_DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Message Formatting ─────────────────────────────────────────
function formatJobMessage(title, data, index, total) {
    let msg = `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📢 *Job ${index} of ${total}: ${title}*\n\n`;

    if (data.importantDates && Object.keys(data.importantDates).length) {
        msg += "📅 *Important Dates*\n";
        Object.entries(data.importantDates).forEach(([key, val]) => {
            msg += `📌 ${key}: ${val}\n`;
        });
        msg += "\n";
    }

    if (data.applicationFee && Object.keys(data.applicationFee).length) {
        msg += "💰 *Application Fee*\n";
        Object.entries(data.applicationFee).forEach(([key, val]) => {
            msg += `💵 ${key}: ${val}\n`;
        });
        msg += "\n";
    }

    if (data.ageLimit && Object.keys(data.ageLimit).length) {
        msg += "👤 *Age Limit*\n";
        Object.entries(data.ageLimit).forEach(([key, val]) => {
            msg += `🔹 ${key}: ${val}\n`;
        });
        msg += "\n";
    }

    if (data.eligibility && data.eligibility.length) {
        msg += "🎓 *Eligibility*\n";
        data.eligibility.forEach(el => {
            if (el && el.trim()) {
                msg += `✅ ${el}\n`;
            }
        });
        msg += "\n";
    }

    if (data.link) {
        msg += `🔗 *Apply Here:* ${data.link}`;
    }

    msg += getContactFooter();
    msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    return msg.trim();
}

// ─── Scraping ───────────────────────────────────────────────────
async function fetchJobDetails(jobUrl) {
    try {
        const html = await fetchWithRetry(jobUrl);
        const $ = cheerio.load(html);

        const result = {
            importantDates: {},
            applicationFee: {},
            ageLimit: {},
            eligibility: [],
            link: jobUrl
        };

        $("h3:contains('Important Dates')")
            .parent()
            .find("ul li")
            .each((i, el) => {
                const text = $(el).text().trim();
                if (text.includes(":")) {
                    const parts = text.split(":");
                    result.importantDates[parts[0].trim()] = parts.slice(1).join(":").trim();
                }
            });

        $("h3:contains('Application Fee')")
            .parent()
            .find("ul li")
            .each((i, el) => {
                const text = $(el).text().trim();
                if (text.includes(":")) {
                    const parts = text.split(":");
                    result.applicationFee[parts[0].trim()] = parts.slice(1).join(":").trim();
                }
            });

        $("h2:contains('Age Limit'), h3:contains('Age Limit')")
            .parent()
            .find("ul li")
            .each((i, el) => {
                const text = $(el).text().trim();
                if (text.includes(":")) {
                    const parts = text.split(":");
                    const key = parts[0].replace("Age", "").trim();
                    const value = parts.slice(1).join(":").trim();
                    result.ageLimit[key || "Limit"] = value;
                }
            });

        $("tr").each((i, tr) => {
            const heading = $(tr).text().trim().toLowerCase();
            if (heading.includes("eligibility")) {
                const nextRow = $(tr).next("tr");
                nextRow.find("li").each((j, li) => {
                    result.eligibility.push($(li).text().trim());
                });
            }
        });

        return result;
    } catch (error) {
        console.error("⚠️ Error fetching job details:", error.message);
        return null;
    }
}

// ─── Scrape Section Helpers ─────────────────────────────────────
function scrapeSection($, sectionName) {
    const items = [];
    $(".gb-container").each((i, element) => {
        const heading = $(element).find(".gb-headline a").text().trim();
        if (heading === sectionName) {
            $(element).find("ul.sarkari-quick-list li a").each((i, card) => {
                if (i >= 5) return false;
                items.push({ title: $(card).text().trim(), url: $(card).attr("href") });
            });
        }
    });
    return items;
}

// ─── Core Notification Functions ────────────────────────────────
async function sendJobNotifications(limit = 5) {
    try {
        const html = await fetchWithRetry(SCRAPE_URL);
        const $ = cheerio.load(html);

        const jobs = [];
        $("p.gb-headline").each((i, el) => {
            const heading = $(el).text().trim();
            if (heading === "Latest Job") {
                $(el)
                    .parent()
                    .find("ul.sarkari-quick-list li a")
                    .each((i, a) => {
                        jobs.push({
                            title: $(a).text().trim(),
                            url: $(a).attr("href")
                        });
                    });
                return false;
            }
        });

        const unsentJobs = filterUnsent(jobs);
        if (unsentJobs.length === 0) {
            console.log("ℹ️ No new jobs to notify.");
            return { success: true, jobsSent: 0, message: "No new jobs to notify." };
        }

        const jobsToSend = unsentJobs.slice(0, limit);

        const header = `📋 *Latest Job Notifications*\n📅 ${new Date().toString().split("GMT")[0]}\n📊 New Jobs Found: ${jobsToSend.length}\n\nStay updated with @governmentdailyjob`;
        await sock.sendMessage(groupJid, { text: header });
        totalNotificationsSent++;
        saveCounter(totalNotificationsSent, todayNotificationsSent);

        let sentCount = 0;
        for (let i = 0; i < jobsToSend.length; i++) {
            try {
                const job = await fetchJobDetails(jobsToSend[i].url);
                if (!job) continue;

                const msg = formatJobMessage(jobsToSend[i].title, job, i + 1, jobsToSend.length);
                await sock.sendMessage(groupJid, { text: msg });
                markSent(jobsToSend[i].url, jobsToSend[i].title, "job");
                totalNotificationsSent++;
                todayNotificationsSent++;
                saveCounter(totalNotificationsSent, todayNotificationsSent);
                sentCount++;
                await delay();
            } catch (err) {
                console.error(`⚠️ Error processing job ${i + 1}:`, err.message);
            }
        }

        if (sentCount > 0) {
            await sock.sendMessage(groupJid, { text: getDigestFooter() });
            totalNotificationsSent++;
            todayNotificationsSent++;
            saveCounter(totalNotificationsSent, todayNotificationsSent);
        }
        return { success: true, jobsSent: sentCount, totalSent: totalNotificationsSent };
    } catch (error) {
        console.error("❌ Error sending job notifications:", error.message);
        return { success: false, error: error.message };
    }
}

async function sendAdmitCards() {
    try {
        const html = await fetchWithRetry(SCRAPE_URL);
        const $ = cheerio.load(html);
        const admitCards = scrapeSection($, "Admit Card");
        const unsent = filterUnsent(admitCards);

        if (unsent.length === 0) {
            console.log("ℹ️ No new admit cards to notify.");
            return { sent: 0 };
        }

        let count = 0;
        for (const card of unsent) {
            const ok = await sendMessageWithCounter(groupJid,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📄 *Admit Card:* ${card.title}\n🔗 *Link:* ${card.url}${getContactFooter()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`
            );
            if (ok) {
                markSent(card.url, card.title, "admit-card");
                count++;
            }
            await delay();
        }
        return { sent: count };
    } catch (err) {
        console.error("❌ Error in sendAdmitCards:", err.message);
        throw err;
    }
}

async function sendResults() {
    try {
        const html = await fetchWithRetry(SCRAPE_URL);
        const $ = cheerio.load(html);
        const results = scrapeSection($, "Result");
        const unsent = filterUnsent(results);

        if (unsent.length === 0) {
            console.log("ℹ️ No new results to notify.");
            return { sent: 0 };
        }

        let count = 0;
        for (const result of unsent) {
            const ok = await sendMessageWithCounter(groupJid,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 *Result:* ${result.title}\n🔗 *Link:* ${result.url}${getContactFooter()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`
            );
            if (ok) {
                markSent(result.url, result.title, "result");
                count++;
            }
            await delay();
        }
        return { sent: count };
    } catch (err) {
        console.error("❌ Error in sendResults:", err.message);
        throw err;
    }
}

async function sendAdmissions() {
    try {
        const html = await fetchWithRetry(SCRAPE_URL);
        const $ = cheerio.load(html);
        const admissions = scrapeSection($, "Admission");
        const unsent = filterUnsent(admissions);

        if (unsent.length === 0) {
            console.log("ℹ️ No new admissions to notify.");
            return { sent: 0 };
        }

        let count = 0;
        for (const admission of unsent) {
            const ok = await sendMessageWithCounter(groupJid,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎓 *Admission:* ${admission.title}\n🔗 *Link:* ${admission.url}${getContactFooter()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`
            );
            if (ok) {
                markSent(admission.url, admission.title, "admission");
                count++;
            }
            await delay();
        }
        return { sent: count };
    } catch (err) {
        console.error("❌ Error in sendAdmissions:", err.message);
        throw err;
    }
}

// ─── API Routes ─────────────────────────────────────────────────
app.get("/", (req, res) => {
    res.sendFile("index.html", { root: "." });
});

app.get("/api/status", (req, res) => {
    // Auto-reset daily counter on date rollover
    const today = getToday();
    if (counter.date !== today) {
        todayNotificationsSent = 0;
        counter.date = today;
        saveCounter(totalNotificationsSent, todayNotificationsSent);
    }

    const history = loadHistory();
    const historyCount = history.items ? Object.keys(history.items).length : 0;
    res.json({
        status: "running",
        connected: isConnected,
        group: groupJid,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        totalNotificationsSent,
        todayNotificationsSent,
        dedupHistoryCount: historyCount,
        date: today
    });
});

app.get("/api/history", (req, res) => {
    const history = loadHistory();
    const items = history.items || {};
    const count = Object.keys(items).length;
    res.json({ success: true, count, items });
});

app.get("/api/send-jobs", async (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: "WhatsApp not connected" });
    }
    const result = await sendJobNotifications(10);
    res.json(result);
});

app.get("/api/send-admit-cards", async (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: "WhatsApp not connected" });
    }
    try {
        const result = await sendAdmitCards();
        res.json({ success: true, sent: result.sent, totalSent: totalNotificationsSent, todaySent: todayNotificationsSent });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/api/send-results", async (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: "WhatsApp not connected" });
    }
    try {
        const result = await sendResults();
        res.json({ success: true, sent: result.sent, totalSent: totalNotificationsSent, todaySent: todayNotificationsSent });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get("/api/send-admissions", async (req, res) => {
    if (!isConnected) {
        return res.status(503).json({ error: "WhatsApp not connected" });
    }
    try {
        const result = await sendAdmissions();
        res.json({ success: true, sent: result.sent, totalSent: totalNotificationsSent, todaySent: todayNotificationsSent });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Initialization & Scheduling ────────────────────────────────
initWhatsApp().then(() => {
    pruneOldHistory(60);
}).catch(console.error);

// Every 2 hours
cron.schedule("0 */2 * * *", () => {
    if (isConnected) sendJobNotifications(5);
});

// Scheduled tasks
cron.schedule("30 6 * * *", () => { if (isConnected) sendAdmitCards(); });
cron.schedule("10 12 * * *", () => { if (isConnected) sendJobNotifications(5); });
cron.schedule("30 16 * * *", () => { if (isConnected) sendResults(); });
cron.schedule("30 20 * * *", () => { if (isConnected) sendAdmissions(); });

// ─── Graceful Shutdown ──────────────────────────────────────────
function gracefulShutdown(signal) {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    saveCounter(totalNotificationsSent, todayNotificationsSent);
    console.log("💾 Counters saved.");

    if (sock) {
        try {
            sock.end();
            console.log("📴 WhatsApp socket closed.");
        } catch (e) { /* ignore */ }
    }

    process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ─── Start Server ───────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`📡 API Status: http://localhost:${PORT}/api/status`);
});
