import axios from "axios";
import * as cheerio from "cheerio";
import { connectWhatsApp } from "./whatsapp.js";
import cron from "node-cron";
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
const wp_group = process.env.WP_GROUP;
const groupJid = await getGroupJid(wp_group);

async function getGroupJid(groupLink) {
    if (groupLink.includes("@g.us") || groupLink.includes("@broadcast")) {
        return groupLink;
    }

    if (groupLink.startsWith("https://chat.whatsapp.com/")) {
        const inviteCode = groupLink.split("/").pop();
        try {
            const result = await sock.groupAcceptInvite(inviteCode);
            console.log("✅ Joined group:", result);
            return result;
        } catch (err) {
            console.error("❌ Failed to join group:", err.message);
            const groupMetaData = await sock.groupFetchInvitecode(inviteCode);
            return groupMetaData.id;
        }
    }

    return groupLink;
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
function formatJob(job) {
    if (!job) return " No job data found.";

    const {
        title = "",
        importantDates = {},
        applicationFee = {},
        ageLimit = {},
        eligibility = []
    } = job;

    if (
        !title &&
        !Object.keys(importantDates).length &&
        !Object.keys(applicationFee).length &&
        !Object.keys(ageLimit).length &&
        !eligibility.length
    ) {
        return null;
    }

    let msg = `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🚀 *${title}*\n\n`;

    // 📅 Important Dates
    const validDates = Object.entries(importantDates).filter(([_, value]) => value);
    if (validDates.length) {
        msg += "📅 *Important Dates*\n";
        validDates.forEach(([key, value]) => {
            const label = key
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, s => s.toUpperCase());
            msg += `📌 ${label}: ${value}\n`;
        });
        msg += "\n";
    }

    // 💰 Application Fee
    const validFees = Object.entries(applicationFee).filter(([_, value]) => value);
    if (validFees.length) {
        msg += "💰 *Application Fee*\n";
        validFees.forEach(([key, value]) => {
            msg += `💵 ${key.toUpperCase()}: ${value}\n`;
        });
        msg += "\n";
    }

    // 👤 Age Limit
    const validAge = Object.entries(ageLimit).filter(([_, value]) => value);
    if (validAge.length) {
        msg += "👤 *Age Limit*\n";
        validAge.forEach(([key, value]) => {
            const label = key
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, s => s.toUpperCase());
            msg += `🔹 ${label}: ${value}\n`;
        });
        msg += "\n";
    }

    // 🎓 Eligibility
    const validEligibility = eligibility.filter(item =>
        item && item.trim() && item !== "More Details Read the Notification."
    );
    if (validEligibility.length) {
        msg += "🎓 *Eligibility*\n";
        validEligibility.forEach(item => {
            msg += `✅ ${item}\n`;
        });
        msg += "\n";
    }

    msg += getContactFooter();
    msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    return msg.trim();
}

// ─── Page Scraping ──────────────────────────────────────────────
const vacancyPageScrape = async (url) => {
    try {
        const html = await fetchWithRetry(url);
        const $ = cheerio.load(html);
        const nameOfPost = $(".gb-headline table tbody tr").first().find("td").eq(1).text().trim();

        const importantDates = {};
        $("h3:contains('Important Dates')")
            .parent()
            .find("ul li")
            .each((i, el) => {
                const text = $(el).text().trim();
                if (text.includes("Application Begin")) {
                    importantDates.startDate = text.split(":")[1]?.trim() || "";
                }
                if (text.includes("Last Date for Apply Online")) {
                    importantDates.lastDate = text.split(":")[1]?.trim() || "";
                }
            });

        const applicationFee = {};
        $("h3:contains('Application Fee')")
            .parent()
            .find("ul li")
            .each((i, el) => {
                const text = $(el).text().trim();
                if (text.includes("General")) {
                    applicationFee.general = text.split(":")[1]?.trim() || "";
                    applicationFee.ews = applicationFee.general;
                    applicationFee.obc = applicationFee.general;
                }
            });

        const ageLimit = {};
        $("h2:contains('Age Limit')")
            .parent()
            .find("ul li")
            .each((i, el) => {
                const text = $(el).text().trim();
                if (text.includes("Minimum Age")) {
                    ageLimit.minimumAge = text.split(":")[1]?.trim() || "";
                }
                if (text.includes("Maximum Age")) {
                    ageLimit.maximumAge = text.split(":")[1]?.trim() || "";
                }
                if (text.includes("Age Relaxation")) {
                    ageLimit.ageRelaxation = text;
                }
            });

        const eligibility = [];
        $("tr").each((i, tr) => {
            const heading = $(tr).text().trim().toLowerCase();
            if (heading.includes("eligibility")) {
                const nextRow = $(tr).next("tr");
                nextRow.find("td").last().find("li").each((i, li) => {
                    eligibility.push($(li).text().trim());
                });
            }
        });

        return {
            title: nameOfPost,
            importantDates,
            applicationFee,
            ageLimit,
            eligibility
        };
    } catch (error) {
        console.error(`⚠️ Error scraping ${url}:`, error.message);
        return null;
    }
};

// ─── Section Scrapers ───────────────────────────────────────────
const admitCardScrape = async () => {
    try {
        const html = await fetchWithRetry(SCRAPE_URL);
        const $ = cheerio.load(html);
        const admitCards = [];

        $(".gb-container").each((i, element) => {
            const heading = $(element).find(".gb-headline a").text().trim();
            if (heading === "Admit Card") {
                $(element).find("ul.sarkari-quick-list li a").each((i, card) => {
                    if (i >= 5) return false;
                    admitCards.push({
                        title: $(card).text().trim(),
                        url: $(card).attr("href")
                    });
                });
            }
        });

        console.log(`📄 Found ${admitCards.length} admit cards`);
        const unsentCards = filterUnsent(admitCards);

        for (const card of unsentCards) {
            await sock.sendMessage(groupJid, {
                text: `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📄 *Admit Card:* ${card.title}\n🔗 *Link:* ${card.url}${getContactFooter()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`
            });
            markSent(card.url, card.title, "admit-card");
            await delay();
        }
    } catch (error) {
        console.error("❌ Error in admitCardScrape:", error.message);
    }
};

const resultScrape = async () => {
    try {
        const html = await fetchWithRetry(SCRAPE_URL);
        const $ = cheerio.load(html);
        const results = [];

        $(".gb-container").each((i, element) => {
            const heading = $(element).find(".gb-headline a").text().trim();
            if (heading === "Result") {
                $(element).find("ul.sarkari-quick-list li a").each((i, card) => {
                    if (i >= 5) return false;
                    results.push({
                        title: $(card).text().trim(),
                        url: $(card).attr("href")
                    });
                });
            }
        });

        console.log(`📊 Found ${results.length} results`);
        const unsentResults = filterUnsent(results);

        for (const result of unsentResults) {
            await sock.sendMessage(groupJid, {
                text: `━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊 *Result:* ${result.title}\n🔗 *Link:* ${result.url}${getContactFooter()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`
            });
            markSent(result.url, result.title, "result");
            await delay();
        }
    } catch (error) {
        console.error("❌ Error in resultScrape:", error.message);
    }
};

const admissionScrape = async () => {
    try {
        const html = await fetchWithRetry(SCRAPE_URL);
        const $ = cheerio.load(html);
        const admissions = [];

        $(".gb-container").each((i, element) => {
            const heading = $(element).find(".gb-headline a").text().trim();
            if (heading === "Admission") {
                $(element).find("ul.sarkari-quick-list li a").each((i, card) => {
                    if (i >= 5) return false;
                    admissions.push({
                        title: $(card).text().trim(),
                        url: $(card).attr("href")
                    });
                });
            }
        });

        console.log(`🎓 Found ${admissions.length} admissions`);
        const unsentAdmissions = filterUnsent(admissions);

        for (const admission of unsentAdmissions) {
            await sock.sendMessage(groupJid, {
                text: `━━━━━━━━━━━━━━━━━━━━━━━━━━\n🎓 *Admission:* ${admission.title}\n🔗 *Link:* ${admission.url}${getContactFooter()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━`
            });
            markSent(admission.url, admission.title, "admission");
            await delay();
        }
    } catch (error) {
        console.error("❌ Error in admissionScrape:", error.message);
    }
};

// ─── Job Finder ─────────────────────────────────────────────────
const jobFinder = async () => {
    try {
        const html = await fetchWithRetry(SCRAPE_URL);
        const $ = cheerio.load(html);
        let jobs = [];

        $("p.gb-headline").each((i, el) => {
            const heading = $(el).text().trim();
            if (heading === "Latest Job") {
                $(el)
                    .parent()
                    .find("ul.sarkari-quick-list li a")
                    .slice(0, 5)
                    .each((i, a) => {
                        jobs.push($(a).attr("href"));
                    });
                return false;
            }
        });

        const unsentJobs = filterUnsent(jobs.map(u => ({ url: u })));
        for (const item of unsentJobs) {
            const url = item.url;
            try {
                const job = await vacancyPageScrape(url);
                if (!job) continue;

                const msg = formatJob(job);
                if (!msg) continue;

                console.log(`📤 Sending job: ${job.title || url}`);
                await sock.sendMessage(groupJid, { text: msg });
                markSent(url, job.title || "", "job");
                await delay();
            } catch (err) {
                console.error(`⚠️ Error scraping ${url}:`, err.message);
            }
        }
    } catch (error) {
        console.error("❌ Error in jobFinder:", error.message);
    }
};

// ─── Cron Schedules ─────────────────────────────────────────────
// Every 2 hours
cron.schedule("0 */2 * * *", jobFinder);

// Scheduled tasks
cron.schedule("30 6 * * *", admitCardScrape);
cron.schedule("10 12 * * *", jobFinder);
cron.schedule("30 16 * * *", resultScrape);
cron.schedule("30 20 * * *", admissionScrape);

console.log("🤖 Standalone scrapper started. Cron schedules active.");
