import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState
} from "@whiskeysockets/baileys";

import { Boom } from "@hapi/boom";
import QRCode from "qrcode-terminal";
import pino from "pino";

const MAX_RECONNECT_DELAY_MS = 30000;
const CONNECTION_TIMEOUT_MS = 120000; // 2 minutes

/**
 * Connects to WhatsApp with auto-reconnect (exponential backoff)
 * and a connection timeout to prevent silent hangs.
 */
export function connectWhatsApp() {
    let reconnectAttempt = 0;

    return new Promise(async (resolve, reject) => {
        let settled = false;
        let timeoutHandle = null;

        // Reject if we don't connect within CONNECTION_TIMEOUT_MS
        timeoutHandle = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error(`WhatsApp connection timed out after ${CONNECTION_TIMEOUT_MS / 1000}s`));
            }
        }, CONNECTION_TIMEOUT_MS);

        async function attemptConnection() {
            try {
                const { state, saveCreds } = await useMultiFileAuthState("auth");

                const sock = makeWASocket({
                    auth: state,
                    logger: pino({ level: "silent" }) // suppress Baileys internal logging noise
                });

                sock.ev.on("creds.update", saveCreds);

                sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
                    if (qr) {
                        console.log("\n📱 Scan this QR code in WhatsApp to connect:\n");
                        QRCode.generate(qr, { small: true });
                    }

                    if (connection === "open") {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timeoutHandle);
                            reconnectAttempt = 0;
                            console.log("✅ WhatsApp Connected");
                            resolve(sock);
                        }
                    }

                    if (connection === "close") {
                        const statusCode = lastDisconnect?.error instanceof Boom
                            ? lastDisconnect.error.output.statusCode
                            : null;

                        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                        if (shouldReconnect) {
                            reconnectAttempt++;
                            const delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), MAX_RECONNECT_DELAY_MS);
                            console.log(`🔄 WhatsApp disconnected. Reconnecting in ${delay / 1000}s (attempt #${reconnectAttempt})...`);

                            setTimeout(async () => {
                                try {
                                    const newSock = await connectWhatsApp();
                                    if (!settled) {
                                        settled = true;
                                        clearTimeout(timeoutHandle);
                                        resolve(newSock);
                                    }
                                } catch (err) {
                                    if (!settled) {
                                        settled = true;
                                        clearTimeout(timeoutHandle);
                                        reject(err);
                                    }
                                }
                            }, delay);
                        } else {
                            console.error("❌ WhatsApp logged out. Please delete the 'auth' folder and re-scan QR.");
                            if (!settled) {
                                settled = true;
                                clearTimeout(timeoutHandle);
                                reject(new Error("WhatsApp logged out. Re-authentication required."));
                            }
                        }
                    }
                });
            } catch (err) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutHandle);
                    reject(err);
                }
            }
        }

        attemptConnection();
    });
}
