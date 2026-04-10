require("dotenv").config();
const axios  = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fs     = require("fs");
const path   = require("path");

// ─────────────────────────────────────────────
// 🔑 CONFIG
// ─────────────────────────────────────────────
const TOKEN        = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID; // Ton ID = admin

if (!TOKEN || !ADMIN_CHAT_ID) {
    console.error("❌ TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID manquant dans .env");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
    polling: {
        interval:  1000,
        autoStart: true,
        params: {
            timeout:         10,
            allowed_updates: ["message", "callback_query"]
        }
    }
});

// ─────────────────────────────────────────────
// 👥 GESTION MULTI-USERS
// ─────────────────────────────────────────────
const USERS_FILE = path.join(__dirname, "users.json");

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
        }
    } catch (e) {
        console.log("⚠️ Impossible de lire users.json");
    }
    // Admin toujours présent par défaut
    return [ADMIN_CHAT_ID];
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let authorizedUsers = loadUsers();
// S'assurer que l'admin est toujours dedans
if (!authorizedUsers.includes(ADMIN_CHAT_ID)) {
    authorizedUsers.push(ADMIN_CHAT_ID);
    saveUsers(authorizedUsers);
}

// ─────────────────────────────────────────────
// 💾 SAUVEGARDE D'ÉTAT
// ─────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "state.json");

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const raw = fs.readFileSync(STATE_FILE, "utf8");
            return JSON.parse(raw);
        }
    } catch (e) {
        console.log("⚠️ Impossible de lire state.json, état réinitialisé.");
    }
    return {};
}

function saveState() {
    try {
        const toSave = {};
        symbols.forEach(s => {
            const st = state[s.name];
            toSave[s.name] = {
                lastSignal:         st.lastSignal,
                lastScoreAlert:     st.lastScoreAlert,
                consecutiveSL:      st.consecutiveSL,
                blocked:            st.blocked,
                lastMoveAlert:      st.lastMoveAlert,
                cooldownUntil:      st.cooldownUntil,
                lastEarlyAlert:     st.lastEarlyAlert,
                activeTrade:        st.activeTrade ? {
                    type:      st.activeTrade.type,
                    entry:     st.activeTrade.entry,
                    tp:        st.activeTrade.tp,
                    sl:        st.activeTrade.sl,
                    reducedSL: st.activeTrade.reducedSL,
                } : null,
                tradeConfirmStatus: st.activeTrade ? st.tradeConfirmStatus : "NONE",
            };
        });
        fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
    } catch (e) {
        console.error("❌ Erreur sauvegarde état:", e.message);
    }
}

setInterval(saveState, 30000);

// ─────────────────────────────────────────────
// 📩 ENVOI MULTI-USERS
// ─────────────────────────────────────────────
async function send(msg) {
    for (const chatId of authorizedUsers) {
        try {
            await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" });
        } catch (e) {
            console.error(`❌ Telegram [${chatId}]:`, e.message);
        }
    }
    console.log(`📩 Envoyé à ${authorizedUsers.length} utilisateur(s)`);
}

// Envoi seulement à l'admin (pour les réponses aux commandes admin)
async function sendToAdmin(msg) {
    try {
        await bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: "Markdown" });
    } catch (e) {
        console.error("❌ Telegram admin:", e.message);
    }
}

async function sendWithButtons(msg, yesData, noData) {
    for (const chatId of authorizedUsers) {
        try {
            await bot.sendMessage(chatId, msg, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [[
                        { text: "✅ YES", callback_data: yesData },
                        { text: "❌ NO",  callback_data: noData  }
                    ]]
                }
            });
        } catch (e) {
            console.error(`❌ Telegram buttons [${chatId}]:`, e.message);
        }
    }
}

// ─────────────────────────────────────────────
// 🔥 PAIRES
// ─────────────────────────────────────────────
const symbols = [
    { name: "ETHUSDT",  minVol: 20000,     sigVol: 25000     },
    { name: "BTCUSDT",  minVol: 500,       sigVol: 600       },
    { name: "SOLUSDT",  minVol: 20000,     sigVol: 25000     },
    { name: "BNBUSDT",  minVol: 2000,      sigVol: 2400      },
    { name: "XRPUSDT",  minVol: 500000,    sigVol: 600000    },
    { name: "DOGEUSDT", minVol: 5000000,   sigVol: 6000000   },
    { name: "ADAUSDT",  minVol: 1000000,   sigVol: 1200000   },
    { name: "AVAXUSDT", minVol: 20000,     sigVol: 25000     },
    { name: "LINKUSDT", minVol: 30000,     sigVol: 40000     },
    { name: "DOTUSDT",  minVol: 100000,    sigVol: 120000    },
    { name: "AAVEUSDT", minVol: 1000,      sigVol: 1200      },
    { name: "ZECUSDT",  minVol: 10000,     sigVol: 12000     },
];

// ─────────────────────────────────────────────
// ⚡ CONFIG — PARAMÈTRES ASSOUPLIS
// ─────────────────────────────────────────────
const MOVE_THRESHOLD  = 0.02;
const MOVE_CANDLES    = 2;
const COOLDOWN_MS     = 30 * 60 * 1000;
const RSI_WINDOW      = 5;      // ✅ Élargi 4→5 bougies
const SCORE_MIN       = 50;     // ✅ Abaissé 55→50

// RSI seuils assouplis
const RSI_LONG_MAX  = 32;       // ✅ Assoupli 30→32
const RSI_SHORT_MIN = 78;       // ✅ Assoupli 80→78

// ─────────────────────────────────────────────
// 📡 API FUTURES
// ─────────────────────────────────────────────
const FUTURES_BASE = "https://fapi.binance.com/fapi/v1";

async function fetchKlines(symbol, interval, limit = 120) {
    const res = await axios.get(`${FUTURES_BASE}/klines`, {
        params: { symbol, interval, limit }
    });
    return res.data;
}

// ─────────────────────────────────────────────
// 📊 INDICATEURS
// ─────────────────────────────────────────────
function RSI(closes, period = 6) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period - 1; i < closes.length - 1; i++) {
        const d = closes[i + 1] - closes[i];
        if (d >= 0) gains += d;
        else losses += Math.abs(d);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
}

function EMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data[0];
    const result = [ema];
    for (let i = 1; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
        result.push(ema);
    }
    return result;
}

function MA(data, period) {
    if (data.length < period) return null;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function MACD(closes) {
    const e12        = EMA(closes, 12);
    const e26        = EMA(closes, 26);
    const macdLine   = e12.map((v, i) => v - e26[i]);
    const signalLine = EMA(macdLine, 9);
    const histogram  = macdLine.map((v, i) => v - signalLine[i]);
    return { macdLine, signalLine, histogram };
}

function rsiWasBelow(closes, threshold, period = 6) {
    for (let offset = 1; offset <= RSI_WINDOW; offset++) {
        const slice = closes.slice(0, closes.length - offset + 1);
        if (RSI(slice, period) < threshold) return true;
    }
    return false;
}

function rsiWasAbove(closes, threshold, period = 6) {
    for (let offset = 1; offset <= RSI_WINDOW; offset++) {
        const slice = closes.slice(0, closes.length - offset + 1);
        if (RSI(slice, period) > threshold) return true;
    }
    return false;
}

// ─────────────────────────────────────────────
// 🕐 TENDANCE 2H
// ─────────────────────────────────────────────
async function getTrend2H(symbol) {
    try {
        const candles = await fetchKlines(symbol, "2h", 120);
        const closes  = candles.map(x => parseFloat(x[4]));
        const ma7     = MA(closes, 7);
        const ma25    = MA(closes, 25);
        const rsi2h   = RSI(closes, 6);
        if (!ma7 || !ma25) return "NEUTRAL";
        if (ma7 > ma25 && rsi2h < 65) return "BULL";
        if (ma7 < ma25 && rsi2h > 35) return "BEAR";
        return "NEUTRAL";
    } catch {
        return "NEUTRAL";
    }
}

// ─────────────────────────────────────────────
// 🗂️ ÉTAT
// ─────────────────────────────────────────────
const savedState = loadState();
const state = {};

symbols.forEach(s => {
    const saved = savedState[s.name] || {};
    state[s.name] = {
        lastSignal:         saved.lastSignal         || null,
        lastScoreAlert:     saved.lastScoreAlert     || false,
        consecutiveSL:      saved.consecutiveSL      || 0,
        blocked:            saved.blocked            || false,
        lastMoveAlert:      saved.lastMoveAlert      || null,
        cooldownUntil:      saved.cooldownUntil      || 0,
        lastEarlyAlert:     saved.lastEarlyAlert     || null,
        activeTrade:        saved.activeTrade        || null,
        tradeConfirmStatus: saved.tradeConfirmStatus || "NONE",
    };
});

console.log("💾 État chargé depuis state.json");

// ─────────────────────────────────────────────
// 🟡 ALERTE PRÉCOCE
// ─────────────────────────────────────────────
async function checkEarlyAlert(symbol, closedCloses, rsi, macdData, lastClose) {
    const s = state[symbol];
    if (s.activeTrade) return;

    const macdCurr = macdData.macdLine.at(-1);
    const rsiPrev  = RSI(closedCloses.slice(0, -1), 6);

    if (rsiPrev > 35 && rsi <= 35 && s.lastEarlyAlert !== "LONG") {
        s.lastEarlyAlert = "LONG";
        saveState();
        await send(
`🟡 *MOUVEMENT BAISSIER EN COURS — ${symbol}*

RSI vient de passer sous 35 → *${rsi.toFixed(1)}*
Prix actuel: \`${lastClose.toFixed(2)}\`
MACD: ${macdCurr.toFixed(4)}

⚡ Mouvement de baisse qui s'enclenche
👀 *Surveille un signal LONG si RSI < ${RSI_LONG_MAX} + MACD croise*`
        );
        return;
    }

    if (rsiPrev < 65 && rsi >= 65 && s.lastEarlyAlert !== "SHORT") {
        s.lastEarlyAlert = "SHORT";
        saveState();
        await send(
`🟡 *MOUVEMENT HAUSSIER EN COURS — ${symbol}*

RSI vient de passer au-dessus de 65 → *${rsi.toFixed(1)}*
Prix actuel: \`${lastClose.toFixed(2)}\`
MACD: ${macdCurr.toFixed(4)}

⚡ Mouvement de hausse qui s'enclenche
👀 *Surveille un signal SHORT si RSI > ${RSI_SHORT_MIN} + MACD croise*`
        );
        return;
    }

    if (rsi > 40 && rsi < 60) s.lastEarlyAlert = null;
}

// ─────────────────────────────────────────────
// ⚡ ALERTE MOUVEMENT BRUSQUE
// ─────────────────────────────────────────────
async function checkSuddenMove(symbol, closedCloses, rsi) {
    const s = state[symbol];
    if (closedCloses.length < MOVE_CANDLES + 1) return;

    const priceBefore = closedCloses.at(-(MOVE_CANDLES + 1));
    const priceNow    = closedCloses.at(-1);
    const movePct     = (priceNow - priceBefore) / priceBefore;

    if (movePct <= -MOVE_THRESHOLD && s.lastMoveAlert !== "DOWN") {
        s.lastMoveAlert = "DOWN";
        saveState();
        await send(
`🔴 *CHUTE BRUSQUE — ${symbol}*

Baisse de *${(movePct * 100).toFixed(2)}%* en ${MOVE_CANDLES} bougies 1H
Prix actuel: \`${priceNow.toFixed(2)}\`
RSI: ${rsi.toFixed(1)} ${rsi < 30 ? "⚠️ Zone de rebond possible" : ""}

👀 Surveille un signal LONG si RSI < ${RSI_LONG_MAX}`
        );
        return;
    }

    if (movePct >= MOVE_THRESHOLD && s.lastMoveAlert !== "UP") {
        s.lastMoveAlert = "UP";
        saveState();
        await send(
`🟢 *HAUSSE BRUSQUE — ${symbol}*

Hausse de *+${(movePct * 100).toFixed(2)}%* en ${MOVE_CANDLES} bougies 1H
Prix actuel: \`${priceNow.toFixed(2)}\`
RSI: ${rsi.toFixed(1)} ${rsi > 80 ? "⚠️ Zone de retournement possible" : ""}

👀 Surveille un signal SHORT si RSI > ${RSI_SHORT_MIN}`
        );
        return;
    }

    if (Math.abs(movePct) < MOVE_THRESHOLD * 0.5) s.lastMoveAlert = null;
}

// ─────────────────────────────────────────────
// 🔘 BOUTONS YES / NO
// ─────────────────────────────────────────────
bot.on("callback_query", async (query) => {
    // Accepter les boutons de tous les users autorisés
    if (!authorizedUsers.includes(query.message.chat.id.toString())) return;

    const data   = query.data;
    const parts  = data.split("_");
    const action = parts[0];
    const choice = parts[1];
    const symbol = parts[2];

    const s = state[symbol];
    await bot.answerCallbackQuery(query.id);

    if (action === "HOLD" && choice === "YES") {
        s.tradeConfirmStatus = "USER_CONFIRMED_HOLD";
        saveState();
        await send(`✅ *${symbol}* — Trade confirmé. Surveillance continue ! 👀`);
    }
    if (action === "HOLD" && choice === "NO") {
        s.activeTrade        = null;
        s.lastSignal         = null;
        s.tradeConfirmStatus = "CLOSED";
        s.cooldownUntil      = Date.now() + COOLDOWN_MS;
        saveState();
        await send(`🔒 *${symbol}* — Trade fermé. Cooldown 30min avant prochain signal.`);
    }
    if (action === "EXIT" && choice === "YES") {
        const trade = s.activeTrade;
        if (trade) {
            await send(
`🔒 *${symbol}* — Trade ${trade.type} fermé sur décision.
Entrée: \`${trade.entry.toFixed(2)}\`
👍 Bonne gestion du risque !`
            );
        }
        s.activeTrade        = null;
        s.lastSignal         = null;
        s.tradeConfirmStatus = "CLOSED";
        s.cooldownUntil      = Date.now() + COOLDOWN_MS;
        saveState();
    }
    if (action === "EXIT" && choice === "NO") {
        s.tradeConfirmStatus = "USER_CONFIRMED_HOLD";
        saveState();
        await send(`⚠️ *${symbol}* — Trade conservé. Attention au SL ! 👀`);
    }
});

// ─────────────────────────────────────────────
// 🔄 GESTION DU TRADE EN COURS
// ─────────────────────────────────────────────
async function manageTrade(symbol, lastClose, rsi, macdData) {
    const s     = state[symbol];
    const trade = s.activeTrade;
    if (!trade) return;

    const macdCurr = macdData.macdLine.at(-1);
    const macdPrev = macdData.macdLine.at(-2);
    const sigCurr  = macdData.signalLine.at(-1);
    const sigPrev  = macdData.signalLine.at(-2);

    const macdBull   = macdCurr > sigCurr && macdPrev <= sigPrev;
    const macdBear   = macdCurr < sigCurr && macdPrev >= sigPrev;
    const macdStrong = trade.type === "LONG"
        ? macdCurr > sigCurr
        : macdCurr < sigCurr;

    const pnlPct    = trade.type === "LONG"
        ? ((lastClose - trade.entry) / trade.entry * 100)
        : ((trade.entry - lastClose) / trade.entry * 100);
    const pnlStr    = pnlPct.toFixed(2);
    const pnl20xStr = (pnlPct * 20).toFixed(1);

    if (
        (trade.type === "LONG"  && lastClose >= trade.tp) ||
        (trade.type === "SHORT" && lastClose <= trade.tp)
    ) {
        await send(
`✅ *TP ATTEINT — ${trade.type} ${symbol}*

Entrée: \`${trade.entry.toFixed(2)}\`
TP: \`${trade.tp.toFixed(2)}\`
💰 PnL: +2.0% | +${(2.0 * 20).toFixed(1)}% (20x)

🎯 Excellent trade !`
        );
        s.activeTrade        = null;
        s.lastSignal         = null;
        s.tradeConfirmStatus = "NONE";
        s.consecutiveSL      = 0;
        s.cooldownUntil      = Date.now() + COOLDOWN_MS;
        saveState();
        return;
    }

    if (
        (trade.type === "LONG"  && lastClose <= trade.sl) ||
        (trade.type === "SHORT" && lastClose >= trade.sl)
    ) {
        await send(
`🛑 *SL TOUCHÉ — ${trade.type} ${symbol}*

Entrée: \`${trade.entry.toFixed(2)}\`
SL: \`${trade.sl.toFixed(2)}\`
💸 PnL: -1.5% | -${(1.5 * 20).toFixed(1)}% (20x)`
        );
        s.consecutiveSL++;
        if (s.consecutiveSL >= 2) {
            s.blocked = true;
            await send(`🛑 *${symbol} bloqué* — 2 SL consécutifs.\nEnvoie /reset ${symbol} pour reprendre.`);
        }
        s.activeTrade        = null;
        s.lastSignal         = null;
        s.tradeConfirmStatus = "NONE";
        s.cooldownUntil      = Date.now() + COOLDOWN_MS;
        saveState();
        return;
    }

    if (s.tradeConfirmStatus === "CLOSED") return;

    const shouldExit = trade.type === "LONG"
        ? (macdBear || rsi > 70)
        : (macdBull || rsi < 30);

    if (shouldExit && s.tradeConfirmStatus !== "WAITING_EXIT") {
        s.tradeConfirmStatus = "WAITING_EXIT";
        saveState();
        await sendWithButtons(
`⚠️ *SORTIE RECOMMANDÉE — ${trade.type} ${symbol}*

Prix actuel: \`${lastClose.toFixed(2)}\`
Entrée: \`${trade.entry.toFixed(2)}\`
PnL estimé: ${pnlPct >= 0 ? "+" : ""}${pnlStr}% | ${pnl20xStr}% (20x)

${trade.type === "LONG" ? "⚠️ MACD se retourne ou RSI > 70" : "⚠️ MACD se retourne ou RSI < 30"}

👉 *Veux-tu fermer le trade ?*`,
            `EXIT_YES_${symbol}`,
            `EXIT_NO_${symbol}`
        );
        return;
    }

    if (!trade.reducedSL && pnlPct >= 0.8) {
        trade.sl        = trade.entry;
        trade.reducedSL = true;
        saveState();
        await send(
`🔒 *RÉDUIS TON SL — ${trade.type} ${symbol}*

Le trade est en profit de +${pnlStr}%
👉 *Déplace ton SL au prix d'entrée:* \`${trade.entry.toFixed(2)}\`

Risque zéro — TP reste: \`${trade.tp.toFixed(2)}\``
        );
        return;
    }

    if (
        macdStrong &&
        !shouldExit &&
        s.tradeConfirmStatus !== "WAITING_HOLD" &&
        s.tradeConfirmStatus !== "USER_CONFIRMED_HOLD"
    ) {
        s.tradeConfirmStatus = "WAITING_HOLD";
        saveState();
        await sendWithButtons(
`✅ *TIENS LE ${trade.type} ${symbol}*

Prix actuel: \`${lastClose.toFixed(2)}\`
Entrée: \`${trade.entry.toFixed(2)}\`
PnL estimé: ${pnlPct >= 0 ? "+" : ""}${pnlStr}% | ${pnl20xStr}% (20x)

MACD ${trade.type === "LONG" ? "haussier" : "baissier"} ✅
TP: \`${trade.tp.toFixed(2)}\` | SL: \`${trade.sl.toFixed(2)}\`

👉 *Confirmes-tu tenir le trade ?*`,
            `HOLD_YES_${symbol}`,
            `HOLD_NO_${symbol}`
        );
    }
}

// ─────────────────────────────────────────────
// 🔍 ANALYSE PRINCIPALE — CONDITIONS ASSOUPLIES
// ─────────────────────────────────────────────
async function analyze(symbolObj) {
    const { name: symbol, minVol, sigVol } = symbolObj;
    const s = state[symbol];

    if (s.blocked) {
        console.log(`🛑 ${symbol} bloqué`);
        return;
    }

    if (Date.now() < s.cooldownUntil) {
        const remaining = Math.round((s.cooldownUntil - Date.now()) / 60000);
        console.log(`⏳ ${symbol} — Cooldown (${remaining} min)`);
        return;
    }

    try {
        const candles = await fetchKlines(symbol, "1h", 120);

        const closes  = candles.map(x => parseFloat(x[4]));
        const opens   = candles.map(x => parseFloat(x[1]));
        const highs   = candles.map(x => parseFloat(x[2]));
        const lows    = candles.map(x => parseFloat(x[3]));
        const volumes = candles.map(x => parseFloat(x[5]));

        const closedCloses  = closes.slice(0, -1);
        const closedVolumes = volumes.slice(0, -1);
        const closedHighs   = highs.slice(0, -1);
        const closedLows    = lows.slice(0, -1);

        const lastClose  = closes.at(-2);
        const lastOpen   = opens.at(-2);
        const lastVolume = volumes.at(-2);

        const rsi      = RSI(closedCloses, 6);
        const macdData = MACD(closedCloses);

        const macdCurr   = macdData.macdLine.at(-1);
        const macdPrev   = macdData.macdLine.at(-2);
        const signalCurr = macdData.signalLine.at(-1);
        const signalPrev = macdData.signalLine.at(-2);

        // ✅ CROSSOVER exact (rare mais fort)
        const macdBullCross = macdCurr > signalCurr && macdPrev <= signalPrev;
        const macdBearCross = macdCurr < signalCurr && macdPrev >= signalPrev;

        // ✅ POSITION MACD (plus souple — MACD au-dessus/dessous du signal)
        const macdBullPos = macdCurr > signalCurr;
        const macdBearPos = macdCurr < signalCurr;

        const ma7    = MA(closedCloses, 7);
        const ma25   = MA(closedCloses, 25);
        const ma99   = MA(closedCloses, 99);
        const avgVol = MA(closedVolumes, 10);

        const bullishCandle = lastClose > lastOpen;
        const bearishCandle = lastClose < lastOpen;

        // ⚡ Mouvement brusque
        await checkSuddenMove(symbol, closedCloses, rsi);

        // 🟡 Alerte précoce
        await checkEarlyAlert(symbol, closedCloses, rsi, macdData, lastClose);

        if (s.activeTrade) {
            await manageTrade(symbol, lastClose, rsi, macdData);
            return;
        }

        // ── Filtres de marché ─────────────────
        const range20High = Math.max(...closedHighs.slice(-20));
        const range20Low  = Math.min(...closedLows.slice(-20));
        const isRange     = (range20High - range20Low) / lastClose < 0.004;
        const move5       = (closedCloses.at(-1) - closedCloses.at(-5)) / closedCloses.at(-5);
        const pumpDump    = Math.abs(move5) > 0.03;

        if (lastVolume < minVol) {
            console.log(`⏸ ${symbol} — Volume faible`);
            return;
        }
        if (rsi > 36 && rsi < 64) {
            console.log(`⏸ ${symbol} — RSI neutre (${rsi.toFixed(1)})`);
            return;
        }
        if (isRange)  { console.log(`⏸ ${symbol} — Range`);     return; }
        if (pumpDump) { console.log(`⏸ ${symbol} — Pump/dump`); return; }

        // ── Fenêtre RSI élargie (5 bougies) ──
        const rsiOversold   = rsiWasBelow(closedCloses, RSI_LONG_MAX);
        const rsiOverbought = rsiWasAbove(closedCloses, RSI_SHORT_MIN);

        // ── Tendance 2H ───────────────────────
        const trend2H = await getTrend2H(symbol);

        // ── Score ─────────────────────────────
        // ✅ Bougie verte/rouge → bonus score (pas obligatoire)
        let score = 0;
        if      (rsi < 25 || rsi > 85) score += 30;
        else if (rsi < 30 || rsi > 80) score += 20;
        else if (rsi < 32 || rsi > 78) score += 10; // ✅ Nouveau palier
        if (macdBullCross || macdBearCross) score += 30; // crossover exact
        else if (macdBullPos || macdBearPos) score += 15; // ✅ position favorable
        if (lastVolume > avgVol * 1.5)  score += 20;
        else if (lastVolume > avgVol)   score += 10;      // ✅ volume moyen aussi récompensé
        if (bullishCandle || bearishCandle) score += 15;  // ✅ réduit de 20→15 (bonus, pas obligatoire)
        if (ma7 && ma25 && ma99) {
            if (ma7 > ma25 && ma25 > ma99) score += 10;
            if (ma7 < ma25 && ma25 < ma99) score += 10;
        }
        if ((trend2H === "BULL" && rsiOversold) ||
            (trend2H === "BEAR" && rsiOverbought)) score += 10;

        console.log(`\n🔍 ${symbol} [1H] | RSI: ${rsi.toFixed(1)} | Vol: ${Math.round(lastVolume)} | 2H: ${trend2H} | Score: ${score} | MACD: ${macdBullPos ? "BULL" : macdBearPos ? "BEAR" : "NEUTRE"}`);

        // ── Alerte opportunité ────────────────
        if (score >= SCORE_MIN && !s.lastScoreAlert) {
            s.lastScoreAlert = true;
            saveState();
            await send(
`⚠️ *OPPORTUNITÉ ${symbol}* [Futures 1H]

Score: ${score}%
RSI 1H: ${rsi.toFixed(1)}
Tendance 2H: ${trend2H === "BULL" ? "🟢 Haussière" : trend2H === "BEAR" ? "🔴 Baissière" : "⚪ Neutre"}
Volume: ${Math.round(lastVolume)}
MA7: ${ma7?.toFixed(2)} | MA25: ${ma25?.toFixed(2)} | MA99: ${ma99?.toFixed(2)}

👉 Setup en formation — attends bougie 1H fermée`
            );
        }
        if (score < SCORE_MIN - 10) s.lastScoreAlert = false;

        // ─────────────────────────────────────────────
        // 🚀 SIGNAL LONG — CONDITIONS ASSOUPLIES
        // ✅ MACD position favorable suffit (pas obligatoirement crossover)
        // ✅ Bougie verte = bonus score, non obligatoire
        // ✅ RSI seuil élargi à 32
        // ✅ Volume = sigVol (abaissé de 20%)
        // ─────────────────────────────────────────────
        if (
            rsiOversold             &&
            rsi < 65                &&
            macdBullPos             && // ✅ position ou crossover
            lastVolume > sigVol     &&
            score >= SCORE_MIN      &&
            trend2H !== "BEAR"
        ) {
            if (s.lastSignal !== "LONG") {
                s.lastSignal         = "LONG";
                s.tradeConfirmStatus = "NONE";

                const entry = lastClose;
                const tp    = entry * 1.020;
                const sl    = entry * 0.985;

                s.activeTrade = { type: "LONG", entry, tp, sl, reducedSL: false };
                saveState();

                const macdLabel = macdBullCross ? "🔥 CROSSOVER HAUSSIER" : "✅ Position haussière";

                await send(
`🚀 *LONG ${symbol}* [Futures 20x]
Bougie 1H fermée ✅

Prix entrée: \`${entry.toFixed(2)}\`
RSI 1H: ${rsi.toFixed(1)} | Score: ${score}%
Tendance 2H: ${trend2H === "BULL" ? "🟢 BULL" : "⚪ NEUTRAL"}
MACD: ${macdLabel}
Volume: ${Math.round(lastVolume)}
MA7: ${ma7?.toFixed(2)} | MA25: ${ma25?.toFixed(2)} | MA99: ${ma99?.toFixed(2)}

🎯 TP: \`${tp.toFixed(2)}\` (+2.0%)
🛑 SL: \`${sl.toFixed(2)}\` (-1.5%)
📐 R/R: 1.3

_Le bot surveille et alertera avec boutons_`
                );
            }
        }

        // ─────────────────────────────────────────────
        // 📉 SIGNAL SHORT — CONDITIONS ASSOUPLIES
        // ─────────────────────────────────────────────
        else if (
            rsiOverbought           &&
            rsi > 35                &&
            macdBearPos             && // ✅ position ou crossover
            lastVolume > sigVol     &&
            score >= SCORE_MIN      &&
            trend2H !== "BULL"
        ) {
            if (s.lastSignal !== "SHORT") {
                s.lastSignal         = "SHORT";
                s.tradeConfirmStatus = "NONE";

                const entry = lastClose;
                const tp    = entry * 0.980;
                const sl    = entry * 1.015;

                s.activeTrade = { type: "SHORT", entry, tp, sl, reducedSL: false };
                saveState();

                const macdLabel = macdBearCross ? "🔥 CROSSOVER BAISSIER" : "✅ Position baissière";

                await send(
`📉 *SHORT ${symbol}* [Futures 20x]
Bougie 1H fermée ✅

Prix entrée: \`${entry.toFixed(2)}\`
RSI 1H: ${rsi.toFixed(1)} | Score: ${score}%
Tendance 2H: ${trend2H === "BEAR" ? "🔴 BEAR" : "⚪ NEUTRAL"}
MACD: ${macdLabel}
Volume: ${Math.round(lastVolume)}
MA7: ${ma7?.toFixed(2)} | MA25: ${ma25?.toFixed(2)} | MA99: ${ma99?.toFixed(2)}

🎯 TP: \`${tp.toFixed(2)}\` (-2.0%)
🛑 SL: \`${sl.toFixed(2)}\` (+1.5%)
📐 R/R: 1.3

_Le bot surveille et alertera avec boutons_`
                );
            }
        } else {
            s.lastSignal = null;
        }

    } catch (e) {
        console.error(`❌ Erreur ${symbol}:`, e.message);
    }
}

// ─────────────────────────────────────────────
// 🔁 SCAN
// ─────────────────────────────────────────────
function scan() {
    symbols.forEach(analyze);
}

// ─────────────────────────────────────────────
// 📣 COMMANDES TELEGRAM
// ─────────────────────────────────────────────

// ── /start — Nouveau user ─────────────────────
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const name   = msg.from.first_name || "Trader";

    // Log l'ID pour que l'admin puisse l'ajouter
    console.log(`🆕 Nouveau /start — ID: ${chatId} | Nom: ${name}`);

    if (authorizedUsers.includes(chatId)) {
        await bot.sendMessage(chatId,
`✅ *Bienvenue ${name} !*

Tu es déjà autorisé sur CryptoSignal Bot.
Le bot te notifiera automatiquement des signaux Futures.

Commandes disponibles: /status /help`,
            { parse_mode: "Markdown" }
        );
        return;
    }

    // Message à l'inconnu
    await bot.sendMessage(chatId,
`👋 Bonjour ${name} !

Ce bot est privé. Ton ID Telegram est: \`${chatId}\`

Contacte l'administrateur pour obtenir l'accès.`,
        { parse_mode: "Markdown" }
    );

    // Notifier l'admin
    await sendToAdmin(
`🆕 *Nouvelle demande d'accès*

Nom: ${name}
ID: \`${chatId}\`

Pour autoriser: /adduser ${chatId}
Pour refuser: ignore simplement`
    );
});

// ── COMMANDES ADMIN UNIQUEMENT ────────────────
function isAdmin(msg) {
    return msg.chat.id.toString() === ADMIN_CHAT_ID;
}

// /adduser — Ajouter un user
bot.onText(/\/adduser (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) {
        await bot.sendMessage(msg.chat.id, "❌ Commande réservée à l'administrateur.");
        return;
    }
    const newId = match[1].trim();
    if (authorizedUsers.includes(newId)) {
        await sendToAdmin(`⚠️ L'utilisateur \`${newId}\` est déjà autorisé.`);
        return;
    }
    authorizedUsers.push(newId);
    saveUsers(authorizedUsers);
    await sendToAdmin(`✅ Utilisateur \`${newId}\` ajouté — ${authorizedUsers.length} user(s) actif(s).`);
    // Notifier le nouvel user
    try {
        await bot.sendMessage(newId,
`🎉 *Accès accordé !*

Tu es maintenant autorisé sur CryptoSignal Bot.
Tu recevras tous les signaux Futures en temps réel.

Commandes: /status /help`,
            { parse_mode: "Markdown" }
        );
    } catch (e) {
        await sendToAdmin(`⚠️ Impossible de notifier l'utilisateur \`${newId}\` — il doit d'abord envoyer /start au bot.`);
    }
});

// /removeuser — Retirer un user
bot.onText(/\/removeuser (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) {
        await bot.sendMessage(msg.chat.id, "❌ Commande réservée à l'administrateur.");
        return;
    }
    const removeId = match[1].trim();
    if (removeId === ADMIN_CHAT_ID) {
        await sendToAdmin("❌ Tu ne peux pas te retirer toi-même.");
        return;
    }
    const before = authorizedUsers.length;
    authorizedUsers = authorizedUsers.filter(id => id !== removeId);
    saveUsers(authorizedUsers);
    if (authorizedUsers.length < before) {
        await sendToAdmin(`✅ Utilisateur \`${removeId}\` retiré — ${authorizedUsers.length} user(s) restant(s).`);
    } else {
        await sendToAdmin(`⚠️ ID \`${removeId}\` non trouvé dans la liste.`);
    }
});

// /users — Liste des users
bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg)) return;
    let txt = `👥 *Utilisateurs autorisés (${authorizedUsers.length})*\n\n`;
    authorizedUsers.forEach((id, i) => {
        txt += `${i + 1}. \`${id}\`${id === ADMIN_CHAT_ID ? " 👑 Admin" : ""}\n`;
    });
    await sendToAdmin(txt);
});

// /reset — Débloquer une paire
bot.onText(/\/reset (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const sym = match[1].toUpperCase().trim();
    if (state[sym]) {
        state[sym].blocked             = false;
        state[sym].consecutiveSL       = 0;
        state[sym].lastSignal          = null;
        state[sym].activeTrade         = null;
        state[sym].tradeConfirmStatus  = "NONE";
        state[sym].lastMoveAlert       = null;
        state[sym].lastEarlyAlert      = null;
        state[sym].cooldownUntil       = 0;
        saveState();
        await send(`✅ *${sym}* débloqué — trading repris.`);
    } else {
        await sendToAdmin(`❌ Symbole *${sym}* inconnu.`);
    }
});

// /close — Fermer un trade
bot.onText(/\/close (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const sym = match[1].toUpperCase().trim();
    if (state[sym]?.activeTrade) {
        const trade = state[sym].activeTrade;
        state[sym].activeTrade        = null;
        state[sym].lastSignal         = null;
        state[sym].tradeConfirmStatus = "CLOSED";
        state[sym].cooldownUntil      = Date.now() + COOLDOWN_MS;
        saveState();
        await send(`🔒 *${sym}* — Trade ${trade.type} fermé manuellement. Cooldown 30min.`);
    } else {
        await sendToAdmin(`❌ Aucun trade actif sur *${sym}*.`);
    }
});

// /status — Statut des paires (tous les users)
bot.onText(/\/status/, async (msg) => {
    if (!authorizedUsers.includes(msg.chat.id.toString())) return;
    let txt = "📊 *Statut des paires*\n\n";
    symbols.forEach(s => {
        const st         = state[s.name];
        const trade      = st.activeTrade;
        const inCooldown = Date.now() < st.cooldownUntil;
        const remaining  = inCooldown
            ? ` | ⏳ ${Math.round((st.cooldownUntil - Date.now()) / 60000)}min`
            : "";
        if (trade) {
            txt += `🔵 *${s.name}* — ${trade.type} actif | Entrée: ${trade.entry.toFixed(2)}\n`;
        } else {
            txt += `${st.blocked ? "🛑" : inCooldown ? "⏳" : "✅"} *${s.name}* — Aucun trade | SL: ${st.consecutiveSL}/2${remaining}\n`;
        }
    });
    await bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

// /help
bot.onText(/\/help/, async (msg) => {
    if (!authorizedUsers.includes(msg.chat.id.toString())) return;
    const isAdminUser = isAdmin(msg);
    let helpMsg = `🤖 *Commandes disponibles*\n\n/status — état de toutes les paires\n/help — cette aide`;
    if (isAdminUser) {
        helpMsg += `\n\n👑 *Commandes Admin*\n/adduser ID — ajouter un utilisateur\n/removeuser ID — retirer un utilisateur\n/users — liste des utilisateurs\n/reset SYMBOL — débloquer une paire\n/close SYMBOL — fermer un trade`;
    }
    await bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: "Markdown" });
});

// ─────────────────────────────────────────────
// 🚀 DÉMARRAGE
// ─────────────────────────────────────────────
console.log("🤖 Bot Futures 1H lancé...");
send(
`🤖 *Bot Futures lancé — v2.0*

✅ Système multi-utilisateurs actif
✅ RSI fenêtre élargie à 5 bougies
✅ MACD position favorable acceptée
✅ Score minimum: ${SCORE_MIN}
✅ RSI LONG < ${RSI_LONG_MAX} | SHORT > ${RSI_SHORT_MIN}
✅ Alertes précoces & mouvements brusques
✅ Cooldown 30min | TP +2% | SL -1.5%
✅ 12 paires Futures scannées

Commandes: /status /help`
);

scan();
setInterval(scan, 15000);

// ─────────────────────────────────────────────
// 🛑 ARRÊT PROPRE
// ─────────────────────────────────────────────
async function shutdown() {
    console.log("🛑 Arrêt...");
    saveState();
    setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);