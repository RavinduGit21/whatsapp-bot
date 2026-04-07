const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const pino = require('pino');

// --- STABLE DATABASE SETUP (Binary-Free 🛡️) ---
const ordersFile = 'orders.json';
if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, JSON.stringify([], null, 2));

function getOrders() {
  return JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
}

function saveOrders(orders) {
  fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
}

// --- EXPRESS DASHBOARD SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/orders', (req, res) => {
  const orders = getOrders();
  orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  res.json(orders);
});

app.post('/api/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const orders = getOrders();
  const orderIndex = orders.findIndex(o => o.id == id);
  if (orderIndex > -1) {
    orders[orderIndex].status = status;
    saveOrders(orders);
    io.emit('order_status_updated', { id, status });
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/settings', (req, res) => res.json(botSettings));
app.post('/api/settings', (req, res) => {
  fs.writeFileSync('settings.json', JSON.stringify(req.body, null, 2));
  reloadSettings();
  res.json({ success: true });
});

app.get('/api/menu', (req, res) => res.json(menuData));
app.post('/api/menu', (req, res) => {
  fs.writeFileSync('menu.json', JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

// --- BOT DATA ---
const menuData = JSON.parse(fs.readFileSync('menu.json', 'utf8'));
let botSettings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
const reloadSettings = () => {
  botSettings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
};
const customerStates = new Map();

// --- BAILEYS BOT (No Chrome! 🛡️) ---
let sock;

async function replyWithTyping(jid, text, imagePath = null) {
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await new Promise(r => setTimeout(r, 2000));
    await sock.sendPresenceUpdate('paused', jid);
    if (imagePath && fs.existsSync(imagePath)) {
      await sock.sendMessage(jid, { image: fs.readFileSync(imagePath), caption: text });
    } else {
      await sock.sendMessage(jid, { text });
    }
  } catch (err) {
    console.error('[REPLY ERROR]', err.message);
  }
}

async function sendMainMenu(jid, lang) {
  await replyWithTyping(jid, botSettings.mainMenu[lang]);
}

async function sendPackages(jid, lang) {
  await replyWithTyping(jid, botSettings.packagePrompt[lang]);
  const imgPath = path.join(__dirname, 'menu.png');
  if (fs.existsSync(imgPath)) {
    await sock.sendMessage(jid, {
      image: fs.readFileSync(imgPath),
      caption: lang === 'en' ? 'Comparison chart of our services.' : 'අප ලබාදෙන සේවාවන්හි සාරාංශය.'
    });
  }
}

async function handleRequirements(jid, state, messageBody, senderName) {
  if (state.step === 'start' || messageBody === '3') {
    state.step = 'ask_type';
    const q = state.lang === 'en'
      ? 'What kind of website do you need?\n(E.g., Blog, Business Profile, E-commerce, Portfolio)'
      : 'ඔබට අවශ්‍ය කුමන ආකාරයේ වෙබ් අඩවියක්ද?\n(උදා: බිස්නස්, ඔන්ලයින් ශොප්, පෞද්ගලික)';
    await replyWithTyping(jid, q);
  } else if (state.step === 'ask_type') {
    state.temp_data = { type: messageBody };
    state.step = 'ask_name';
    const q = state.lang === 'en'
      ? 'Great! What is your Business or Project name?'
      : 'නියමයි! අදාළ ව්‍යාපාරයේ හෝ ව්‍යාපෘතියේ නම කුමක්ද?';
    await replyWithTyping(jid, q);
  } else if (state.step === 'ask_name') {
    state.temp_data.name = messageBody;
    state.step = 'ask_budget';
    const q = state.lang === 'en'
      ? 'What is your estimated budget? (Optional or type a range)'
      : 'ඔබ හිතාගෙන ඉන්නා මිල පරාසය කුමක්ද?';
    await replyWithTyping(jid, q);
  } else if (state.step === 'ask_budget') {
    state.temp_data.budget = messageBody;
    state.step = 'final';
    const desc = `Web Lead: ${state.temp_data.type} for ${state.temp_data.name}. Budget: ${state.temp_data.budget}`;
    const orders = getOrders();
    const newId = Date.now();
    const newOrder = {
      id: newId,
      customer_name: senderName,
      customer_number: jid,
      items: desc,
      total: 0,
      status: 'New Lead',
      timestamp: new Date().toISOString()
    };
    orders.push(newOrder);
    saveOrders(orders);
    const success = state.lang === 'en'
      ? `✅ *Inquiry Submitted!* (Lead #${newId})\n\nThank you, ${senderName}. I'll review your requirements and reach out very soon.\nPortfolio: ravindushehara.me`
      : `✅ *විමසීම සාර්ථකව යොමු කළා!* (Lead #${newId})\n\nස්තූතියි, ${senderName}. මම ඔබේ අවශ්‍යතා පරීක්ෂා කර ඉතා ඉක්මනින් ඔබ හා සම්බන්ධ වන්නෙමි.\nravindushehara.me`;
    await replyWithTyping(jid, success);
    io.emit('new_order', newOrder);
    state.step = 'start';
  }
  customerStates.set(jid, state);
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }), // Silent logs (no spam!)
    auth: state,
    printQRInTerminal: false,
    browser: ['Ravindu Agency Bot', 'Chrome', '1.0.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000, // Keep connection alive!
    retryRequestDelayMs: 2000,
  });

  sock.ev.on('creds.update', saveCreds);

  // --- CONNECTION HANDLER ---
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📢 --- NEW QR CODE! SCAN WITH WHATSAPP ---');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect?.error?.output?.statusCode
        : 0;

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`⚠️ Disconnected (${statusCode}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        console.log('🔄 Auto-reconnecting in 3 seconds...');
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log('❌ Logged out! Delete "auth_info_baileys" folder and restart.');
      }
    } else if (connection === 'open') {
      console.log('🚀 --- AGENT RAVINDU BOT IS ONLINE & READY! (Baileys Mode 🛡️) ---');
    }
  });

  // --- CALL HANDLER (Auto-reject) ---
  sock.ev.on('call', async (calls) => {
    for (const call of calls) {
      if (call.status === 'offer') {
        console.log(`📞 REJECTED CALL FROM ${call.from}`);
        await sock.rejectCall(call.id, call.from);
        const callReply = `⚠️ *Automatic System Message* ⚠️\n\n*EN:* I am an AI Assistant and cannot answer voice calls. Please use the menu below to chat with me.\n\n*SI:* මම AI සහායකයෙක් බැවින් ඇමතුම් වලට පිළිතුරු දිය නොහැක. කරුණාකර පහත මෙනුව භාවිතා කර මා සමග චැට් කරන්න.\n\n*Type \'0\' to see the Main Menu.*`;
        await sock.sendMessage(call.from, { text: callReply });
      }
    }
  });

  // --- MESSAGE HANDLER ---
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    try {
      if (type !== 'notify') return;
      const msg = messages[0];
      if (!msg?.message) return;
      if (msg.key.fromMe) return;

      const jid = msg.key.remoteJid;
      if (!jid) return;
      if (jid.endsWith('@g.us')) return;          // Ignore groups
      if (jid.includes('newsletter')) return;     // Ignore newsletters
      if (jid === 'status@broadcast') return;     // Ignore status

      const messageBody = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text || ''
      ).toLowerCase().trim();

      const senderName = msg.pushName || 'Client';
      console.log(`[${new Date().toLocaleTimeString()}] 📩 FROM ${jid}: "${messageBody}"`);

      let state = customerStates.get(jid) || { lang: null, step: 'start' };

      // --- LANGUAGE SELECTION ---
      if (!state.lang) {
        if (messageBody === '1' || messageBody.includes('en')) {
          state.lang = 'en';
          customerStates.set(jid, state);
          await sendMainMenu(jid, 'en');
        } else if (messageBody === '2' || messageBody.includes('si')) {
          state.lang = 'si';
          customerStates.set(jid, state);
          await sendMainMenu(jid, 'si');
        } else {
          await replyWithTyping(jid, botSettings.langOffer);
        }
        return;
      }

      // --- MENU COMMANDS ---
      if (messageBody === '0' || messageBody === 'menu' || messageBody === 'home') {
        await sendMainMenu(jid, state.lang);
        return;
      }
      if (messageBody === '1') {
        await sendPackages(jid, state.lang);
        return;
      }
      if (messageBody === '2') {
        const text = botSettings.portfolio[state.lang];
        const imageKey = botSettings.portfolioImage;
        const imgPath = imageKey ? path.join(__dirname, imageKey) : null;
        await replyWithTyping(jid, text, imgPath);
        return;
      }
      if (messageBody === '3' || state.step.startsWith('ask_')) {
        await handleRequirements(jid, state, messageBody, senderName);
        return;
      }
      if (messageBody === '4') {
        await replyWithTyping(jid, botSettings.contact[state.lang]);
        return;
      }
      if (messageBody === 'reset') {
        customerStates.delete(jid);
        await replyWithTyping(jid, state.lang === 'en' ? 'Session reset.' : 'සැසිය නැවත ආරම්භ කළා.');
        return;
      }

      // --- DEFAULT: Show menu ---
      await sendMainMenu(jid, state.lang);

    } catch (err) {
      console.error('[CRASH GUARD] Message handler error:', err.message);
    }
  });
}

// --- START SERVER & BOT ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`📊 Express Dashboard: http://localhost:${PORT}`);
  connectToWhatsApp();
});
