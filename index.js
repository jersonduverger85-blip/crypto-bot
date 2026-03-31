require("dotenv").config();
const axios  = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fs     = require("fs");
const path   = require("path");

// ─────────────────────────────────────────────
// 🔑 CONFIG
// ─────────────────────────────────────────────
const TOKEN   = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
    console.error("❌ TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID manquant dans .env");
    process.exit(1);
}

// ✅ Fix 409 — polling robuste
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
// 🔥 PAIRES
// ─────────────────────────────────────────────
const symbols = [
    { name: "ETHUSDT",  minVol: 20000,     sigVol: 30000     },
    { name: "BTCUSDT",  minVol: 500,       sigVol: 800       },
    { name: "SOLUSDT",  minVol: 20000,     sigVol: 30000     },
    { name: "BNBUSDT",  minVol: 2000,      sigVol: 3000      },
    { name: "XRPUSDT",  minVol: 500000,    sigVol: 800000    },
    { name: "DOGEUSDT", minVol: 5000000,   sigVol: 8000000   },
    { name: "ADAUSDT",  minVol: 1000000,   sigVol: 1500000   },
    { name: "AVAXUSDT", minVol: 20000,     sigVol: 30000     },
    { name: "LINKUSDT", minVol: 30000,     sigVol: 50000     },
    { name: "DOTUSDT",  minVol: 100000,    sigVol: 150000    },
    { name: "AAVEUSDT", minVol: 1000,      sigVol: 1500      },
    { name: "ZECUSDT",  minVol: 10000,     sigVol: 15000     },
];

// ─────────────────────────────────────────────
// ⚡ CONFIG
// ─────────────────────────────────────────────
const MOVE_THRESHOLD = 0.02;             // 2% mouvement brusque
const MOVE_CANDLES   = 2;               // sur 2 bougies 1H
const COOLDOWN_MS    = 30 * 60 * 1000; // 30min cooldown après fermeture

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

function rsiWasBelow(closes, threshold, lookback = 3, period = 6) {
    for (let offset = 1; offset <= lookback; offset++) {
        const slice = closes.slice(0, closes.length - offset + 1);
        if (RSI(slice, period) < threshold) return true;
    }
    return false;
}

function rsiWasAbove(closes, threshold, lookback = 3, period = 6) {
    for (let offset = 1; offset <= lookback; offset++) {
        const slice = closes.slice(0, closes.length - offset + 1);
        if (RSI(slice, period) > threshold) return true;
    }
    return false;
}

// ─────────────────────────────────────────────
// 🕐 TENDANCE 2H (confirmation pour trades 1H)
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
// 📩 TELEGRAM
// ─────────────────────────────────────────────
async function send(msg) {
    try {
        await bot.sendMessage(CHAT_ID, msg, { parse_mode: "Markdown" });
        console.log("📩 Envoyé");
    } catch (e) {
        console.error("❌ Telegram:", e.message);
    }
}

async function sendWithButtons(msg, yesData, noData) {
    try {
        await bot.sendMessage(CHAT_ID, msg, {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ YES", callback_data: yesData },
                    { text: "❌ NO",  callback_data: noData  }
                ]]
            }
        });
        console.log("📩 Envoyé avec boutons");
    } catch (e) {
        console.error("❌ Telegram:", e.message);
    }
}

// ─────────────────────────────────────────────
// 🗂️ ÉTAT — chargé depuis fichier
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
        activeTrade:        saved.activeTrade        || null,
        tradeConfirmStatus: saved.tradeConfirmStatus || "NONE",
    };
});

console.log("💾 État chargé depuis state.json");

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

👀 Surveille un signal LONG si RSI < 30`
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

👀 Surveille un signal SHORT si RSI > 80`
        );
        return;
    }

    if (Math.abs(movePct) < MOVE_THRESHOLD * 0.5) {
        s.lastMoveAlert = null;
    }
}

// ─────────────────────────────────────────────
// 🔘 BOUTONS YES / NO
// ─────────────────────────────────────────────
bot.on("callback_query", async (query) => {
    if (query.message.chat.id.toString() !== CHAT_ID) return;

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
        await send(`✅ *${symbol}* — Tu tiens le trade. Surveillance continue ! 👀`);
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
`🔒 *${symbol}* — Trade ${trade.type} fermé sur ta décision.
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
        await send(`⚠️ *${symbol}* — Tu gardes le trade. Attention au SL ! 👀`);
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

    // ── TP atteint ─────────────────────────
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

    // ── SL atteint ─────────────────────────
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

    // ── Priorité 1 — SORTIE ────────────────
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

    // ── Priorité 2 — RÉDUCTION SL ──────────
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

    // ── Priorité 3 — TENIR ─────────────────
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
// 🔍 ANALYSE PRINCIPALE — 1H
// ─────────────────────────────────────────────
async function analyze(symbolObj) {
    const { name: symbol, minVol, sigVol } = symbolObj;
    const s = state[symbol];

    if (s.blocked) {
        console.log(`🛑 ${symbol} bloqué`);
        return;
    }

    // ✅ Cooldown actif — on attend
    if (Date.now() < s.cooldownUntil) {
        const remaining = Math.round((s.cooldownUntil - Date.now()) / 60000);
        console.log(`⏳ ${symbol} — Cooldown actif (${remaining} min restantes)`);
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

        const macdBull = macdCurr > signalCurr && macdPrev <= signalPrev;
        const macdBear = macdCurr < signalCurr && macdPrev >= signalPrev;

        const ma7    = MA(closedCloses, 7);
        const ma25   = MA(closedCloses, 25);
        const ma99   = MA(closedCloses, 99);
        const avgVol = MA(closedVolumes, 10);

        const bullishCandle = lastClose > lastOpen;
        const bearishCandle = lastClose < lastOpen;

        // ⚡ Mouvement brusque EN PREMIER
        await checkSuddenMove(symbol, closedCloses, rsi);

        // ── Trade actif → gestion ─────────────
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
            console.log(`⏸ ${symbol} — Volume faible (${Math.round(lastVolume)})`);
            return;
        }
        if (rsi > 35 && rsi < 65) {
            console.log(`⏸ ${symbol} — RSI neutre (${rsi.toFixed(2)})`);
            return;
        }
        if (isRange)  { console.log(`⏸ ${symbol} — Range`);     return; }
        if (pumpDump) { console.log(`⏸ ${symbol} — Pump/dump`); return; }

        // ── Fenêtre RSI ───────────────────────
        const rsiOversold   = rsiWasBelow(closedCloses, 30, 3);
        const rsiOverbought = rsiWasAbove(closedCloses, 80, 3);

        // ── Tendance 2H ───────────────────────
        const trend2H = await getTrend2H(symbol);

        // ── Score ─────────────────────────────
        let score = 0;
        if      (rsi < 25 || rsi > 85) score += 30;
        else if (rsi < 30 || rsi > 80) score += 20;
        if (macdBull || macdBear)       score += 30;
        if (lastVolume > avgVol * 1.5)  score += 20;
        if (bullishCandle || bearishCandle) score += 20;
        if (ma7 && ma25 && ma99) {
            if (ma7 > ma25 && ma25 > ma99) score += 10;
            if (ma7 < ma25 && ma25 < ma99) score += 10;
        }
        if ((trend2H === "BULL" && rsiOversold) ||
            (trend2H === "BEAR" && rsiOverbought)) score += 10;

        console.log(`\n🔍 ${symbol} [1H] | RSI: ${rsi.toFixed(1)} | Vol: ${Math.round(lastVolume)} | 2H: ${trend2H} | Score: ${score}`);

        // ── Alerte opportunité ────────────────
        if (score >= 60 && !s.lastScoreAlert) {
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
        if (score < 50) s.lastScoreAlert = false;

        // ─────────────────────────────────────────────
        // 🚀 SIGNAL LONG
        // ✅ Fix : RSI actuel < 65 — évite contradiction
        // ─────────────────────────────────────────────
        if (
            rsiOversold         &&
            rsi < 65            &&
            macdBull            &&
            lastVolume > sigVol &&
            bullishCandle       &&
            score >= 60         &&
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

                await send(
`🚀 *LONG ${symbol}* [Futures 20x]
Bougie 1H fermée ✅

Prix entrée: \`${entry.toFixed(2)}\`
RSI 1H: ${rsi.toFixed(1)} | Score: ${score}%
Tendance 2H: 🟢 ${trend2H}
Volume: ${Math.round(lastVolume)}
MA7: ${ma7?.toFixed(2)} | MA25: ${ma25?.toFixed(2)} | MA99: ${ma99?.toFixed(2)}

🎯 TP: \`${tp.toFixed(2)}\` (+2.0%)
🛑 SL: \`${sl.toFixed(2)}\` (-1.5%)
📐 R/R: 1.3

_Le bot surveille et t'alertera avec boutons_`
                );
            }
        }

        // ─────────────────────────────────────────────
        // 📉 SIGNAL SHORT
        // ✅ Fix : RSI actuel > 35 — évite contradiction
        // ─────────────────────────────────────────────
        else if (
            rsiOverbought       &&
            rsi > 35            &&
            macdBear            &&
            lastVolume > sigVol &&
            bearishCandle       &&
            score >= 60
        ) {
            if (s.lastSignal !== "SHORT") {
                s.lastSignal         = "SHORT";
                s.tradeConfirmStatus = "NONE";

                const entry = lastClose;
                const tp    = entry * 0.980;
                const sl    = entry * 1.015;

                s.activeTrade = { type: "SHORT", entry, tp, sl, reducedSL: false };
                saveState();

                await send(
`📉 *SHORT ${symbol}* [Futures 20x]
Bougie 1H fermée ✅

Prix entrée: \`${entry.toFixed(2)}\`
RSI 1H: ${rsi.toFixed(1)} | Score: ${score}%
Tendance 2H: 🔴 ${trend2H}
Volume: ${Math.round(lastVolume)}
MA7: ${ma7?.toFixed(2)} | MA25: ${ma25?.toFixed(2)} | MA99: ${ma99?.toFixed(2)}

🎯 TP: \`${tp.toFixed(2)}\` (-2.0%)
🛑 SL: \`${sl.toFixed(2)}\` (+1.5%)
📐 R/R: 1.3

_Le bot surveille et t'alertera avec boutons_`
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
// 🔁 SCAN — toutes les 15 secondes
// ─────────────────────────────────────────────
function scan() {
    symbols.forEach(analyze);
}

// ─────────────────────────────────────────────
// 📣 COMMANDES TELEGRAM
// ─────────────────────────────────────────────
bot.onText(/\/reset (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const sym = match[1].toUpperCase().trim();
    if (state[sym]) {
        state[sym].blocked             = false;
        state[sym].consecutiveSL       = 0;
        state[sym].lastSignal          = null;
        state[sym].activeTrade         = null;
        state[sym].tradeConfirmStatus  = "NONE";
        state[sym].lastMoveAlert       = null;
        state[sym].cooldownUntil       = 0;
        saveState();
        send(`✅ *${sym}* débloqué — trading repris.`);
    } else {
        send(`❌ Symbole *${sym}* inconnu.`);
    }
});

bot.onText(/\/close (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    const sym = match[1].toUpperCase().trim();
    if (state[sym]?.activeTrade) {
        const trade = state[sym].activeTrade;
        state[sym].activeTrade        = null;
        state[sym].lastSignal         = null;
        state[sym].tradeConfirmStatus = "CLOSED";
        state[sym].cooldownUntil      = Date.now() + COOLDOWN_MS;
        saveState();
        send(`🔒 *${sym}* — Trade ${trade.type} fermé manuellement. Cooldown 30min.`);
    } else {
        send(`❌ Aucun trade actif sur *${sym}*.`);
    }
});

bot.onText(/\/status/, (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
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
    send(txt);
});

bot.onText(/\/help/, (msg) => {
    if (msg.chat.id.toString() !== CHAT_ID) return;
    send(
`🤖 *Commandes disponibles*

/status — état de toutes les paires
/reset SYMBOL — débloquer après 2 SL ou cooldown
/close SYMBOL — fermer un trade manuellement
/help — cette aide`
    );
});

// ─────────────────────────────────────────────
// 🚀 DÉMARRAGE
// ─────────────────────────────────────────────
console.log("🤖 Bot Futures 1H lancé...");
send(
`🤖 *Bot Futures lancé — Timeframe 1H*

✅ Fix contradiction LONG/SHORT
✅ Cooldown 30min après fermeture
✅ Fix 409 — polling robuste
✅ Sauvegarde état automatique
✅ Alertes mouvements brusques ±2%
✅ Confirmation tendance 2H
✅ TP +2.0% | SL -1.5% | R/R 1.3
✅ Boutons YES / NO interactifs
✅ 12 paires Futures scannées

Commandes: /status /reset /close /help`
);

scan();
setInterval(scan, 15000);

// ─────────────────────────────────────────────
// 🛑 ARRÊT PROPRE
// ─────────────────────────────────────────────
async function shutdown() {
    console.log("🛑 Arrêt...");
    saveState();
    try { await send("🛑 *Bot arrêté proprement.*"); } catch {}
    setTimeout(() => process.exit(0), 1500);
}

process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);