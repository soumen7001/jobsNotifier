import fs from "fs";
import path from "path";

const HISTORY_FILE = path.join(process.cwd(), "sent-history.json");

/**
 * Normalizes a URL or title string to use as a unique key.
 */
export function normalizeKey(item) {
    if (!item) return "";
    let raw = "";
    if (typeof item === "string") {
        raw = item;
    } else if (item.url) {
        raw = item.url;
    } else if (item.link) {
        raw = item.link;
    } else if (item.title) {
        raw = item.title;
    }
    return raw.trim().toLowerCase();
}

/**
 * Loads sent history from disk.
 */
export function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, "utf-8");
            return JSON.parse(data);
        }
    } catch (err) {
        console.error("⚠️ Error loading sent-history.json:", err.message);
    }
    return { items: {} };
}

/**
 * Saves sent history to disk.
 */
export function saveHistory(history) {
    try {
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf-8");
    } catch (err) {
        console.error("⚠️ Error saving sent-history.json:", err.message);
    }
}

/**
 * Checks if a specific item (url or title) has already been sent.
 */
export function isSent(item) {
    const key = normalizeKey(item);
    if (!key) return false;
    const history = loadHistory();
    return Boolean(history.items && history.items[key]);
}

/**
 * Marks an item as sent in history store.
 */
export function markSent(item, title = "", category = "job") {
    const key = normalizeKey(item);
    if (!key) return;

    const history = loadHistory();
    if (!history.items) {
        history.items = {};
    }

    history.items[key] = {
        title: title || (typeof item === "object" ? item.title : ""),
        category,
        sentAt: new Date().toISOString()
    };

    saveHistory(history);
}

/**
 * Filters an array of scraped items to return only those NOT yet sent.
 */
export function filterUnsent(items) {
    if (!Array.isArray(items)) return [];
    const history = loadHistory();
    const sentMap = history.items || {};

    return items.filter(item => {
        const key = normalizeKey(item);
        return key && !sentMap[key];
    });
}

/**
 * Prunes items sent longer than maxDays ago to keep storage manageable.
 */
export function pruneOldHistory(maxDays = 60) {
    const history = loadHistory();
    if (!history.items) return;

    const now = Date.now();
    const cutoff = maxDays * 24 * 60 * 60 * 1000;
    let prunedCount = 0;

    for (const [key, record] of Object.entries(history.items)) {
        if (record.sentAt) {
            const sentTime = new Date(record.sentAt).getTime();
            if (now - sentTime > cutoff) {
                delete history.items[key];
                prunedCount++;
            }
        }
    }

    if (prunedCount > 0) {
        console.log(`🧹 Pruned ${prunedCount} old items from history store.`);
        saveHistory(history);
    }
}
