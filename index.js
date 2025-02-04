const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const tulind = require('tulind');
require('dotenv').config();

// Load variables
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;
const bot = new TelegramBot(TOKEN, { polling: true });

// Updated list of currency pairs (replacing USD with USDT)
const pairs = [
    'GBPCHF', 'CHFJPY', 'AUDUSDT', 'NZDUSDT', 'GBPJPY', 'EURGBP', 'EURCAD',
    'USDTJPY', 'EURUSDT', 'AUDCAD', 'USDCAD', 'GBPUSDT', 'GBPNZD'
];

// Check if the user is in the private channel
async function isUserAllowed(userId) {
    try {
        const chatMember = await bot.getChatMember(PRIVATE_CHANNEL_ID, userId);
        return ['member', 'administrator', 'creator'].includes(chatMember.status);
    } catch (error) {
        console.error('❌ Error checking user:', error.message);
        return false;
    }
}

// Function to check if the pair is available on Binance
async function isPairAvailable(pair) {
    try {
        const response = await axios.get('https://api.binance.com/api/v3/exchangeInfo');
        const symbols = response.data.symbols;
        return symbols.some(symbol => symbol.symbol === pair);
    } catch (error) {
        console.error("❌ Error checking pair availability:", error.message);
        return false;
    }
}

// Function to adapt signal for USD if needed
function adaptSignalForBinomo(pair, signal) {
    if (pair.includes('USDT')) {
        pair = pair.replace('USDT', 'USD');
    }
    return { ...signal, pair };
}

// Function to get market signal (RSI, MACD, EMA)
// Функція для отримання ринкового сигналу з додатковими індикаторами
async function getMarketSignal(pair = 'GBPCHF') {
    try {
        const isAvailable = await isPairAvailable(pair);
        if (!isAvailable) {
            return { direction: '❌ Pair not available', time: '⏳ N/A' };
        }

        const response = await axios.get(`https://api.binance.com/api/v3/klines`, {
            params: { symbol: pair, interval: '1m', limit: 200 } // збільшено кількість свічок
        });

        if (response.status !== 200) {
            console.error(`❌ Error fetching data from Binance: ${response.status} ${response.statusText}`);
            return { direction: '⏸ Undefined', time: '⏳ N/A' };
        }

        const ticks = response.data;
        if (!ticks || ticks.length === 0) {
            console.error('❌ No candlestick data returned');
            return { direction: '⏸ Undefined', time: '⏳ N/A' };
        }

        const closePrices = ticks.map(t => parseFloat(t[4]));
        const openPrice = parseFloat(ticks[ticks.length - 1][1]);
        const closePrice = parseFloat(ticks[ticks.length - 1][4]);
        const highPrice = parseFloat(ticks[ticks.length - 1][2]);
        const lowPrice = parseFloat(ticks[ticks.length - 1][3]);
        const volume = parseFloat(ticks[ticks.length - 1][5]);

        return new Promise((resolve, reject) => {
            tulind.indicators.rsi.indicator([closePrices], [14], (err, rsiResult) => {
                if (err) return reject(`❌ Error calculating RSI: ${err.message}`);
                const rsi = rsiResult[0].slice(-1)[0];

                tulind.indicators.macd.indicator([closePrices], [12, 26, 9], (err, macdResult) => {
                    if (err) return reject(`❌ Error calculating MACD: ${err.message}`);
                    const macd = macdResult[0].slice(-1)[0];
                    const signalLine = macdResult[1].slice(-1)[0];

                    tulind.indicators.ema.indicator([closePrices], [9], (err, ema9Result) => {
                        if (err) return reject(`❌ Error calculating EMA9: ${err.message}`);
                        const ema9 = ema9Result[0].slice(-1)[0];

                        tulind.indicators.ema.indicator([closePrices], [21], (err, ema21Result) => {
                            if (err) return reject(`❌ Error calculating EMA21: ${err.message}`);
                            const ema21 = ema21Result[0].slice(-1)[0];

                            let direction = '🔼 Up (Buy)';
                            if (rsi > 70 || (macd < signalLine && ema9 < ema21)) {
                                direction = '🔽 Down (Sell)';
                            }

                            const signal = {
                                direction,
                                time: '⏳ 1 minute',
                                openPrice,
                                closePrice,
                                highPrice,
                                lowPrice,
                                volume
                            };

                            resolve(adaptSignalForBinomo(pair, signal));
                        });
                    });
                });
            });
        });
    } catch (error) {
        console.error("❌ Error fetching market data:", error.message);
        return { direction: '⏸ Undefined', time: '⏳ N/A' };
    }
}


// Handle /start command
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "👋 Welcome! Choose a currency pair for analysis:", {
        reply_markup: { keyboard: pairs.map(p => [{ text: `📈 ${p}` }]), resize_keyboard: true }
    });
});

// Handle messages
bot.on('message', async (msg) => {
    const text = msg.text;
    const userId = msg.from.id;

    if (pairs.includes(text.replace('📈 ', ''))) {
        const pair = text.replace('📈 ', '');

        try {
            if (await isUserAllowed(userId)) {
                bot.sendMessage(userId, `📊 Analyzing the market for *${pair}*...`);
                const signal = await getMarketSignal(pair);

                bot.sendMessage(
                    userId,
                    `📢 *Market Signal (${signal.pair})*  \n📊 *Prediction:* ${signal.direction}  \n⏳ *Time:* ${signal.time}  \n📉 *Open Price:* ${signal.openPrice}  \n📈 *Close Price:* ${signal.closePrice}  \n📊 *High Price:* ${signal.highPrice}  \n📉 *Low Price:* ${signal.lowPrice}  \n📊 *Volume:* ${signal.volume}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                bot.sendMessage(userId, "❌ Access denied. Please join our private channel.");
            }
        } catch (error) {
            console.error(`❌ Error handling message from ${userId}: ${error.message}`);
            bot.sendMessage(userId, "❌ An error occurred while processing your request.");
        }
    }
});
