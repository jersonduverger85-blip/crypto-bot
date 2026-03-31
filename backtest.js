/**
 * ─────────────────────────────────────────────
 * 📊 BACKTEST v3 — RSI window + diagnostic
 * Lance avec: node backtest.js
 * ─────────────────────────────────────────────
 * Fix : RSI < 30 accepté dans les 3 bougies
 * précédant le croisement MACD (plus réaliste)
 * ─────────────────────────────────────────────
 */

const axios = require("axios");

const FUTURES_BASE = "https://fapi.binance.com/fapi/v1";

// ─── Config ───────────────────────────────────
const SYMBOL   = "BNBUSDT";
const INTERVAL = "15m";
const LIMIT    = 1500;
const TP_PCT   = 0.013; // +1.3%
const SL_PCT   = 0.010; // -1.0%

// ─── Indicateurs ──────────────────────────────

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
    const e12      = EMA(closes, 12);
    const e26      = EMA(closes, 26);
    const macdLine = e12.map((v, i) => v - e26[i]);
    const sigLine  = EMA(macdLine, 9);
    return { macdLine, sigLine };
}

// ─── Vérifie si RSI était < seuil dans les N dernières bougies ────
function rsiWasBelow(closes, threshold, lookback = 3, period = 6) {
    for (let offset = 1; offset <= lookback; offset++) {
        const slice = closes.slice(0, closes.length - offset + 1);
        if (RSI(slice, period) < threshold) return true;
    }
    return false;
}

// ─── Vérifie si RSI était > seuil dans les N dernières bougies ────
function rsiWasAbove(closes, threshold, lookback = 3, period = 6) {
    for (let offset = 1; offset <= lookback; offset++) {
        const slice = closes.slice(0, closes.length - offset + 1);
        if (RSI(slice, period) > threshold) return true;
    }
    return false;
}

// ─── Backtest principal ───────────────────────
async function runBacktest() {
    console.log(`\n📊 BACKTEST — ${SYMBOL} ${INTERVAL} | ${LIMIT} bougies\n`);

    const res = await axios.get(`${FUTURES_BASE}/klines`, {
        params: { symbol: SYMBOL, interval: INTERVAL, limit: LIMIT }
    });

    const candles = res.data;
    const closes  = candles.map(x => parseFloat(x[4]));
    const opens   = candles.map(x => parseFloat(x[1]));
    const highs   = candles.map(x => parseFloat(x[2]));
    const lows    = candles.map(x => parseFloat(x[3]));
    const volumes = candles.map(x => parseFloat(x[5]));
    const times   = candles.map(x => new Date(x[0]).toISOString().slice(0, 16));

    // ── Compteurs diagnostic ──────────────────
    let blockedByVolume   = 0;
    let blockedByRSIzone  = 0;
    let blockedByRange    = 0;
    let blockedByPumpDump = 0;
    let passedAllFilters  = 0;

    let rsiMin = 100, rsiMax = 0;
    let volMin = Infinity, volMax = 0;

    const trades      = [];
    let consecutiveSL = 0;
    let blocked       = false;

    for (let i = 100; i < candles.length - 2; i++) {

        const closesSlice  = closes.slice(0, i + 1);
        const volumesSlice = volumes.slice(0, i + 1);
        const highsSlice   = highs.slice(0, i + 1);
        const lowsSlice    = lows.slice(0, i + 1);

        const close  = closes[i];
        const open   = opens[i];
        const volume = volumes[i];

        const rsi = RSI(closesSlice, 6);

        // Stats
        if (rsi < rsiMin) rsiMin = rsi;
        if (rsi > rsiMax) rsiMax = rsi;
        if (volume < volMin) volMin = volume;
        if (volume > volMax) volMax = volume;

        // ── Filtres de base ───────────────────
        if (volume < 20000)          { blockedByVolume++;   continue; }
        if (rsi > 35 && rsi < 65)   { blockedByRSIzone++;  continue; }

        const range20High = Math.max(...highsSlice.slice(-20));
        const range20Low  = Math.min(...lowsSlice.slice(-20));
        if ((range20High - range20Low) / close < 0.004) { blockedByRange++;    continue; }

        const move5 = (closes[i] - closes[i - 4]) / closes[i - 4];
        if (Math.abs(move5) > 0.03) { blockedByPumpDump++; continue; }

        passedAllFilters++;

        if (blocked) continue;

        // ── Indicateurs ───────────────────────
        const macdData = MACD(closesSlice);
        const macdCurr = macdData.macdLine.at(-1);
        const macdPrev = macdData.macdLine.at(-2);
        const sigCurr  = macdData.sigLine.at(-1);
        const sigPrev  = macdData.sigLine.at(-2);

        const macdBull = macdCurr > sigCurr && macdPrev <= sigPrev;
        const macdBear = macdCurr < sigCurr && macdPrev >= sigPrev;

        const ma7    = MA(closesSlice, 7);
        const ma25   = MA(closesSlice, 25);
        const ma99   = MA(closesSlice, 99);
        const avgVol = MA(volumesSlice, 10);

        const bullish = close > open;
        const bearish = close < open;

        // ── Score ─────────────────────────────
        let score = 0;
        if      (rsi < 25 || rsi > 85) score += 30;
        else if (rsi < 30 || rsi > 80) score += 20;
        if (macdBull || macdBear)       score += 30;
        if (volume > avgVol * 1.5)      score += 20;
        if (bullish || bearish)         score += 20;
        if (ma7 && ma25 && ma99) {
            if (ma7 > ma25 && ma25 > ma99) score += 10;
            if (ma7 < ma25 && ma25 < ma99) score += 10;
        }

        // ── Fenêtre RSI (clé du fix) ──────────
        // RSI était-il sous 30 dans les 3 dernières bougies ?
        const rsiOversold   = rsiWasBelow(closesSlice, 30, 3);
        // RSI était-il au-dessus de 83 dans les 3 dernières bougies ?
        const rsiOverbought = rsiWasAbove(closesSlice, 83, 3);

        // ── Signal LONG ───────────────────────
        // RSI oversold récent + croisement MACD haussier + bougie verte
        if (rsiOversold && macdBull && volume > 30000 && bullish && score >= 60) {

            if (!blocked) {
                const entry   = closes[i + 1];
                const tpPrice = entry * (1 + TP_PCT);
                const slPrice = entry * (1 - SL_PCT);
                let result    = "PENDING";
                let exitPrice = null;

                for (let j = i + 1; j < Math.min(i + 20, candles.length); j++) {
                    if (highs[j] >= tpPrice) { result = "WIN";  exitPrice = tpPrice; break; }
                    if (lows[j]  <= slPrice) { result = "LOSS"; exitPrice = slPrice; break; }
                }

                if (result !== "PENDING") {
                    const pnl = result === "WIN" ? TP_PCT * 100 : -SL_PCT * 100;
                    if (result === "LOSS") {
                        consecutiveSL++;
                        if (consecutiveSL >= 2) {
                            blocked = true;
                            console.log(`🛑 Bloqué après 2 SL consécutifs à ${times[i]}`);
                        }
                    } else {
                        consecutiveSL = 0;
                    }

                    trades.push({
                        time:   times[i],
                        type:   "LONG",
                        entry:  entry.toFixed(2),
                        exit:   exitPrice.toFixed(2),
                        result,
                        pnl:    pnl.toFixed(2),
                        rsi:    rsi.toFixed(1),
                        score
                    });
                }
            }
        }

        // ── Signal SHORT ──────────────────────
        // RSI overbought récent + croisement MACD baissier + bougie rouge
        else if (rsiOverbought && macdBear && volume > 30000 && bearish && score >= 60) {

            if (!blocked) {
                const entry   = closes[i + 1];
                const tpPrice = entry * (1 - TP_PCT);
                const slPrice = entry * (1 + SL_PCT);
                let result    = "PENDING";
                let exitPrice = null;

                for (let j = i + 1; j < Math.min(i + 20, candles.length); j++) {
                    if (lows[j]  <= tpPrice) { result = "WIN";  exitPrice = tpPrice; break; }
                    if (highs[j] >= slPrice) { result = "LOSS"; exitPrice = slPrice; break; }
                }

                if (result !== "PENDING") {
                    const pnl = result === "WIN" ? TP_PCT * 100 : -SL_PCT * 100;
                    if (result === "LOSS") {
                        consecutiveSL++;
                        if (consecutiveSL >= 2) {
                            blocked = true;
                            console.log(`🛑 Bloqué après 2 SL consécutifs à ${times[i]}`);
                        }
                    } else {
                        consecutiveSL = 0;
                    }

                    trades.push({
                        time:   times[i],
                        type:   "SHORT",
                        entry:  entry.toFixed(2),
                        exit:   exitPrice.toFixed(2),
                        result,
                        pnl:    pnl.toFixed(2),
                        rsi:    rsi.toFixed(1),
                        score
                    });
                }
            }
        }
    }

    // ─── Diagnostic ───────────────────────────
    console.log("\n═══════════════════════════════════════");
    console.log("  🔬 DIAGNOSTIC FILTRES");
    console.log("═══════════════════════════════════════");
    console.log(`  RSI min/max observé : ${rsiMin.toFixed(1)} → ${rsiMax.toFixed(1)}`);
    console.log(`  Volume min/max      : ${Math.round(volMin)} → ${Math.round(volMax)}`);
    console.log(`  ❌ Bloqué volume    : ${blockedByVolume} bougies`);
    console.log(`  ❌ Bloqué RSI zone  : ${blockedByRSIzone} bougies`);
    console.log(`  ❌ Bloqué range     : ${blockedByRange} bougies`);
    console.log(`  ❌ Bloqué pump/dump : ${blockedByPumpDump} bougies`);
    console.log(`  ✅ Passé filtres    : ${passedAllFilters} bougies`);

    // ─── Résultats ────────────────────────────
    if (trades.length === 0) {
        console.log("\n⚠️  Toujours aucun trade.");
        console.log("   → Le marché est peut-être trop calme sur cette période.");
        console.log("   → Essaie SYMBOL = 'SOLUSDT' ou 'BTCUSDT'\n");
        return;
    }

    const wins     = trades.filter(t => t.result === "WIN");
    const losses   = trades.filter(t => t.result === "LOSS");
    const totalPnl = trades.reduce((sum, t) => sum + parseFloat(t.pnl), 0);
    const winrate  = ((wins.length / trades.length) * 100).toFixed(1);

    console.log("\n═══════════════════════════════════════");
    console.log(`  📈 RÉSULTATS — ${SYMBOL} ${INTERVAL}`);
    console.log("═══════════════════════════════════════");
    console.log(`  Trades total : ${trades.length}`);
    console.log(`  ✅ Wins      : ${wins.length}`);
    console.log(`  ❌ Losses    : ${losses.length}`);
    console.log(`  📊 Winrate   : ${winrate}%`);
    console.log(`  💰 PnL brut  : ${totalPnl.toFixed(2)}%`);
    console.log(`  💰 PnL 20x   : ${(totalPnl * 20).toFixed(2)}% (levier 20x)`);
    console.log(`  📐 R/R       : 1.3`);
    console.log("───────────────────────────────────────");
    console.log("  Détail des trades :");
    console.log("───────────────────────────────────────");
    trades.forEach(t => {
        const icon = t.result === "WIN" ? "✅" : "❌";
        console.log(`  ${icon} ${t.time} | ${t.type.padEnd(5)} | Entrée: ${t.entry} → ${t.exit} | ${t.pnl}% | RSI: ${t.rsi} | Score: ${t.score}`);
    });
    console.log("═══════════════════════════════════════");

    if      (parseFloat(winrate) >= 55) console.log("\n🟢 Stratégie rentable sur cette période.");
    else if (parseFloat(winrate) >= 45) console.log("\n🟡 Stratégie borderline — surveille.");
    else                                 console.log("\n🔴 Stratégie non rentable sur cette période.");
}

runBacktest().catch(console.error);
