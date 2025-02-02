const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

// Load environment variables
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;
const ADMIN_USER_ID = process.env.ADMIN_USER_ID; // Admin's Telegram user ID
const bot = new TelegramBot(TOKEN, { polling: true });

// Initialize SQLite database
const db = new sqlite3.Database('promo_codes.db');

// Initialize the database tables if not exist
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (user_id INTEGER PRIMARY KEY, promo_used INTEGER DEFAULT 0, access_start INTEGER, access_expiry INTEGER)");
    db.run("CREATE TABLE IF NOT EXISTS promo_codes (code TEXT PRIMARY KEY, expiry INTEGER, is_used INTEGER DEFAULT 0)");
});

// Function to generate a random promo code
function generatePromoCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let promoCode = '';
    for (let i = 0; i < 8; i++) {
        promoCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return promoCode;
}

// Function to check if the user is in the private channel
async function isUserAllowed(userId) {
    try {
        const chatMember = await bot.getChatMember(PRIVATE_CHANNEL_ID, userId);
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
        console.error('❌ Error checking user:', error.message);
        return false;
    }
}

// Function to check user access status
async function checkUserAccess(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE user_id = ?", [userId], (err, row) => {
            if (err) return reject(err);
            if (!row) {
                return resolve({ accessGranted: false });
            }

            const currentTime = Math.floor(Date.now() / 1000);
            if (currentTime > row.access_expiry) {
                // Access expired
                return resolve({ accessGranted: false, expired: true });
            } else {
                // Access still valid
                return resolve({ accessGranted: true, expired: false });
            }
        });
    });
}

// /start command
bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;

    // Check if the user is allowed in the private channel
    const allowed = await isUserAllowed(userId);

    if (!allowed) {
        return bot.sendMessage(userId, "❌ You must be a member of the private channel to use this bot.");
    }

    // Check if the user has active access
    const accessStatus = await checkUserAccess(userId);

    if (!accessStatus.accessGranted) {
        if (accessStatus.expired) {
            bot.sendMessage(userId, "⚠️ Your access has expired. Please contact the admin to extend your access.");
        } else {
            // New users with access
            const signal = await getMarketSignal(); // Placeholder for your market signal logic
            bot.sendMessage(userId, `👋 Welcome! Here is the latest market signal:\n
📊 *Prediction:* ${signal.direction}\n
⏳ *Time:* ${signal.time}\n
📉 *Open Price:* ${signal.openPrice}\n
📈 *Close Price:* ${signal.closePrice}\n
📊 *High Price:* ${signal.highPrice}\n
📉 *Low Price:* ${signal.lowPrice}\n
📊 *Volume:* ${signal.volume}`);
        }
    } else {
        // If the user has access
        const signal = await getMarketSignal(); // Placeholder for your market signal logic
        bot.sendMessage(userId, `👋 Welcome! Here is the latest market signal:\n
📊 *Prediction:* ${signal.direction}\n
⏳ *Time:* ${signal.time}\n
📉 *Open Price:* ${signal.openPrice}\n
📈 *Close Price:* ${signal.closePrice}\n
📊 *High Price:* ${signal.highPrice}\n
📉 *Low Price:* ${signal.lowPrice}\n
📊 *Volume:* ${signal.volume}`);
    }
});

// Get Market Signal (Your previous function can be integrated here)
async function getMarketSignal(pair = 'GBPCHF') {
    // Implement your market signal logic here, e.g., using technical indicators
    return {
        direction: '🔼 Up (Buy)',
        time: '⏳ 1 minute',
        openPrice: '1.234',
        closePrice: '1.235',
        highPrice: '1.236',
        lowPrice: '1.233',
        volume: '1000'
    };
}

// Admin commands to generate promo codes
bot.onText(/\/generatepromo/, (msg) => {
    const userId = msg.from.id;
    if (userId !== parseInt(ADMIN_USER_ID)) {
        return bot.sendMessage(userId, "❌ You are not authorized to generate promo codes.");
    }

    const promoCode = generatePromoCode(); // Generate a random promo code
    const expiryTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // Promo code expires in 7 days

    db.run("INSERT OR REPLACE INTO promo_codes (code, expiry) VALUES (?, ?)", [promoCode, expiryTime], (err) => {
        if (err) {
            return bot.sendMessage(userId, "❌ Error generating promo code.");
        } else {
            bot.sendMessage(userId, `✅ Promo code ${promoCode} has been generated successfully!`);
        }
    });
});

// Command to redeem promo code
bot.onText(/\/redeem (.+)/, (msg, match) => {
    const userId = msg.from.id;
    const promoCode = match[1];

    // Check if the user is allowed to redeem
    isUserAllowed(userId).then(async (allowed) => {
        if (!allowed) {
            return bot.sendMessage(userId, "❌ You must be a member of the private channel to use this bot.");
        }

        // Check if the promo code is valid and not used
        db.get("SELECT * FROM promo_codes WHERE code = ? AND is_used = 0 AND expiry > ?", [promoCode, Math.floor(Date.now() / 1000)], (err, row) => {
            if (err || !row) {
                return bot.sendMessage(userId, "❌ Invalid or expired promo code.");
            }

            // Redeem the promo code (mark it as used)
            db.run("UPDATE promo_codes SET is_used = 1 WHERE code = ?", [promoCode]);

            // Grant access to the user (3 days of basic access)
            const accessStart = Math.floor(Date.now() / 1000);
            const accessExpiry = accessStart + (3 * 24 * 60 * 60); // 3 days in seconds

            db.run("INSERT OR REPLACE INTO users (user_id, promo_used, access_start, access_expiry) VALUES (?, 1, ?, ?)", [userId, accessStart, accessExpiry], (err) => {
                if (err) {
                    bot.sendMessage(userId, "❌ Error redeeming promo code.");
                } else {
                    bot.sendMessage(userId, "✅ Promo code redeemed successfully! You now have 3 days of basic access.");
                }
            });
        });
    });
});
