const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
// const Database = require('better-sqlite3'); // REMOVED BINARY 🛡️
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // --- NEW AI BRAIN ---
const axios = require('axios'); // For Professional Voice API

// --- API KEYS ---
const GEMINI_API_KEY = 'AIzaSyD9Hplr1mkCpDFyV67pz43ndaels1epWYc';
const GOOGLE_CLOUD_KEY = 'AIzaSyCxVfltS9jIMg4zXdZMBlaiUQKriMaMW4s';

// --- AI BRAIN SETUP ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: 'gemini-1.5-flash',
  systemInstruction: 'You are the Elite Virtual Assistant for Ravindu Sheharas Web Development Agency. Your goal is to capture leads and help customers choose the right web package. You speak both English and Sinhala (especially Sinhala). You should be professional, friendly, and lively. Encourage users to view packages and portfolio.'
});

// --- STABLE DATABASE SETUP (Binary-Free 🛡️) ---
const ordersFile = 'orders.json';
if (!fs.existsSync(ordersFile)) fs.writeFileSync(ordersFile, JSON.stringify([], null, 2));

function getOrders() {
  return JSON.parse(fs.readFileSync(ordersFile, 'utf8'));
}

function saveOrders(orders) {
  fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
}

// --- EXPRESS SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/orders', (req, res) => {
  const orders = getOrders();
  // Sort by newest first
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
    protocolTimeout: 120000, // 2 minutes (Extreme stability for AWS)
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--disable-notifications'
    ]
  }
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

// --- CALL HANDLER (Reject calls & Auto-reply) ---
client.on('call', async (call) => {
  console.log(`[${new Date().toLocaleTimeString()}] 📞 REJECTED CALL FROM ${call.from}`);
  
  // 1. Reject the call professionally
  await call.reject();

  // 2. Send a polite auto-reply in both languages
  const callReply = `⚠️ *Automatic System Message* ⚠️

*EN:* I am an AI Assistant and cannot answer voice calls. Please use the menu below to chat with me.

*SI:* මම AI සහායකයෙක් බැවින් ඇමතුම් වලට පිළිතුරු දිය නොහැක. කරුණාකර පහත මෙනුව භාවිතා කර මා සමග චැට් කරන්න. 

---
*Type '0' to see the Main Menu.*`;

  await client.sendMessage(call.from, callReply);
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
    const imageKey = botSettings.portfolioImage;
    
    if (imageKey) {
      const imgPath = path.join(__dirname, imageKey);
      if (fs.existsSync(imgPath)) {
        const media = MessageMedia.fromFilePath(imgPath);
        await replyWithTyping(msg, text, media);
        return;
      }
    }
    
    await replyWithTyping(msg, text);
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

  // --- ELITE: Gemini AI Smart Chat (Handles anything else) ---
  try {
    console.log(`[GEMINI] Thinking of answer for: "${msg.body}"`);
    const prompt = `The user is at step: ${state.step || 'General Chat'}. They said: "${msg.body}". Help them and keep representing Ravindu Shehara Agency.`;
    
    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();
    
    await replyWithTyping(msg, aiResponse);
  } catch (err) {
    console.error('❌ Gemini Error:', err.message);
    await sendMainMenu(msg, state.lang);
  }
});

async function replyWithTyping(msg, text, media = null) {
  const chat = await msg.getChat();
  const contact = await msg.getContact();
  const senderId = msg.from;
  let state = customerStates.get(senderId) || { lang: 'en' };

  await chat.sendStateTyping();
  // Realistic writing delay (3 seconds for "Human" feel)
  await new Promise(r => setTimeout(r, 3000));
  
  // 1. Send the Text/Media Message
  let sentMsg;
  if (media) {
    sentMsg = await client.sendMessage(msg.from, media, { caption: text });
  } else {
    sentMsg = await msg.reply(text);
  }

  return sentMsg;
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
    
    // Save as Inquiry in JSON (Binary-Free) 🛡️
    const orders = getOrders();
    const newId = Date.now(); // Unique ID using timestamp
    const newOrder = {
      id: newId,
      customer_name,
      customer_number: senderId,
      items: desc,
      total: 0,
      status: 'New Lead',
      timestamp: new Date().toISOString()
    };
    
    orders.push(newOrder);
    saveOrders(orders);

    const success = state.lang === 'en' 
      ? `✅ *Inquiry Submitted!* (Lead #${newId})\n\nThank you, ${customer_name}. I'll review your requirements and reach out very soon.\nPortfolio: ravindushehara.me`
      : `✅ *විමසීම සාර්ථකව යොමු කළා!* (Lead #${newId})\n\nස්තූතියි, ${customer_name}. මම ඔබේ අවශ්‍යතා පරීක්ෂා කර ඉතා ඉක්මනින් ඔබ හා සම්බන්ධ වන්නෙමි.\nravindushehara.me`;
    
    await replyWithTyping(msg, success);
    io.emit('new_order', newOrder);
    state.step = 'start'; // back to main
  }
  customerStates.set(senderId, state);
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Express Dashboard: http://localhost:${PORT}`);
  client.initialize();
});
