import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import axios from 'axios';

// โหลดค่าจากไฟล์ .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public')); // เสิร์ฟไฟล์หน้าเว็บ Frontend

// ----------------------------------------------------
// 1. ตั้งค่า Database (MongoDB Atlas)
// ----------------------------------------------------
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas successfully!'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// สร้าง Schema เก็บการตั้งค่า
const settingsSchema = new mongoose.Schema({
  configId: { type: String, default: 'global', unique: true },
  activeModel: { type: String, default: 'anthropic/claude-3.5-sonnet' },
  dailyBudget: { type: Number, default: 2.0 },
  todaySpend: { type: Number, default: 0.0 },
  favorites: { type: [String], default: [] },
  lastResetDate: { type: String, default: () => new Date().toISOString().split('T')[0] }
});

const Settings = mongoose.model('Settings', settingsSchema);

// ฟังก์ชันช่วยดึงค่า Settings (ถ้าเปิดครั้งแรกไม่มีข้อมูล ให้สร้างใหม่)
async function getGlobalSettings() {
  let settings = await Settings.findOne({ configId: 'global' });
  if (!settings) {
    settings = new Settings({ configId: 'global' });
    await settings.save();
  }
  
  // ตรวจสอบว่าข้ามวันแล้วหรือยัง ถ้าข้ามแล้วให้รีเซ็ตยอดเงินรายวัน
  const today = new Date().toISOString().split('T')[0];
  if (settings.lastResetDate !== today) {
    settings.todaySpend = 0;
    settings.lastResetDate = today;
    await settings.save();
    console.log('🔄 เริ่มวันใหม่ รีเซ็ตยอดเงินรายวันเป็น $0 แล้ว');
  }
  return settings;
}

// สมุดราคาเก็บไว้ในแรม (Memory Cache)
let modelsPriceCache = {};

// ----------------------------------------------------
// 2. API สำหรับหน้าเว็บ Dashboard (Frontend)
// ----------------------------------------------------

// ดึงโมเดลทั้งหมดจาก OpenRouter และอัปเดตสมุดราคา
app.get('/api/models', async (req, res) => {
  try {
    const response = await axios.get('https://openrouter.ai/api/v1/models');
    
    // อัปเดตสมุดราคาแบบอัตโนมัติ
    response.data.data.forEach(model => {
      modelsPriceCache[model.id] = {
        prompt: parseFloat(model.pricing.prompt) || 0,
        completion: parseFloat(model.pricing.completion) || 0
      };
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching models:', error.message);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// ให้หน้าเว็บอ่านการตั้งค่าปัจจุบันจาก Database
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getGlobalSettings();
    res.json({ 
      activeModel: settings.activeModel, 
      dailyBudget: settings.dailyBudget,
      todaySpend: settings.todaySpend,
      favorites: settings.favorites
    });
  } catch (error) {
    console.error('Database Error:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// ให้หน้าเว็บกดเปลี่ยนโมเดล หรือเปลี่ยนงบ (เซฟลง Database)
app.post('/api/settings', async (req, res) => {
  try {
    const { activeModel, newDailyBudget, toggleFavorite } = req.body;
    const settings = await getGlobalSettings();
    
    if (activeModel) settings.activeModel = activeModel;
    if (newDailyBudget !== undefined) settings.dailyBudget = parseFloat(newDailyBudget);
    
    if (toggleFavorite) {
      const index = settings.favorites.indexOf(toggleFavorite);
      if (index > -1) {
        settings.favorites.splice(index, 1); // เอาออก
      } else {
        settings.favorites.push(toggleFavorite); // เพิ่มเข้า
      }
    }
    
    await settings.save();
    console.log(`[Dashboard] เปลี่ยนตั้งค่าเป็น Model: ${settings.activeModel}, Budget: $${settings.dailyBudget}`);
    
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (error) {
    console.error('Database Error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ----------------------------------------------------
// 3. API Proxy หลัก (ให้ Claude Code ยิงเข้ามาที่นี่)
// ----------------------------------------------------
app.post('/api/v1/messages', async (req, res) => {
  // ก. ตรวจสอบรหัสผ่านกันคนอื่นแอบใช้
  const authHeader = req.headers['authorization'];
  const expectedToken = `Bearer ${process.env.PROXY_SECRET_PASSWORD}`;
  
  if (authHeader !== expectedToken) {
    console.log('❌ มีคนพยายามเข้าใช้โดยรหัสผ่านผิด');
    return res.status(401).json({ error: { message: 'Unauthorized: Invalid Proxy Password' } });
  }

  // ข. ดึง Settings จาก Database มาเช็ค
  const settings = await getGlobalSettings();

  // ค. เช็คว่าเงินเกินงบรายวันหรือยัง
  if (settings.todaySpend >= settings.dailyBudget) {
    console.log('🛑 ใช้งานเกินงบรายวัน บล็อกการส่งคำสั่ง!');
    return res.status(402).json({ error: { message: `Daily Budget Exceeded! Limit: $${settings.dailyBudget}, Spent: $${settings.todaySpend.toFixed(4)}` } });
  }

  // ง. แปลงร่างคำสั่ง บังคับเปลี่ยนโมเดลเป็นตัวที่เราเลือกไว้บนเว็บ
  const targetModel = settings.activeModel;
  console.log(`🤖 ส่งคำสั่งไปให้ OpenRouter ใช้โมเดล: [${targetModel}]`);
  
  const proxyBody = {
    ...req.body,
    model: targetModel
  };

  try {
    // จ. ส่งคำสั่งต่อไปให้ OpenRouter (พร้อมเปิดโหมด Stream)
    const openRouterResponse = await axios({
      method: 'post',
      url: 'https://openrouter.ai/api/v1/messages',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        // ส่วนนี้คือ HTTP-Referer จำเป็นสำหรับ OpenRouter เอาไว้บอกว่ามาจากแอปอะไร
        'HTTP-Referer': 'https://openrouter-proxy.railway.app', 
        'X-Title': 'Claude Code Proxy'
      },
      data: proxyBody,
      responseType: 'stream' // สำคัญมาก เพื่อให้พิมพ์ตอบทีละคำได้
    });

    // ฉ. เชื่อมท่อ (Pipe) ส่งข้อมูลกลับไปให้ Claude Code ทันที (Streaming)
    res.setHeader('Content-Type', openRouterResponse.headers['content-type']);
    openRouterResponse.data.pipe(res);
    
    // (TODO ในอนาคต): โค้ดดักจับ Stream ก้อนสุดท้ายเพื่อคำนวณเงินแล้วบวกเข้า settings.todaySpend
    
  } catch (error) {
    console.error('❌ Proxy Error:', error.response?.statusText || error.message);
    res.status(error.response?.status || 500).json({ 
      error: { message: 'OpenRouter Proxy Failed or Server Error' } 
    });
  }
});

// เริ่มรันเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`🚀 Proxy Server พร้อมรันแล้วที่ http://localhost:${PORT}`);
  console.log(`🔒 รอรับคำสั่งจาก Claude Code ผ่าน /api/v1/messages`);
});
