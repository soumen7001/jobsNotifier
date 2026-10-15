import axios from "axios";
import * as cheerio from "cheerio";
import { connectWhatsApp } from "./whatsapp.js";
import dotenv from "dotenv";
import { filterUnsent, markSent } from "./history-store.js";

dotenv.config();

// ─── Configuration ──────────────────────────────────────────────
const SCRAPE_URL = "https://www.sarkariresult.com/";
const AXIOS_TIMEOUT = 15000;
const SEND_DELAY_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── WhatsApp Connection ────────────────────────────────────────
const sock = await connectWhatsApp();
const groupLink = process.env.WP_GROUP;

let groupJid;
if (groupLink.startsWith("https://chat.whatsapp.com/")) {
    const inviteCode = groupLink.split("/").pop();
    groupJid = await sock.groupAcceptInvite(inviteCode);
    console.log("✅ Joined group:", groupJid);
} else {
    groupJid = groupLink;
}

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

function delay(ms = SEND_DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Contact Footer ─────────────────────────────────────────────
function getContactFooter() {
    return `\n\n💼 *Need Help Applying?*\nGet professional assistance to complete your job application:\n👤 *Contact:* Soumen Bera\n📞 *Call/WhatsApp:* +91 7001123760\n✉️ *Email:* soumenbera8509@gmail.com`;
}

// ─── Message Formatting ─────────────────────────────────────────
function formatJobMessage(title, data) {
    let msg = `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📢 *${title}*\n\n`;

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

// ─── Main Send Function ─────────────────────────────────────────
async function sendLast60DaysNotifications() {
    try {
        console.log("📡 Fetching all current jobs...");
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

        console.log(`Found ${jobs.length} jobs`);
        const unsentJobs = filterUnsent(jobs);

        if (unsentJobs.length === 0) {
            console.log("ℹ️ No new jobs to send.");
            process.exit(0);
        }

        // Send header
        await sock.sendMessage(groupJid, {
            text: `📋 *Sarkari Jobs Notification Digest*\n📅 ${new Date().toDateString()}\n📊 New Jobs: ${unsentJobs.length}\n\nHere are the latest job notifications:\n\nStay updated with @governmentdailyjob`
        });

        // Send top 10 unsent jobs with full details
        const limit = Math.min(unsentJobs.length, 10);
        for (let i = 0; i < limit; i++) {
            try {
                const job = await fetchJobDetails(unsentJobs[i].url);
                if (!job) continue;

                const msg = formatJobMessage(unsentJobs[i].title, job);
                await sendMessage(groupJid, msg);
                markSent(unsentJobs[i].url, unsentJobs[i].title, "job");
                console.log(`✅ Sent job ${i + 1}/${limit}: ${unsentJobs[i].title}`);

                await delay();
            } catch (err) {
                console.error(`⚠️ Error processing job ${i + 1}:`, err.message);
            }
        }

        // Send footer
        await sock.sendMessage(groupJid, {
            text: `━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ *End of Notification Digest*\n\n📲 *Stay Connected & Never Miss an Opportunity:*\n👉 Join/Follow: *@governmentdailyjob*\n\n⏰ *Daily notifications dispatched every 6 hours.*${getContactFooter()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`
        });

        console.log("✅ All notifications sent!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Main error:", error.message);
        process.exit(1);
    }
}

async function sendMessage(chatId, text) {
    try {
        await sock.sendMessage(chatId, { text });
    } catch (err) {
        console.error("❌ Send error:", err.message);
    }
}

sendLast60DaysNotifications();
