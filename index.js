const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// --- DATABASE SETUP ---
const db = new Database('orders.db');
db.prepare(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT,
    customer_number TEXT,
    items TEXT,
    total DECIMAL(10, 2),
    status TEXT DEFAULT 'New Lead',
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// --- EXPRESS SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY timestamp DESC').all();
  res.json(orders);
});

app.post('/api/orders/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
  res.json({ success: true });
  io.emit('order_status_updated', { id, status });
});

// --- NEW SETTINGS APIs ---

// 1. Get current bot messages
app.get('/api/settings', (req, res) => {
  res.json(botSettings);
});

// 2. Update bot messages
app.post('/api/settings', (req, res) => {
  fs.writeFileSync('settings.json', JSON.stringify(req.body, null, 2));
  reloadSettings();
  res.json({ success: true });
});

// 3. Get Package Menu
app.get('/api/menu', (req, res) => {
  res.json(menuData);
});

// 4. Update Package Menu
app.post('/api/menu', (req, res) => {
  fs.writeFileSync('menu.json', JSON.stringify(req.body, null, 2));
  // We can reload menuData globally if needed, or stick to this session
  res.json({ success: true });
});

// --- WHATSAPP BOT SETUP ---
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    protocolTimeout: 60000, // Wait longer for AWS
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--no-first-run',
      '--disable-extensions',
      '--disable-notifications'
    ]
  },
  // Using the latest remote version known to work on AWS
  webVersionRemote: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1012170010-alpha.html'
});

const menuData = JSON.parse(fs.readFileSync('menu.json', 'utf8'));
let botSettings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));

// Function to reload settings (Called after web update)
const reloadSettings = () => {
  botSettings = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
};

const customerStates = new Map();

client.on('qr', (qr) => {
  console.log('📢 --- NEW QR CODE GENERATED! SCAN NOW ---');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('✅ AUTHENTICATED SUCCESSFULLY!'));

client.on('auth_failure', (msg) => {
  console.error('❌ AUTHENTICATION FAILURE:', msg);
});

client.on('ready', () => {
  console.log('🚀 --- AGENT RAVINDU BOT IS ONLINE & READY! ---');
});

// --- BOT LOGIC ---
client.on('message', async (msg) => {
  console.log(`[${new Date().toLocaleTimeString()}] 📩 NEW MESSAGE FROM ${msg.from}: "${msg.body}"`);
  
  const chat = await msg.getChat();

  // 🔥 CORE SAFETY GUARDS:
  // 1. Ignore messages from the bot itself
  if (msg.fromMe) return;

  // 2. Ignore Status Updates (Stories) and Broadcasts
  if (msg.isStatus || msg.from === 'status@broadcast') return;

  // 3. Only respond in private chats, ignore all groups!
  if (chat.isGroup) {
    console.log(`[${new Date().toLocaleTimeString()}] ⏭️ Ignoring group ${chat.name}`);
    return; 
  }

  const contact = await msg.getContact();
  const senderId = msg.from;
  const messageBody = (msg.body || "").toLowerCase().trim();

  let state = customerStates.get(senderId) || { lang: null, step: 'start' };

  // Language Selection
  if (!state.lang) {
    if (messageBody === '1' || messageBody.includes('en')) {
      state.lang = 'en';
      customerStates.set(senderId, state);
      await sendMainMenu(msg, 'en');
      return;
    } else if (messageBody === '2' || messageBody.includes('si')) {
      state.lang = 'si';
      customerStates.set(senderId, state);
      await sendMainMenu(msg, 'si');
      return;
    } else {
      const langOffer = botSettings.langOffer;
      await replyWithTyping(msg, langOffer);
      return;
    }
  }

  // Handle Commands
  if (messageBody === '0' || messageBody === 'menu' || messageBody === 'home') {
    await sendMainMenu(msg, state.lang);
    return;
  }

  // Option 1: View Packages
  if (messageBody === '1') {
    await sendPackages(msg, state.lang);
    return;
  }

  // Option 2: Portfolio
  if (messageBody === '2') {
    const text = botSettings.portfolio[state.lang];
    const imgPath = path.join(__dirname, botSettings.portfolioImage);
    
    if (fs.existsSync(imgPath)) {
      const media = MessageMedia.fromFilePath(imgPath);
      await replyWithTyping(msg, text, media);
    } else {
      await replyWithTyping(msg, text);
    }
    return;
  }

  // Option 3: Get a Quote / Start Requirements
  if (messageBody === '3' || state.step.startsWith('ask_')) {
    await handleRequirements(msg, state);
    return;
  }

  // Option 4: Contact
  if (messageBody === '4') {
    const text = botSettings.contact[state.lang];
    await replyWithTyping(msg, text);
    return;
  }

  // Option Reset
  if (messageBody === 'reset') {
    customerStates.delete(senderId);
    await replyWithTyping(msg, state.lang === 'en' ? "Session reset." : "සැසිය නැවත ආරම්භ කළා.");
    return;
  }

  // Default Fallback
  await sendMainMenu(msg, state.lang);
});

async function replyWithTyping(msg, text, media = null) {
  const chat = await msg.getChat();
  await chat.sendStateTyping();
  // Simulate reading/thinking time (2-3 seconds)
  await new Promise(r => setTimeout(r, 2000));
  
  if (media) {
    return await client.sendMessage(msg.from, media, { caption: text });
  }
  return await msg.reply(text);
}

async function sendMainMenu(msg, lang) {
  const text = botSettings.mainMenu[lang];
  await replyWithTyping(msg, text);
}

async function sendPackages(msg, lang) {
  let text = lang === 'en' ? `🏢 *Our Web Packages* 🏢\n\n` : `🏢 *පැකේජ සහ මිල ගණන්* 🏢\n\n`;
  menuData.forEach(p => {
    text += `🔹 *${p.name}* - LKR ${p.price > 0 ? p.price.toLocaleString() + '+' : 'Consult'}\n   _${p.description}_\n\n`;
  });
  const packagePrompt = botSettings.packagePrompt[lang];
  await replyWithTyping(msg, packagePrompt);

  const imgPath = path.join(__dirname, 'menu.png');
  if (fs.existsSync(imgPath)) {
    const media = MessageMedia.fromFilePath(imgPath);
    await client.sendMessage(msg.from, media, { caption: lang === 'en' ? "Comparison chart of our services." : "අප ලබාදෙන සේවාවන්හි සාරාංශය." });
  }
}

async function handleRequirements(msg, state) {
  const senderId = msg.from;
  const messageBody = msg.body;

  if (state.step === 'start' || msg.body === '3') {
    state.step = 'ask_type';
    const q = state.lang === 'en' ? "What kind of website do you need?\n(E.g., Blog, Business Profile, E-commerce, Portolio)" : "ඔබට අවශ්‍ය කුමන ආකාරයේ වෙබ් අඩවියක්ද? \n(උදා: බිස්නස්, ඔන්ලයින් ශොප්, පෞද්ගලික)";
    await replyWithTyping(msg, q);
  } 
  else if (state.step === 'ask_type') {
    state.temp_data = { type: messageBody };
    state.step = 'ask_name';
    const q = state.lang === 'en' ? "Great! What is your Business or Project name?" : "නියමයි! අදාළ ව්‍යාපාරයේ හෝ ව්‍යාපෘතියේ නම කුමක්ද?";
    await replyWithTyping(msg, q);
  }
  else if (state.step === 'ask_name') {
    state.temp_data.name = messageBody;
    state.step = 'ask_budget';
    const q = state.lang === 'en' ? "What is your estimated budget? (Optional or type a range)" : "ඔබ හිතාගෙන ඉන්නා මිල පරාසය කුමක්ද?";
    await replyWithTyping(msg, q);
  }
  else if (state.step === 'ask_budget') {
    state.temp_data.budget = messageBody;
    state.step = 'final';
    
    const contact = await msg.getContact();
    const customer_name = contact.pushname || 'Client';
    const desc = `Web Lead: ${state.temp_data.type} for ${state.temp_data.name}. Budget: ${state.temp_data.budget}`;
    
    // Save as Inquiry in DB
    const stmt = db.prepare('INSERT INTO orders (customer_name, customer_number, items, total) VALUES (?, ?, ?, 0)');
    const info = stmt.run(customer_name, senderId, desc);

    const success = state.lang === 'en' 
      ? `✅ *Inquiry Submitted!* (Lead #${info.lastInsertRowid})\n\nThank you, ${customer_name}. I'll review your requirements and reach out very soon.\nPortfolio: ravindushehara.me`
      : `✅ *විමසීම සාර්ථකව යොමු කළා!* (Lead #${info.lastInsertRowid})\n\nස්තූතියි, ${customer_name}. මම ඔබේ අවශ්‍යතා පරීක්ෂා කර ඉතා ඉක්මනින් ඔබ හා සම්බන්ධ වන්නෙමි.\nravindushehara.me`;
    
    await replyWithTyping(msg, success);
    io.emit('new_order', { id: info.lastInsertRowid, customer_name, customer_number: senderId, items: desc, total: 0, status: 'New Lead', timestamp: new Date().toISOString() });
    state.step = 'start'; // back to main
  }
  customerStates.set(senderId, state);
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Express Dashboard: http://localhost:${PORT}`);
  client.initialize();
});
