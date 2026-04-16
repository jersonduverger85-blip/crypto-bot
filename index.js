require("dotenv").config();
const axios      = require("axios");
const TelegramBot = require("node-telegram-bot-api");
const fs         = require("fs");
const path       = require("path");

// ─────────────────────────────────────────────
// 🔑 CONFIG
// ─────────────────────────────────────────────
const TOKEN         = process.env.TELEGRAM_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TOKEN || !ADMIN_CHAT_ID) {
    console.error("❌ TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID manquant dans .env");
    process.exit(1);
}

const bot = new TelegramBot(TOKEN, {
    polling: {
        interval:  1000,
        autoStart: true,
        params: { timeout: 10, allowed_updates: ["message", "callback_query"] }
    }
});

// ─────────────────────────────────────────────
// 🌐 TRADUCTIONS — FR / EN
// Chaque clé = { fr: (params) => "...", en: (params) => "..." }
// ─────────────────────────────────────────────
const MSG = {

    botLaunched: {
        fr: (p) =>
`🤖 *Bot Futures lancé — v2.2*

✅ Bougie verte/rouge obligatoire
✅ Délai 10 min entre alertes HOLD/EXIT
✅ Abonnements avec expiration automatique
✅ Multilingue FR/EN actif
✅ RSI fenêtre 5 bougies | Score min: ${p.score}
✅ RSI LONG < ${p.rsiLong} | SHORT > ${p.rsiShort}
✅ Cooldown 30min | TP +2% | SL -1.5%
✅ 12 paires Futures scannées

Commandes: /status /myplan /lang /help`,
        en: (p) =>
`🤖 *Futures Bot launched — v2.2*

✅ Green/red candle required for signals
✅ 10 min delay between HOLD/EXIT alerts
✅ Subscriptions with auto-expiry
✅ Multilingual FR/EN active
✅ RSI window 5 candles | Min score: ${p.score}
✅ RSI LONG < ${p.rsiLong} | SHORT > ${p.rsiShort}
✅ Cooldown 30min | TP +2% | SL -1.5%
✅ 12 Futures pairs scanned

Commands: /status /myplan /lang /help`,
    },

    signalLong: {
        fr: (p) =>
`🚀 *LONG ${p.symbol}* [Futures 20x]
Bougie 1H fermée ✅ | Bougie verte ✅

Prix entrée: \`${p.entry}\`
RSI 1H: ${p.rsi} | Score: ${p.score}%
Tendance 2H: ${p.trend}
MACD: ${p.macd}
Volume: ${p.vol}
MA7: ${p.ma7} | MA25: ${p.ma25} | MA99: ${p.ma99}

🎯 TP: \`${p.tp}\` (+2.0%)
🛑 SL: \`${p.sl}\` (-1.5%)
📐 R/R: 1.3

_Prochaine analyse dans 10 min_`,
        en: (p) =>
`🚀 *LONG ${p.symbol}* [Futures 20x]
1H candle closed ✅ | Green candle ✅

Entry price: \`${p.entry}\`
RSI 1H: ${p.rsi} | Score: ${p.score}%
2H Trend: ${p.trend}
MACD: ${p.macd}
Volume: ${p.vol}
MA7: ${p.ma7} | MA25: ${p.ma25} | MA99: ${p.ma99}

🎯 TP: \`${p.tp}\` (+2.0%)
🛑 SL: \`${p.sl}\` (-1.5%)
📐 R/R: 1.3

_Next analysis in 10 min_`,
    },

    signalShort: {
        fr: (p) =>
`📉 *SHORT ${p.symbol}* [Futures 20x]
Bougie 1H fermée ✅ | Bougie rouge ✅

Prix entrée: \`${p.entry}\`
RSI 1H: ${p.rsi} | Score: ${p.score}%
Tendance 2H: ${p.trend}
MACD: ${p.macd}
Volume: ${p.vol}
MA7: ${p.ma7} | MA25: ${p.ma25} | MA99: ${p.ma99}

🎯 TP: \`${p.tp}\` (-2.0%)
🛑 SL: \`${p.sl}\` (+1.5%)
📐 R/R: 1.3

_Prochaine analyse dans 10 min_`,
        en: (p) =>
`📉 *SHORT ${p.symbol}* [Futures 20x]
1H candle closed ✅ | Red candle ✅

Entry price: \`${p.entry}\`
RSI 1H: ${p.rsi} | Score: ${p.score}%
2H Trend: ${p.trend}
MACD: ${p.macd}
Volume: ${p.vol}
MA7: ${p.ma7} | MA25: ${p.ma25} | MA99: ${p.ma99}

🎯 TP: \`${p.tp}\` (-2.0%)
🛑 SL: \`${p.sl}\` (+1.5%)
📐 R/R: 1.3

_Next analysis in 10 min_`,
    },

    tpHit: {
        fr: (p) =>
`✅ *TP ATTEINT — ${p.type} ${p.symbol}*

Entrée: \`${p.entry}\`
TP: \`${p.tp}\`
💰 PnL: +2.0% | +${p.pnl20x}% (20x)
🎯 Excellent trade !`,
        en: (p) =>
`✅ *TP HIT — ${p.type} ${p.symbol}*

Entry: \`${p.entry}\`
TP: \`${p.tp}\`
💰 PnL: +2.0% | +${p.pnl20x}% (20x)
🎯 Excellent trade!`,
    },

    slHit: {
        fr: (p) =>
`🛑 *SL TOUCHÉ — ${p.type} ${p.symbol}*

Entrée: \`${p.entry}\`
SL: \`${p.sl}\`
💸 PnL: -1.5% | -${p.pnl20x}% (20x)`,
        en: (p) =>
`🛑 *SL HIT — ${p.type} ${p.symbol}*

Entry: \`${p.entry}\`
SL: \`${p.sl}\`
💸 PnL: -1.5% | -${p.pnl20x}% (20x)`,
    },

    blocked: {
        fr: (p) => `🛑 *${p.symbol} bloqué* — 2 SL consécutifs.\nEnvoie /reset ${p.symbol} pour reprendre.`,
        en: (p) => `🛑 *${p.symbol} blocked* — 2 consecutive SL.\nSend /reset ${p.symbol} to resume.`,
    },

    exitRecommended: {
        fr: (p) =>
`⚠️ *SORTIE RECOMMANDÉE — ${p.type} ${p.symbol}*

Prix actuel: \`${p.price}\`
Entrée: \`${p.entry}\`
PnL estimé: ${p.pnl}% | ${p.pnl20x}% (20x)

${p.reason}

👉 *Veux-tu fermer le trade ?*`,
        en: (p) =>
`⚠️ *EXIT RECOMMENDED — ${p.type} ${p.symbol}*

Current price: \`${p.price}\`
Entry: \`${p.entry}\`
Estimated PnL: ${p.pnl}% | ${p.pnl20x}% (20x)

${p.reason}

👉 *Do you want to close the trade?*`,
    },

    exitReasonLong:  { fr: () => "⚠️ MACD se retourne ou RSI > 70", en: () => "⚠️ MACD reversing or RSI > 70" },
    exitReasonShort: { fr: () => "⚠️ MACD se retourne ou RSI < 30", en: () => "⚠️ MACD reversing or RSI < 30" },

    holdTrade: {
        fr: (p) =>
`✅ *TIENS LE ${p.type} ${p.symbol}*

Prix actuel: \`${p.price}\`
Entrée: \`${p.entry}\`
PnL estimé: ${p.pnl}% | ${p.pnl20x}% (20x)

MACD ${p.macdDir} ✅
TP: \`${p.tp}\` | SL: \`${p.sl}\`

👉 *Confirmes-tu tenir le trade ?*`,
        en: (p) =>
`✅ *HOLD THE ${p.type} ${p.symbol}*

Current price: \`${p.price}\`
Entry: \`${p.entry}\`
Estimated PnL: ${p.pnl}% | ${p.pnl20x}% (20x)

MACD ${p.macdDir} ✅
TP: \`${p.tp}\` | SL: \`${p.sl}\`

👉 *Do you confirm holding the trade?*`,
    },

    macdBullDir: { fr: () => "haussier", en: () => "bullish" },
    macdBearDir: { fr: () => "baissier", en: () => "bearish" },

    reduceSL: {
        fr: (p) =>
`🔒 *RÉDUIS TON SL — ${p.type} ${p.symbol}*

Le trade est en profit de +${p.pnl}%
👉 *Déplace ton SL au prix d'entrée:* \`${p.entry}\`
Risque zéro — TP reste: \`${p.tp}\``,
        en: (p) =>
`🔒 *MOVE YOUR SL — ${p.type} ${p.symbol}*

Trade is in profit by +${p.pnl}%
👉 *Move your SL to entry price:* \`${p.entry}\`
Zero risk — TP remains: \`${p.tp}\``,
    },

    holdConfirmed:    { fr: (p) => `✅ *${p.symbol}* — Trade confirmé. Surveillance continue ! 👀`,      en: (p) => `✅ *${p.symbol}* — Trade confirmed. Monitoring continues! 👀`         },
    tradeClosed:      { fr: (p) => `🔒 *${p.symbol}* — Trade fermé. Cooldown 30min.`,                    en: (p) => `🔒 *${p.symbol}* — Trade closed. 30min cooldown.`                    },
    tradeClosedManual:{ fr: (p) => `🔒 *${p.symbol}* — Trade ${p.type} fermé.\nEntrée: \`${p.entry}\`\n👍 Bonne gestion !`, en: (p) => `🔒 *${p.symbol}* — ${p.type} trade closed.\nEntry: \`${p.entry}\`\n👍 Good management!` },
    tradeKept:        { fr: (p) => `⚠️ *${p.symbol}* — Trade conservé. Attention au SL ! 👀`,           en: (p) => `⚠️ *${p.symbol}* — Trade kept. Watch your SL! 👀`                    },

    suddenDown: {
        fr: (p) =>
`🔴 *CHUTE BRUSQUE — ${p.symbol}*

Baisse de *${p.pct}%* en ${p.candles} bougies 1H
Prix actuel: \`${p.price}\`
RSI: ${p.rsi} ${p.rsiNote}

👀 Surveille un signal LONG si RSI < ${p.rsiLong}`,
        en: (p) =>
`🔴 *SUDDEN DROP — ${p.symbol}*

Drop of *${p.pct}%* over ${p.candles} 1H candles
Current price: \`${p.price}\`
RSI: ${p.rsi} ${p.rsiNote}

👀 Watch for LONG signal if RSI < ${p.rsiLong}`,
    },

    suddenUp: {
        fr: (p) =>
`🟢 *HAUSSE BRUSQUE — ${p.symbol}*

Hausse de *+${p.pct}%* en ${p.candles} bougies 1H
Prix actuel: \`${p.price}\`
RSI: ${p.rsi} ${p.rsiNote}

👀 Surveille un signal SHORT si RSI > ${p.rsiShort}`,
        en: (p) =>
`🟢 *SUDDEN SURGE — ${p.symbol}*

Surge of *+${p.pct}%* over ${p.candles} 1H candles
Current price: \`${p.price}\`
RSI: ${p.rsi} ${p.rsiNote}

👀 Watch for SHORT signal if RSI > ${p.rsiShort}`,
    },

    earlyLong: {
        fr: (p) =>
`🟡 *MOUVEMENT BAISSIER EN COURS — ${p.symbol}*

RSI vient de passer sous 35 → *${p.rsi}*
Prix actuel: \`${p.price}\`
MACD: ${p.macd}

⚡ Mouvement de baisse qui s'enclenche
👀 *Surveille LONG si RSI < ${p.rsiLong} + MACD croise*`,
        en: (p) =>
`🟡 *BEARISH MOVE IN PROGRESS — ${p.symbol}*

RSI just dropped below 35 → *${p.rsi}*
Current price: \`${p.price}\`
MACD: ${p.macd}

⚡ Downward move starting
👀 *Watch for LONG if RSI < ${p.rsiLong} + MACD crosses*`,
    },

    earlyShort: {
        fr: (p) =>
`🟡 *MOUVEMENT HAUSSIER EN COURS — ${p.symbol}*

RSI vient de passer au-dessus de 65 → *${p.rsi}*
Prix actuel: \`${p.price}\`
MACD: ${p.macd}

⚡ Mouvement de hausse qui s'enclenche
👀 *Surveille SHORT si RSI > ${p.rsiShort} + MACD croise*`,
        en: (p) =>
`🟡 *BULLISH MOVE IN PROGRESS — ${p.symbol}*

RSI just crossed above 65 → *${p.rsi}*
Current price: \`${p.price}\`
MACD: ${p.macd}

⚡ Upward move starting
👀 *Watch for SHORT if RSI > ${p.rsiShort} + MACD crosses*`,
    },

    opportunity: {
        fr: (p) =>
`⚠️ *OPPORTUNITÉ ${p.symbol}* [Futures 1H]

Score: ${p.score}%
RSI 1H: ${p.rsi}
Tendance 2H: ${p.trend}
Volume: ${p.vol}
MA7: ${p.ma7} | MA25: ${p.ma25} | MA99: ${p.ma99}

👉 Setup en formation — attends bougie 1H fermée`,
        en: (p) =>
`⚠️ *OPPORTUNITY ${p.symbol}* [Futures 1H]

Score: ${p.score}%
RSI 1H: ${p.rsi}
2H Trend: ${p.trend}
Volume: ${p.vol}
MA7: ${p.ma7} | MA25: ${p.ma25} | MA99: ${p.ma99}

👉 Setup forming — wait for 1H candle close`,
    },

    trendBull:         { fr: () => "🟢 Haussière", en: () => "🟢 Bullish"  },
    trendBear:         { fr: () => "🔴 Baissière", en: () => "🔴 Bearish"  },
    trendNeutral:      { fr: () => "⚪ Neutre",    en: () => "⚪ Neutral"   },
    trendBullShort:    { fr: () => "🟢 BULL",      en: () => "🟢 BULL"     },
    trendBearShort:    { fr: () => "🔴 BEAR",      en: () => "🔴 BEAR"     },
    trendNeutralShort: { fr: () => "⚪ NEUTRAL",   en: () => "⚪ NEUTRAL"   },

    resetDone:   { fr: (p) => `✅ *${p.symbol}* débloqué — trading repris.`,   en: (p) => `✅ *${p.symbol}* unblocked — trading resumed.`  },
    resetUnknown:{ fr: (p) => `❌ Symbole *${p.symbol}* inconnu.`,              en: (p) => `❌ Unknown symbol *${p.symbol}*.`               },
    closeDone:   { fr: (p) => `🔒 *${p.symbol}* — Trade ${p.type} fermé manuellement. Cooldown 30min.`, en: (p) => `🔒 *${p.symbol}* — ${p.type} trade manually closed. 30min cooldown.` },
    closeNone:   { fr: (p) => `❌ Aucun trade actif sur *${p.symbol}*.`,        en: (p) => `❌ No active trade on *${p.symbol}*.`           },

    startWelcome: {
        fr: (p) =>
`✅ *Bienvenue ${p.name} !*

Tu es autorisé sur CryptoSignal Bot.
${p.expiry}

Commandes: /status /myplan /lang /help`,
        en: (p) =>
`✅ *Welcome ${p.name}!*

You are authorized on CryptoSignal Bot.
${p.expiry}

Commands: /status /myplan /lang /help`,
    },

    startUnknown: {
        fr: (p) => `👋 Bonjour ${p.name} !\n\nCe bot est privé. Ton ID Telegram est: \`${p.id}\`\n\nContacte l'administrateur pour obtenir l'accès.`,
        en: (p) => `👋 Hello ${p.name}!\n\nThis bot is private. Your Telegram ID is: \`${p.id}\`\n\nContact the administrator to get access.`,
    },

    expiryUnlimited: { fr: () => "Accès illimité 👑",                       en: () => "Unlimited access 👑"                        },
    expiryDate:      { fr: (p) => `Abonnement valide jusqu'au ${p.date}`,   en: (p) => `Subscription valid until ${p.date}`        },

    userAdded: {
        fr: (p) => `${p.renewal ? "🔄 *Abonnement renouvelé*" : "✅ *Nouvel abonné ajouté*"}\n\nUtilisateur: ${p.name}\nID: \`${p.id}\`\nDurée: ${p.days} jours\nExpire le: ${p.date}`,
        en: (p) => `${p.renewal ? "🔄 *Subscription renewed*" : "✅ *New subscriber added*"}\n\nUser: ${p.name}\nID: \`${p.id}\`\nDuration: ${p.days} days\nExpires: ${p.date}`,
    },

    welcomeUser: {
        fr: (p) =>
`🎉 *${p.renewal ? "Abonnement renouvelé" : "Accès accordé"} — CryptoSignal Bot*

Bienvenue ${p.name} !
Ton abonnement est valable *${p.days} jours* jusqu'au ${p.date}.

Tu recevras tous les signaux Futures en temps réel.
Commandes: /status /myplan /lang /help${p.trialMsg}`,
        en: (p) =>
`🎉 *${p.renewal ? "Subscription renewed" : "Access granted"} — CryptoSignal Bot*

Welcome ${p.name}!
Your subscription is valid for *${p.days} days* until ${p.date}.

You will receive all Futures signals in real time.
Commands: /status /myplan /lang /help${p.trialMsg}`,
    },

    trialNote: {
        fr: (p) => `\n\n🎁 *Période d'essai gratuite — ${p.days} jours*\nAprès ta période d'essai, continue pour seulement *10 USDT/mois* et garde accès à tous les signaux 24h/24.`,
        en: (p) => `\n\n🎁 *Free trial — ${p.days} days*\nAfter your trial, continue for only *10 USDT/month* and keep access to all signals 24h/24.`,
    },

    cantNotify:    { fr: (p) => `⚠️ Impossible de notifier \`${p.id}\` — il doit d'abord envoyer /start.`, en: (p) => `⚠️ Unable to notify \`${p.id}\` — they must send /start first.` },
    userRemoved:   { fr: (p) => `✅ *${p.name}* (\`${p.id}\`) retiré — ${p.total} user(s) restant(s).`,   en: (p) => `✅ *${p.name}* (\`${p.id}\`) removed — ${p.total} user(s) remaining.` },
    userNotFound:  { fr: (p) => `⚠️ ID \`${p.id}\` non trouvé.`,                                          en: (p) => `⚠️ ID \`${p.id}\` not found.`                                        },
    cantRemoveSelf:{ fr: () => "❌ Tu ne peux pas te retirer toi-même.",                                    en: () => "❌ You cannot remove yourself."                                        },
    removeAllDone: { fr: (p) => `✅ ${p.count} abonné(s) retiré(s) — Seul toi reste.`,                    en: (p) => `✅ ${p.count} subscriber(s) removed — Only you remain.`               },
    notAdmin:      { fr: () => "❌ Commande réservée à l'administrateur.",                                  en: () => "❌ Admin command only."                                                },

    accessRevoked: {
        fr: () => `🔒 *Accès révoqué — CryptoSignal Bot*\n\nTon accès a été retiré par l'administrateur.\nContacte-le pour plus d'informations.`,
        en: () => `🔒 *Access revoked — CryptoSignal Bot*\n\nYour access has been removed by the administrator.\nContact them for more information.`,
    },

    subscriptionExpired: {
        fr: () =>
`⏰ *Ta période d'essai est terminée — CryptoSignal Bot*

Tu as pu voir la qualité de nos signaux Futures en temps réel.

💎 *Continue pour seulement 10 USDT / 30 jours*

👉 Contacte l'administrateur sur Telegram pour renouveler !
🤖 @Cryptosignaljerson_bot`,
        en: () =>
`⏰ *Your trial period has ended — CryptoSignal Bot*

You've seen the quality of our real-time Futures signals.

💎 *Continue for only 10 USDT / 30 days*

👉 Contact the administrator on Telegram to renew!
🤖 @Cryptosignaljerson_bot`,
    },

    expiredAdminNotif: {
        fr: (p) => `⏰ *Abonnement expiré*\n\nUtilisateur: ${p.name}\nID: \`${p.id}\`\n\nRetiré automatiquement.\nPour renouveler: /adduser ${p.id} 30 ${p.name}`,
        en: (p) => `⏰ *Subscription expired*\n\nUser: ${p.name}\nID: \`${p.id}\`\n\nAutomatically removed.\nTo renew: /adduser ${p.id} 30 ${p.name}`,
    },

    usersList: {
        fr: (p) => `👥 *Abonnés actifs*\n\n${p.list}Total: ${p.total} utilisateur(s)`,
        en: (p) => `👥 *Active subscribers*\n\n${p.list}Total: ${p.total} user(s)`,
    },

    usersItemAdmin:   { fr: () => "♾️ Admin",    en: () => "♾️ Admin"   },
    usersItemActive:  { fr: (p) => `✅ ${p.days}j restants — expire le ${p.date}`, en: (p) => `✅ ${p.days} days left — expires ${p.date}` },
    usersItemExpired: { fr: () => "❌ Expiré",    en: () => "❌ Expired"  },

    myplanAdmin: {
        fr: () => "👑 Tu es administrateur — accès illimité.",
        en: () => "👑 You are the administrator — unlimited access.",
    },
    myplan: {
        fr: (p) => `📋 *Mon abonnement*\n\nStatut: ✅ Actif\nJours restants: *${p.days} jours*\nExpire le: ${p.date}\n\nPour renouveler contacte l'administrateur.`,
        en: (p) => `📋 *My subscription*\n\nStatus: ✅ Active\nDays remaining: *${p.days} days*\nExpires on: ${p.date}\n\nTo renew, contact the administrator.`,
    },

    statusHeader:      { fr: () => "📊 *Statut des paires*\n\n",      en: () => "📊 *Pairs status*\n\n"          },
    statusActiveTrade: { fr: (p) => `🔵 *${p.symbol}* — ${p.type} actif | Entrée: ${p.entry}\n`,  en: (p) => `🔵 *${p.symbol}* — ${p.type} active | Entry: ${p.entry}\n`  },
    statusNoTrade:     { fr: (p) => `${p.icon} *${p.symbol}* — Aucun trade | SL: ${p.sl}/2${p.cd}\n`, en: (p) => `${p.icon} *${p.symbol}* — No trade | SL: ${p.sl}/2${p.cd}\n` },
    cooldownLabel:     { fr: (p) => ` | ⏳ ${p.min}min`, en: (p) => ` | ⏳ ${p.min}min` },

    langChanged: { fr: () => "✅ Langue changée en *Français* 🇫🇷", en: () => "✅ Language changed to *English* 🇬🇧" },
    langUsage:   { fr: () => "❌ Usage: /lang fr  ou  /lang en",    en: () => "❌ Usage: /lang fr  or  /lang en"    },

    help: {
        fr: (p) =>
`🤖 *Commandes disponibles*

/status — état de toutes les paires
/myplan — voir mon abonnement
/lang fr | /lang en — changer la langue
/help — cette aide${p.admin ? `

👑 *Commandes Admin*
/adduser ID 30 Nom — ajouter un abonné
/removeuser ID — retirer un abonné
/removeall — retirer TOUS les abonnés
/users — liste avec jours restants
/reset SYMBOL — débloquer une paire
/close SYMBOL — fermer un trade` : ""}`,
        en: (p) =>
`🤖 *Available commands*

/status — all pairs status
/myplan — view my subscription
/lang fr | /lang en — change language
/help — this help${p.admin ? `

👑 *Admin Commands*
/adduser ID 30 Name — add a subscriber
/removeuser ID — remove a subscriber
/removeall — remove ALL subscribers
/users — list with days remaining
/reset SYMBOL — unblock a pair
/close SYMBOL — close a trade` : ""}`,
    },
};

// ─────────────────────────────────────────────
// 🌐 HELPERS LANGUE
// ─────────────────────────────────────────────
function getLang(chatId) {
    return authorizedUsers[chatId]?.lang || "fr";
}

function getMsg(key, chatId, params = {}) {
    const lang = getLang(chatId);
    const fn   = MSG[key]?.[lang] || MSG[key]?.["fr"];
    return fn ? fn(params) : `[${key}]`;
}

// ─────────────────────────────────────────────
// 👥 GESTION ABONNÉS AVEC EXPIRATION
// ─────────────────────────────────────────────
const USERS_FILE = path.join(__dirname, "users.json");

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
            if (Array.isArray(data)) {
                const converted = {};
                data.forEach(id => { converted[id] = { name: "Abonné", expiry: null, lang: "fr" }; });
                converted[ADMIN_CHAT_ID] = { name: "Admin", expiry: null, lang: "fr" };
                return converted;
            }
            for (const id of Object.keys(data)) {
                if (!data[id].lang) data[id].lang = "fr";
            }
            return data;
        }
    } catch (e) { console.log("⚠️ users.json réinitialisé"); }
    const d = {};
    d[ADMIN_CHAT_ID] = { name: "Admin", expiry: null, lang: "fr" };
    return d;
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(authorizedUsers, null, 2));
}

function isAuthorized(chatId) {
    const u = authorizedUsers[chatId];
    if (!u) return false;
    if (u.expiry === null) return true;
    return Date.now() < u.expiry;
}

let authorizedUsers = loadUsers();
if (!authorizedUsers[ADMIN_CHAT_ID]) {
    authorizedUsers[ADMIN_CHAT_ID] = { name: "Admin", expiry: null, lang: "fr" };
    saveUsers();
}

// Vérification expiration toutes les heures
setInterval(async () => {
    const now = Date.now();
    let changed = false;
    for (const [id, user] of Object.entries(authorizedUsers)) {
        if (user.expiry !== null && now >= user.expiry) {
            console.log(`⏰ Expiré: ${id} (${user.name})`);
            try {
                await bot.sendMessage(id, MSG.subscriptionExpired[user.lang || "fr"](), { parse_mode: "Markdown" });
            } catch (e) {}
            await sendToAdmin(MSG.expiredAdminNotif["fr"]({ name: user.name, id }));
            delete authorizedUsers[id];
            changed = true;
        }
    }
    if (changed) saveUsers();
}, 60 * 60 * 1000);

// ─────────────────────────────────────────────
// 💾 SAUVEGARDE D'ÉTAT
// ─────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, "state.json");

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch (e) { console.log("⚠️ state.json réinitialisé."); }
    return {};
}

function saveState() {
    try {
        const toSave = {};
        symbols.forEach(s => {
            const st = state[s.name];
            toSave[s.name] = {
                lastSignal: st.lastSignal, lastScoreAlert: st.lastScoreAlert,
                consecutiveSL: st.consecutiveSL, blocked: st.blocked,
                lastMoveAlert: st.lastMoveAlert, cooldownUntil: st.cooldownUntil,
                lastEarlyAlert: st.lastEarlyAlert,
                activeTrade: st.activeTrade ? {
                    type: st.activeTrade.type, entry: st.activeTrade.entry,
                    tp: st.activeTrade.tp, sl: st.activeTrade.sl,
                    reducedSL: st.activeTrade.reducedSL, lastAlert: st.activeTrade.lastAlert,
                } : null,
                tradeConfirmStatus: st.activeTrade ? st.tradeConfirmStatus : "NONE",
            };
        });
        fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
    } catch (e) { console.error("❌ saveState:", e.message); }
}

setInterval(saveState, 30000);

// ─────────────────────────────────────────────
// 📩 ENVOI — chaque user dans sa langue
// ─────────────────────────────────────────────
async function sendAll(msgKey, params = {}) {
    for (const [chatId, user] of Object.entries(authorizedUsers)) {
        if (!isAuthorized(chatId)) continue;
        const lang = user.lang || "fr";
        const fn   = MSG[msgKey]?.[lang] || MSG[msgKey]?.["fr"];
        if (!fn) continue;
        try { await bot.sendMessage(chatId, fn(params), { parse_mode: "Markdown" }); }
        catch (e) { console.error(`❌ [${chatId}]:`, e.message); }
    }
}

async function sendToAdmin(msg) {
    try { await bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: "Markdown" }); }
    catch (e) { console.error("❌ admin:", e.message); }
}

async function sendAllWithButtons(msgKey, paramsOrFn, yesData, noData) {
    for (const [chatId, user] of Object.entries(authorizedUsers)) {
        if (!isAuthorized(chatId)) continue;
        const lang   = user.lang || "fr";
        const params = typeof paramsOrFn === "function" ? paramsOrFn(lang) : paramsOrFn;
        const fn     = MSG[msgKey]?.[lang] || MSG[msgKey]?.["fr"];
        if (!fn) continue;
        try {
            await bot.sendMessage(chatId, fn(params), {
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: [[
                    { text: "✅ YES", callback_data: yesData },
                    { text: "❌ NO",  callback_data: noData  }
                ]]}
            });
        } catch (e) { console.error(`❌ buttons [${chatId}]:`, e.message); }
    }
}

// ─────────────────────────────────────────────
// 🔥 PAIRES
// ─────────────────────────────────────────────
const symbols = [
    { name: "ETHUSDT",  minVol: 20000,   sigVol: 25000   },
    { name: "BTCUSDT",  minVol: 500,     sigVol: 600     },
    { name: "SOLUSDT",  minVol: 20000,   sigVol: 25000   },
    { name: "BNBUSDT",  minVol: 2000,    sigVol: 2400    },
    { name: "XRPUSDT",  minVol: 500000,  sigVol: 600000  },
    { name: "DOGEUSDT", minVol: 5000000, sigVol: 6000000 },
    { name: "ADAUSDT",  minVol: 1000000, sigVol: 1200000 },
    { name: "AVAXUSDT", minVol: 20000,   sigVol: 25000   },
    { name: "LINKUSDT", minVol: 30000,   sigVol: 40000   },
    { name: "DOTUSDT",  minVol: 100000,  sigVol: 120000  },
    { name: "AAVEUSDT", minVol: 1000,    sigVol: 1200    },
    { name: "ZECUSDT",  minVol: 10000,   sigVol: 12000   },
];

// ─────────────────────────────────────────────
// ⚡ CONFIG
// ─────────────────────────────────────────────
const MOVE_THRESHOLD = 0.02;
const MOVE_CANDLES   = 2;
const COOLDOWN_MS    = 30 * 60 * 1000;
const RSI_WINDOW     = 5;
const SCORE_MIN      = 50;
const RSI_LONG_MAX   = 32;
const RSI_SHORT_MIN  = 78;
const ALERT_DELAY_MS = 10 * 60 * 1000;

// ─────────────────────────────────────────────
// 📡 API FUTURES
// ─────────────────────────────────────────────
const FUTURES_BASE = "https://fapi.binance.com/fapi/v1";
async function fetchKlines(symbol, interval, limit = 120) {
    const res = await axios.get(`${FUTURES_BASE}/klines`, { params: { symbol, interval, limit } });
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
        if (d >= 0) gains += d; else losses += Math.abs(d);
    }
    const avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
}

function EMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data[0];
    const result = [ema];
    for (let i = 1; i < data.length; i++) { ema = data[i] * k + ema * (1 - k); result.push(ema); }
    return result;
}

function MA(data, period) {
    if (data.length < period) return null;
    return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function MACD(closes) {
    const e12 = EMA(closes, 12), e26 = EMA(closes, 26);
    const macdLine   = e12.map((v, i) => v - e26[i]);
    const signalLine = EMA(macdLine, 9);
    const histogram  = macdLine.map((v, i) => v - signalLine[i]);
    return { macdLine, signalLine, histogram };
}

function rsiWasBelow(closes, threshold, period = 6) {
    for (let o = 1; o <= RSI_WINDOW; o++) {
        if (RSI(closes.slice(0, closes.length - o + 1), period) < threshold) return true;
    }
    return false;
}

function rsiWasAbove(closes, threshold, period = 6) {
    for (let o = 1; o <= RSI_WINDOW; o++) {
        if (RSI(closes.slice(0, closes.length - o + 1), period) > threshold) return true;
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
        const ma7 = MA(closes, 7), ma25 = MA(closes, 25), rsi2h = RSI(closes, 6);
        if (!ma7 || !ma25) return "NEUTRAL";
        if (ma7 > ma25 && rsi2h < 65) return "BULL";
        if (ma7 < ma25 && rsi2h > 35) return "BEAR";
        return "NEUTRAL";
    } catch { return "NEUTRAL"; }
}

function trendLong(trend, lang) {
    if (trend === "BULL") return MSG.trendBull[lang]();
    if (trend === "BEAR") return MSG.trendBear[lang]();
    return MSG.trendNeutral[lang]();
}

function trendShort(trend, lang) {
    if (trend === "BULL") return MSG.trendBullShort[lang]();
    if (trend === "BEAR") return MSG.trendBearShort[lang]();
    return MSG.trendNeutralShort[lang]();
}

// ─────────────────────────────────────────────
// 🗂️ ÉTAT
// ─────────────────────────────────────────────
const savedState = loadState();
const state = {};
symbols.forEach(s => {
    const saved = savedState[s.name] || {};
    state[s.name] = {
        lastSignal: saved.lastSignal || null, lastScoreAlert: saved.lastScoreAlert || false,
        consecutiveSL: saved.consecutiveSL || 0, blocked: saved.blocked || false,
        lastMoveAlert: saved.lastMoveAlert || null, cooldownUntil: saved.cooldownUntil || 0,
        lastEarlyAlert: saved.lastEarlyAlert || null,
        activeTrade: saved.activeTrade || null, tradeConfirmStatus: saved.tradeConfirmStatus || "NONE",
    };
});
console.log("💾 État chargé");

// ─────────────────────────────────────────────
// 🟡 ALERTE PRÉCOCE
// ─────────────────────────────────────────────
async function checkEarlyAlert(symbol, closedCloses, rsi, macdData, lastClose) {
    const s = state[symbol];
    if (s.activeTrade) return;
    const macdCurr = macdData.macdLine.at(-1);
    const rsiPrev  = RSI(closedCloses.slice(0, -1), 6);

    if (rsiPrev > 35 && rsi <= 35 && s.lastEarlyAlert !== "LONG") {
        s.lastEarlyAlert = "LONG"; saveState();
        await sendAll("earlyLong", { symbol, rsi: rsi.toFixed(1), price: lastClose.toFixed(2), macd: macdCurr.toFixed(4), rsiLong: RSI_LONG_MAX });
        return;
    }
    if (rsiPrev < 65 && rsi >= 65 && s.lastEarlyAlert !== "SHORT") {
        s.lastEarlyAlert = "SHORT"; saveState();
        await sendAll("earlyShort", { symbol, rsi: rsi.toFixed(1), price: lastClose.toFixed(2), macd: macdCurr.toFixed(4), rsiShort: RSI_SHORT_MIN });
        return;
    }
    if (rsi > 40 && rsi < 60) s.lastEarlyAlert = null;
}

// ─────────────────────────────────────────────
// ⚡ MOUVEMENT BRUSQUE
// ─────────────────────────────────────────────
async function checkSuddenMove(symbol, closedCloses, rsi) {
    const s = state[symbol];
    if (closedCloses.length < MOVE_CANDLES + 1) return;
    const priceBefore = closedCloses.at(-(MOVE_CANDLES + 1));
    const priceNow    = closedCloses.at(-1);
    const movePct     = (priceNow - priceBefore) / priceBefore;

    if (movePct <= -MOVE_THRESHOLD && s.lastMoveAlert !== "DOWN") {
        s.lastMoveAlert = "DOWN"; saveState();
        await sendAll("suddenDown", { symbol, pct: (movePct * 100).toFixed(2), candles: MOVE_CANDLES, price: priceNow.toFixed(2), rsi: rsi.toFixed(1), rsiNote: rsi < 30 ? "⚠️" : "", rsiLong: RSI_LONG_MAX });
        return;
    }
    if (movePct >= MOVE_THRESHOLD && s.lastMoveAlert !== "UP") {
        s.lastMoveAlert = "UP"; saveState();
        await sendAll("suddenUp", { symbol, pct: (movePct * 100).toFixed(2), candles: MOVE_CANDLES, price: priceNow.toFixed(2), rsi: rsi.toFixed(1), rsiNote: rsi > 80 ? "⚠️" : "", rsiShort: RSI_SHORT_MIN });
        return;
    }
    if (Math.abs(movePct) < MOVE_THRESHOLD * 0.5) s.lastMoveAlert = null;
}

// ─────────────────────────────────────────────
// 🔘 BOUTONS YES / NO
// ─────────────────────────────────────────────
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id.toString();
    if (!isAuthorized(chatId)) return;
    const [action, choice, symbol] = query.data.split("_");
    const s = state[symbol];
    await bot.answerCallbackQuery(query.id);

    if (action === "HOLD" && choice === "YES") { s.tradeConfirmStatus = "USER_CONFIRMED_HOLD"; saveState(); await sendAll("holdConfirmed", { symbol }); }
    if (action === "HOLD" && choice === "NO")  { s.activeTrade = null; s.lastSignal = null; s.tradeConfirmStatus = "CLOSED"; s.cooldownUntil = Date.now() + COOLDOWN_MS; saveState(); await sendAll("tradeClosed", { symbol }); }
    if (action === "EXIT" && choice === "YES") {
        const trade = s.activeTrade;
        if (trade) await sendAll("tradeClosedManual", { symbol, type: trade.type, entry: trade.entry.toFixed(2) });
        s.activeTrade = null; s.lastSignal = null; s.tradeConfirmStatus = "CLOSED"; s.cooldownUntil = Date.now() + COOLDOWN_MS; saveState();
    }
    if (action === "EXIT" && choice === "NO")  { s.tradeConfirmStatus = "USER_CONFIRMED_HOLD"; saveState(); await sendAll("tradeKept", { symbol }); }
});

// ─────────────────────────────────────────────
// 🔄 GESTION TRADE EN COURS
// ─────────────────────────────────────────────
async function manageTrade(symbol, lastClose, rsi, macdData) {
    const s = state[symbol], trade = s.activeTrade;
    if (!trade) return;

    const macdCurr = macdData.macdLine.at(-1), macdPrev = macdData.macdLine.at(-2);
    const sigCurr  = macdData.signalLine.at(-1), sigPrev  = macdData.signalLine.at(-2);
    const macdBull   = macdCurr > sigCurr && macdPrev <= sigPrev;
    const macdBear   = macdCurr < sigCurr && macdPrev >= sigPrev;
    const macdStrong = trade.type === "LONG" ? macdCurr > sigCurr : macdCurr < sigCurr;

    const pnlPct    = trade.type === "LONG" ? ((lastClose - trade.entry) / trade.entry * 100) : ((trade.entry - lastClose) / trade.entry * 100);
    const pnlStr    = (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2);
    const pnl20xStr = (pnlPct * 20).toFixed(1);
    const canAlert  = Date.now() - (trade.lastAlert || 0) >= ALERT_DELAY_MS;

    // ✅ Reset statut toutes les 10min pour répéter les alertes
	if (canAlert && s.tradeConfirmStatus === "WAITING_HOLD") {
	    s.tradeConfirmStatus = "NONE";
	}
	if (canAlert && s.tradeConfirmStatus === "WAITING_EXIT") {
	    s.tradeConfirmStatus = "NONE";
	}	  	

    // TP
    if ((trade.type === "LONG" && lastClose >= trade.tp) || (trade.type === "SHORT" && lastClose <= trade.tp)) {
        await sendAll("tpHit", { type: trade.type, symbol, entry: trade.entry.toFixed(2), tp: trade.tp.toFixed(2), pnl20x: (2.0 * 20).toFixed(1) });
        s.activeTrade = null; s.lastSignal = null; s.tradeConfirmStatus = "NONE"; s.consecutiveSL = 0; s.cooldownUntil = Date.now() + COOLDOWN_MS; saveState(); return;
    }
    // SL
    if ((trade.type === "LONG" && lastClose <= trade.sl) || (trade.type === "SHORT" && lastClose >= trade.sl)) {
        await sendAll("slHit", { type: trade.type, symbol, entry: trade.entry.toFixed(2), sl: trade.sl.toFixed(2), pnl20x: (1.5 * 20).toFixed(1) });
        s.consecutiveSL++;
        if (s.consecutiveSL >= 2) { s.blocked = true; await sendAll("blocked", { symbol }); }
        s.activeTrade = null; s.lastSignal = null; s.tradeConfirmStatus = "NONE"; s.cooldownUntil = Date.now() + COOLDOWN_MS; saveState(); return;
    }

    if (s.tradeConfirmStatus === "CLOSED") return;
    const shouldExit = trade.type === "LONG" ? (macdBear || rsi > 70) : (macdBull || rsi < 30);

    // EXIT
    if (canAlert && shouldExit && s.tradeConfirmStatus !== "WAITING_EXIT") {
        s.tradeConfirmStatus = "WAITING_EXIT"; trade.lastAlert = Date.now(); saveState();
        for (const [chatId, user] of Object.entries(authorizedUsers)) {
            if (!isAuthorized(chatId)) continue;
            const lang   = user.lang || "fr";
            const reason = trade.type === "LONG" ? MSG.exitReasonLong[lang]() : MSG.exitReasonShort[lang]();
            const msg    = MSG.exitRecommended[lang]({ type: trade.type, symbol, price: lastClose.toFixed(2), entry: trade.entry.toFixed(2), pnl: pnlStr, pnl20x: pnl20xStr, reason });
            try { await bot.sendMessage(chatId, msg, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "✅ YES", callback_data: `EXIT_YES_${symbol}` }, { text: "❌ NO", callback_data: `EXIT_NO_${symbol}` }]] } }); } catch (e) {}
        }
        return;
    }

    // REDUCE SL
    if (canAlert && !trade.reducedSL && pnlPct >= 0.8) {
        trade.sl = trade.entry; trade.reducedSL = true; trade.lastAlert = Date.now(); saveState();
        await sendAll("reduceSL", { type: trade.type, symbol, pnl: pnlPct.toFixed(2), entry: trade.entry.toFixed(2), tp: trade.tp.toFixed(2) });
        return;
    }

    // HOLD
    if (canAlert && macdStrong && !shouldExit && s.tradeConfirmStatus !== "WAITING_HOLD" && s.tradeConfirmStatus !== "USER_CONFIRMED_HOLD") {
        s.tradeConfirmStatus = "WAITING_HOLD"; trade.lastAlert = Date.now(); saveState();
        for (const [chatId, user] of Object.entries(authorizedUsers)) {
            if (!isAuthorized(chatId)) continue;
            const lang    = user.lang || "fr";
            const macdDir = trade.type === "LONG" ? MSG.macdBullDir[lang]() : MSG.macdBearDir[lang]();
            const msg     = MSG.holdTrade[lang]({ type: trade.type, symbol, price: lastClose.toFixed(2), entry: trade.entry.toFixed(2), pnl: pnlStr, pnl20x: pnl20xStr, macdDir, tp: trade.tp.toFixed(2), sl: trade.sl.toFixed(2) });
            try { await bot.sendMessage(chatId, msg, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "✅ YES", callback_data: `HOLD_YES_${symbol}` }, { text: "❌ NO", callback_data: `HOLD_NO_${symbol}` }]] } }); } catch (e) {}
        }
    }
}

// ─────────────────────────────────────────────
// 🔍 ANALYSE PRINCIPALE
// ─────────────────────────────────────────────
async function analyze(symbolObj) {
    const { name: symbol, minVol, sigVol } = symbolObj;
    const s = state[symbol];
    if (s.blocked) { console.log(`🛑 ${symbol} bloqué`); return; }
    if (Date.now() < s.cooldownUntil) { console.log(`⏳ ${symbol} — Cooldown`); return; }

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
        const lastClose     = closes.at(-2);
        const lastOpen      = opens.at(-2);
        const lastVolume    = volumes.at(-2);

        const rsi      = RSI(closedCloses, 6);
        const macdData = MACD(closedCloses);
        const macdCurr = macdData.macdLine.at(-1), macdPrev = macdData.macdLine.at(-2);
        const signalCurr = macdData.signalLine.at(-1), signalPrev = macdData.signalLine.at(-2);

        const macdBullCross = macdCurr > signalCurr && macdPrev <= signalPrev;
        const macdBearCross = macdCurr < signalCurr && macdPrev >= signalPrev;
        const macdBullPos   = macdCurr > signalCurr;
        const macdBearPos   = macdCurr < signalCurr;

        const ma7 = MA(closedCloses, 7), ma25 = MA(closedCloses, 25), ma99 = MA(closedCloses, 99);
        const avgVol = MA(closedVolumes, 10);
        const bullishCandle = lastClose > lastOpen;
        const bearishCandle = lastClose < lastOpen;

        await checkSuddenMove(symbol, closedCloses, rsi);
        await checkEarlyAlert(symbol, closedCloses, rsi, macdData, lastClose);

        if (s.activeTrade) { await manageTrade(symbol, lastClose, rsi, macdData); return; }

        const range20High = Math.max(...closedHighs.slice(-20));
        const range20Low  = Math.min(...closedLows.slice(-20));
        const isRange     = (range20High - range20Low) / lastClose < 0.004;
        const move5       = (closedCloses.at(-1) - closedCloses.at(-5)) / closedCloses.at(-5);
        const pumpDump    = Math.abs(move5) > 0.03;

        if (lastVolume < minVol)          { console.log(`⏸ ${symbol} — Volume faible`); return; }
        if (rsi > 36 && rsi < 64)        { console.log(`⏸ ${symbol} — RSI neutre (${rsi.toFixed(1)})`); return; }
        if (isRange)                       { console.log(`⏸ ${symbol} — Range`); return; }
        if (pumpDump)                      { console.log(`⏸ ${symbol} — Pump/dump`); return; }

        const rsiOversold   = rsiWasBelow(closedCloses, RSI_LONG_MAX);
        const rsiOverbought = rsiWasAbove(closedCloses, RSI_SHORT_MIN);
        const trend2H       = await getTrend2H(symbol);

        let score = 0;
        if      (rsi < 25 || rsi > 85) score += 30;
        else if (rsi < 30 || rsi > 80) score += 20;
        else if (rsi < 32 || rsi > 78) score += 10;
        if (macdBullCross || macdBearCross)  score += 30;
        else if (macdBullPos || macdBearPos) score += 15;
        if (lastVolume > avgVol * 1.5) score += 20;
        else if (lastVolume > avgVol)  score += 10;
        if (bullishCandle || bearishCandle) score += 15;
        if (ma7 && ma25 && ma99) {
            if (ma7 > ma25 && ma25 > ma99) score += 10;
            if (ma7 < ma25 && ma25 < ma99) score += 10;
        }
        if ((trend2H === "BULL" && rsiOversold) || (trend2H === "BEAR" && rsiOverbought)) score += 10;

        console.log(`\n🔍 ${symbol} | RSI: ${rsi.toFixed(1)} | Vol: ${Math.round(lastVolume)} | 2H: ${trend2H} | Score: ${score} | MACD: ${macdBullPos ? "BULL" : macdBearPos ? "BEAR" : "NEU"} | ${bullishCandle ? "🟢" : bearishCandle ? "🔴" : "⚪"}`);

        // Opportunité — par user dans sa langue
        if (score >= SCORE_MIN && !s.lastScoreAlert) {
            s.lastScoreAlert = true; saveState();
            for (const [chatId, user] of Object.entries(authorizedUsers)) {
                if (!isAuthorized(chatId)) continue;
                const lang = user.lang || "fr";
                try {
                    await bot.sendMessage(chatId, MSG.opportunity[lang]({
                        symbol, score, rsi: rsi.toFixed(1),
                        trend: trendLong(trend2H, lang),
                        vol: Math.round(lastVolume),
                        ma7: ma7?.toFixed(2), ma25: ma25?.toFixed(2), ma99: ma99?.toFixed(2)
                    }), { parse_mode: "Markdown" });
                } catch (e) {}
            }
        }
        if (score < SCORE_MIN - 10) s.lastScoreAlert = false;

        // ── SIGNAL LONG ──────────────────────
        if (rsiOversold && rsi < 65 && macdBullPos && lastVolume > sigVol && bullishCandle && score >= SCORE_MIN && trend2H !== "BEAR") {
            if (s.lastSignal !== "LONG") {
                s.lastSignal = "LONG"; s.tradeConfirmStatus = "NONE";
                const entry = lastClose, tp = entry * 1.020, sl = entry * 0.985;
                s.activeTrade = { type: "LONG", entry, tp, sl, reducedSL: false, lastAlert: Date.now() };
                saveState();
                for (const [chatId, user] of Object.entries(authorizedUsers)) {
                    if (!isAuthorized(chatId)) continue;
                    const lang = user.lang || "fr";
                    try {
                        await bot.sendMessage(chatId, MSG.signalLong[lang]({
                            symbol, entry: entry.toFixed(2), rsi: rsi.toFixed(1), score,
                            trend: trendShort(trend2H, lang),
                            macd: macdBullCross ? "🔥 CROSSOVER" : "✅",
                            vol: Math.round(lastVolume),
                            ma7: ma7?.toFixed(2), ma25: ma25?.toFixed(2), ma99: ma99?.toFixed(2),
                            tp: tp.toFixed(2), sl: sl.toFixed(2)
                        }), { parse_mode: "Markdown" });
                    } catch (e) {}
                }
            }
        }
        // ── SIGNAL SHORT ─────────────────────
        else if (rsiOverbought && rsi > 35 && macdBearPos && lastVolume > sigVol && bearishCandle && score >= SCORE_MIN && trend2H !== "BULL") {
            if (s.lastSignal !== "SHORT") {
                s.lastSignal = "SHORT"; s.tradeConfirmStatus = "NONE";
                const entry = lastClose, tp = entry * 0.980, sl = entry * 1.015;
                s.activeTrade = { type: "SHORT", entry, tp, sl, reducedSL: false, lastAlert: Date.now() };
                saveState();
                for (const [chatId, user] of Object.entries(authorizedUsers)) {
                    if (!isAuthorized(chatId)) continue;
                    const lang = user.lang || "fr";
                    try {
                        await bot.sendMessage(chatId, MSG.signalShort[lang]({
                            symbol, entry: entry.toFixed(2), rsi: rsi.toFixed(1), score,
                            trend: trendShort(trend2H, lang),
                            macd: macdBearCross ? "🔥 CROSSOVER" : "✅",
                            vol: Math.round(lastVolume),
                            ma7: ma7?.toFixed(2), ma25: ma25?.toFixed(2), ma99: ma99?.toFixed(2),
                            tp: tp.toFixed(2), sl: sl.toFixed(2)
                        }), { parse_mode: "Markdown" });
                    } catch (e) {}
                }
            }
        } else {
            s.lastSignal = null;
        }

    } catch (e) { console.error(`❌ ${symbol}:`, e.message); }
}

// ─────────────────────────────────────────────
// 🔁 SCAN
// ─────────────────────────────────────────────
function scan() { symbols.forEach(analyze); }

// ─────────────────────────────────────────────
// 📣 COMMANDES TELEGRAM
// ─────────────────────────────────────────────
function isAdmin(msg) { return msg.chat.id.toString() === ADMIN_CHAT_ID; }

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id.toString();
    const name   = msg.from.first_name || "Trader";
    console.log(`🆕 /start — ID: ${chatId} | ${name}`);

    if (isAuthorized(chatId)) {
        const user = authorizedUsers[chatId], lang = user.lang || "fr";
        const expiryStr = user.expiry ? MSG.expiryDate[lang]({ date: new Date(user.expiry).toLocaleDateString("fr-FR") }) : MSG.expiryUnlimited[lang]();
        await bot.sendMessage(chatId, MSG.startWelcome[lang]({ name, expiry: expiryStr }), { parse_mode: "Markdown" });
        return;
    }
    await bot.sendMessage(chatId, MSG.startUnknown["fr"]({ name, id: chatId }), { parse_mode: "Markdown" });
    await sendToAdmin(`🆕 *Nouvelle demande*\n\nNom: ${name}\nID: \`${chatId}\`\n\nEssai 3j: /adduser ${chatId} 3 ${name}\n30j: /adduser ${chatId} 30 ${name}`);
});

bot.onText(/\/lang (.+)/, async (msg, match) => {
    const chatId  = msg.chat.id.toString();
    if (!isAuthorized(chatId)) return;
    const newLang = match[1].trim().toLowerCase();
    if (newLang !== "fr" && newLang !== "en") {
        await bot.sendMessage(chatId, MSG.langUsage[getLang(chatId)](), { parse_mode: "Markdown" }); return;
    }
    authorizedUsers[chatId].lang = newLang; saveUsers();
    await bot.sendMessage(chatId, MSG.langChanged[newLang](), { parse_mode: "Markdown" });
});

bot.onText(/\/adduser (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) { await bot.sendMessage(msg.chat.id, MSG.notAdmin["fr"]()); return; }
    const parts = match[1].trim().split(" ");
    const newId = parts[0], days = parseInt(parts[1]) || 30, name = parts.slice(2).join(" ") || "Abonné";
    const expiry = Date.now() + days * 24 * 60 * 60 * 1000;
    const expiryDate = new Date(expiry).toLocaleDateString("fr-FR");
    const isRenewal  = !!authorizedUsers[newId];
    const prevLang   = authorizedUsers[newId]?.lang || "fr";
    authorizedUsers[newId] = { name, expiry: newId === ADMIN_CHAT_ID ? null : expiry, lang: prevLang };
    saveUsers();
    await sendToAdmin(MSG.userAdded["fr"]({ renewal: isRenewal, name, id: newId, days, date: expiryDate }));
    const trialMsg = days <= 3 ? MSG.trialNote[prevLang]({ days }) : "";
    try { await bot.sendMessage(newId, MSG.welcomeUser[prevLang]({ renewal: isRenewal, name, days, date: expiryDate, trialMsg }), { parse_mode: "Markdown" }); }
    catch (e) { await sendToAdmin(MSG.cantNotify["fr"]({ id: newId })); }
});

bot.onText(/\/removeuser (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) { await bot.sendMessage(msg.chat.id, MSG.notAdmin["fr"]()); return; }
    const id = match[1].trim();
    if (id === ADMIN_CHAT_ID) { await sendToAdmin(MSG.cantRemoveSelf["fr"]()); return; }
    if (authorizedUsers[id]) {
        const uName = authorizedUsers[id].name, uLang = authorizedUsers[id].lang || "fr";
        delete authorizedUsers[id]; saveUsers();
        await sendToAdmin(MSG.userRemoved["fr"]({ name: uName, id, total: Object.keys(authorizedUsers).length }));
        try { await bot.sendMessage(id, MSG.accessRevoked[uLang](), { parse_mode: "Markdown" }); } catch (e) {}
    } else { await sendToAdmin(MSG.userNotFound["fr"]({ id })); }
});

bot.onText(/\/removeall/, async (msg) => {
    if (!isAdmin(msg)) return;
    let count = 0;
    for (const id of Object.keys(authorizedUsers)) {
        if (id !== ADMIN_CHAT_ID) {
            const uLang = authorizedUsers[id].lang || "fr";
            try { await bot.sendMessage(id, MSG.accessRevoked[uLang](), { parse_mode: "Markdown" }); } catch (e) {}
            delete authorizedUsers[id]; count++;
        }
    }
    saveUsers(); await sendToAdmin(MSG.removeAllDone["fr"]({ count }));
});

bot.onText(/\/users/, async (msg) => {
    if (!isAdmin(msg)) return;
    const now = Date.now(); let list = "";
    for (const [id, user] of Object.entries(authorizedUsers)) {
        const remaining = user.expiry ? Math.ceil((user.expiry - now) / 86400000) : null;
        const date      = user.expiry ? new Date(user.expiry).toLocaleDateString("fr-FR") : null;
        const status    = user.expiry === null ? MSG.usersItemAdmin["fr"]() : remaining > 0 ? MSG.usersItemActive["fr"]({ days: remaining, date }) : MSG.usersItemExpired["fr"]();
        list += `• *${user.name}* — \`${id}\` [${user.lang || "fr"}]\n  ${status}\n\n`;
    }
    await sendToAdmin(MSG.usersList["fr"]({ list, total: Object.keys(authorizedUsers).length }));
});

bot.onText(/\/myplan/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAuthorized(chatId)) return;
    const user = authorizedUsers[chatId], lang = user.lang || "fr";
    if (!user.expiry) { await bot.sendMessage(chatId, MSG.myplanAdmin[lang](), { parse_mode: "Markdown" }); return; }
    const remaining = Math.ceil((user.expiry - Date.now()) / 86400000);
    const date      = new Date(user.expiry).toLocaleDateString("fr-FR");
    await bot.sendMessage(chatId, MSG.myplan[lang]({ days: remaining, date }), { parse_mode: "Markdown" });
});

bot.onText(/\/reset (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const sym = match[1].toUpperCase().trim();
    if (state[sym]) {
        Object.assign(state[sym], { blocked: false, consecutiveSL: 0, lastSignal: null, activeTrade: null, tradeConfirmStatus: "NONE", lastMoveAlert: null, lastEarlyAlert: null, cooldownUntil: 0 });
        saveState(); await sendAll("resetDone", { symbol: sym });
    } else { await sendToAdmin(MSG.resetUnknown["fr"]({ symbol: sym })); }
});

bot.onText(/\/close (.+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const sym = match[1].toUpperCase().trim();
    if (state[sym]?.activeTrade) {
        const trade = state[sym].activeTrade;
        Object.assign(state[sym], { activeTrade: null, lastSignal: null, tradeConfirmStatus: "CLOSED", cooldownUntil: Date.now() + COOLDOWN_MS });
        saveState(); await sendAll("closeDone", { symbol: sym, type: trade.type });
    } else { await sendToAdmin(MSG.closeNone["fr"]({ symbol: sym })); }
});

bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAuthorized(chatId)) return;
    const lang = getLang(chatId);
    let txt = MSG.statusHeader[lang]();
    symbols.forEach(s => {
        const st = state[s.name], trade = st.activeTrade, inCD = Date.now() < st.cooldownUntil;
        const cd = inCD ? MSG.cooldownLabel[lang]({ min: Math.round((st.cooldownUntil - Date.now()) / 60000) }) : "";
        if (trade) txt += MSG.statusActiveTrade[lang]({ symbol: s.name, type: trade.type, entry: trade.entry.toFixed(2) });
        else txt += MSG.statusNoTrade[lang]({ icon: st.blocked ? "🛑" : inCD ? "⏳" : "✅", symbol: s.name, sl: st.consecutiveSL, cd });
    });
    await bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id.toString();
    if (!isAuthorized(chatId)) return;
    await bot.sendMessage(chatId, MSG.help[getLang(chatId)]({ admin: isAdmin(msg) }), { parse_mode: "Markdown" });
});

// ─────────────────────────────────────────────
// 🚀 DÉMARRAGE
// ─────────────────────────────────────────────
console.log("🤖 Bot v2.2 — Multilingue FR/EN");
sendAll("botLaunched", { score: SCORE_MIN, rsiLong: RSI_LONG_MAX, rsiShort: RSI_SHORT_MIN });
scan();
setInterval(scan, 15000);

async function shutdown() { console.log("🛑 Arrêt..."); saveState(); setTimeout(() => process.exit(0), 500); }
process.on("SIGINT",  shutdown);
process.on("SIGTERM", shutdown);
