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

// --- WHATSAPP BOT SETUP ---
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-extensions', '--disable-gpu', '--no-first-run', '--no-zygote'
    ]
  },
  webVersionRemote: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1012170010-alpha.html'
});

const menuData = JSON.parse(fs.readFileSync('menu.json', 'utf8'));
const customerStates = new Map();

client.on('qr', (qr) => {
  console.log('--- SCAN THE QR CODE ---');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => console.log('✅ Authenticated!'));
client.on('ready', () => console.log('🚀 Agent Ravindu Bot is ready!'));

// --- BOT LOGIC ---
client.on('message', async (msg) => {
  const chat = await msg.getChat();

  // 🔥 IMPORTANT: Only respond in private chats, ignore all groups!
  if (chat.isGroup) {
    return; 
  }

  const contact = await msg.getContact();
  const senderId = msg.from;
  const messageBody = msg.body.toLowerCase().trim();

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
      const langOffer = `👋 *Welcome! I'm the Virtual Assistant for Ravindu Shehara (ravindushehara.me)*\n\nPlease select your preferred language:\n\n1. English\n2. Sinhala (සිංහල)`;
      await msg.reply(langOffer);
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
    const text = state.lang === 'en' 
      ? `💻 *Portfolio & Projects*:\nVisit my official portfolio: https://ravindushehara.me\n\nYou can see my latest works and skills there!`
      : `💻 *කළ නිර්මාණ*: \nඅපගේ නිල වෙබ් අඩවියට පිවිසෙන්න: https://ravindushehara.me\n\nඔබට මෙහිදී අප කළ නිර්මාණ දැකගත හැකිය.`;
    await msg.reply(text);
    return;
  }

  // Option 3: Get a Quote / Start Requirements
  if (messageBody === '3' || state.step.startsWith('ask_')) {
    await handleRequirements(msg, state);
    return;
  }

  // Option 4: Contact
  if (messageBody === '4') {
    const text = state.lang === 'en'
      ? `📞 *Contact Info*:\nEmail: hi@ravindushehara.me\nWeb: ravindushehara.me\nOr feel free to leave a message here, I'll get back to you personally!`
      : `📞 *සම්බන්ධ කර ගැනීමට*:\nEmail: hi@ravindushehara.me\nWeb: ravindushehara.me\nකරුණාකර මෙහි පණිවිඩයක් තබන්න, මම ඉතා ඉක්මනින් ඔබ හා සම්බන්ධ වන්නෙමි!`;
    await msg.reply(text);
    return;
  }

  // Option Reset
  if (messageBody === 'reset') {
    customerStates.delete(senderId);
    await msg.reply(state.lang === 'en' ? "Session reset." : "සැසිය නැවත ආරම්භ කළා.");
    return;
  }

  // Default Fallback
  await sendMainMenu(msg, state.lang);
});

async function sendMainMenu(msg, lang) {
  const text = lang === 'en'
    ? `👋 *Hi, I'm Ravindu Shehara's Web Agent*\nOwner of ravindushehara.me\n\nHow can we build your web presence today?\n\n1. 📜 View Packages & Pricing\n2. 💻 View My Portfolio\n3. 🚀 Get a Custom Quote\n4. 📞 Contact Info\n\n*Type the number of your choice (e.g., 1).*`
    : `👋 *ආයුබෝවන්, මම රවිඳු ෂෙහාරාගේ වෙබ් සහායක*\nravindushehara.me නියෝජිතයා\n\nඅද ඔබේ ව්‍යාපාරික වෙබ් අඩවිය අපි නිර්මාණය කරමුද?\n\n1. 📜 මිල ගණන් සහ පැකේජ බලන්න\n2. 💻 පසුගිය නිර්මාණ (Portfolio)\n3. 🚀 නව වෙබ් අඩවියක් සඳහා විමසීම්\n4. 📞 සම්බන්ධ වීමට\n\n*පිළිතුරේ අංකය ටයිප් කරන්න (උදා: 1).*`;
  await msg.reply(text);
}

async function sendPackages(msg, lang) {
  let text = lang === 'en' ? `🏢 *Our Web Packages* 🏢\n\n` : `🏢 *පැකේජ සහ මිල ගණන්* 🏢\n\n`;
  menuData.forEach(p => {
    text += `🔹 *${p.name}* - LKR ${p.price > 0 ? p.price.toLocaleString() + '+' : 'Consult'}\n   _${p.description}_\n\n`;
  });
  text += lang === 'en' ? `*Type 3* if you want to start a custom inquiry!` : `නව විමසීමක් ආරම්භ කිරීමට *3* ටයිප් කරන්න!`;
  await msg.reply(text);

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
    await msg.reply(q);
  } 
  else if (state.step === 'ask_type') {
    state.temp_data = { type: messageBody };
    state.step = 'ask_name';
    const q = state.lang === 'en' ? "Great! What is your Business or Project name?" : "නියමයි! අදාළ ව්‍යාපාරයේ හෝ ව්‍යාපෘතියේ නම කුමක්ද?";
    await msg.reply(q);
  }
  else if (state.step === 'ask_name') {
    state.temp_data.name = messageBody;
    state.step = 'ask_budget';
    const q = state.lang === 'en' ? "What is your estimated budget? (Optional or type a range)" : "ඔබ හිතාගෙන ඉන්නා මිල පරාසය කුමක්ද?";
    await msg.reply(q);
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
    
    await msg.reply(success);
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
