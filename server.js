const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// MongoDB ga ulanish
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('MongoDB ga ulanish muvaffaqiyatli');
}).catch((err) => {
  console.error('MongoDB ga ulanish xatoliki:', err);
});

// Middleware
app.use(cors());
app.use(express.json());

// Event modeli
const EventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  location: { type: String, required: true },
  price: { type: Number, required: true },
  maxParticipants: { type: Number },
  isActive: { type: Boolean, default: true },
  imageUrl: { type: String },
  requirements: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const Event = mongoose.model('Event', EventSchema);

// Registration modeli (yangi)
const RegistrationSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  telegramId: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  canPay: { type: Boolean },
  registeredAt: { type: Date, default: Date.now }
});

const Registration = mongoose.model('Registration', RegistrationSchema);

// User modeli (eski uchun compatibility)
const UserSchema = new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  isITAcademy: { type: Boolean, required: true },
  canPay: { type: Boolean },
  registeredAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// Telegram bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Bot holatlari
const userStates = {};

// /start komandasi
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id.toString();
  
  // Faol tadbirlarni olish
  const activeEvents = await Event.find({ isActive: true });
  
  if (activeEvents.length === 0) {
    bot.sendMessage(chatId, 'Hozircha faol tadbirlar mavjud emas. Keyinroq qayta tekshiring! 🎯');
    return;
  }
  
  userStates[telegramId] = { step: 'name' };
  bot.sendMessage(chatId, 'Assalomu alaykum! 🎉\n\nIsmingiz va familiyangizni kiriting:');
});

// /admin komandasi
bot.onText(/\/admin/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id.toString();
  
  userStates[telegramId] = { step: 'admin_login' };
  bot.sendMessage(chatId, '🔐 *Admin Panel*\n\nLogin kiriting:', {
    parse_mode: 'Markdown'
  });
});

// /stats komandasi - umumiy statistika
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const totalEvents = await Event.countDocuments();
    const activeEvents = await Event.countDocuments({ isActive: true });
    const totalRegistrations = await Registration.countDocuments();
    const canPayRegistrations = await Registration.countDocuments({ canPay: true });
    
    // Oxirgi 5 ta ro'yxatdan o'tish
    const recentRegistrations = await Registration.find()
      .populate('eventId')
      .sort({ registeredAt: -1 })
      .limit(5);
    
    let message = `📊 *Statistika*\n\n`;
    message += `🎯 Tadbirlar: ${totalEvents} (faol: ${activeEvents})\n`;
    message += `👥 Ro'yxatdan o'tganlar: ${totalRegistrations}\n`;
    message += `💰 To'lovga tayyor: ${canPayRegistrations}\n\n`;
    
    if (recentRegistrations.length > 0) {
      message += `📋 *Oxirgi ro'yxatdan o'tishlar:*\n`;
      recentRegistrations.forEach((reg, index) => {
        message += `${index + 1}. ${reg.firstName} ${reg.lastName} - ${reg.eventId.title}\n`;
      });
    }
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Statistikani olishda xatolik yuz berdi');
  }
});

// /events komandasi - tadbirlar ro'yxati
bot.onText(/\/events/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    const events = await Event.find().sort({ date: 1 });
    
    if (events.length === 0) {
      bot.sendMessage(chatId, 'Hozircha tadbirlar mavjud emas');
      return;
    }
    
    let message = `🎯 *Tadbirlar ro'yxati*\n\n`;
    events.forEach((event, index) => {
      const status = event.isActive ? '✅ Faol' : '❌ Faol emas';
      message += `${index + 1}. *${event.title}*\n`;
      message += `   📅 ${event.date.toLocaleDateString('uz-UZ')} ⏰ ${event.time}\n`;
      message += `   📍 ${event.location}\n`;
      message += `   💰 ${event.price} so'm ${status}\n\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Tadbirlarni olishda xatolik yuz berdi');
  }
});

// Matnlarni qabul qilish
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id.toString();
  const text = msg.text;
  
  if (!userStates[telegramId]) return;
  
  const state = userStates[telegramId];
  
  switch (state.step) {
    case 'name':
      userStates[telegramId] = { 
        step: 'event_selection', 
        fullName: text,
        eventPage: 0
      };
      
      // Faol tadbirlarni ko'rsatish (pagination bilan)
      await showEventsPage(chatId, telegramId, 0);
      break;
      
    case 'admin_login':
      userStates[telegramId] = { 
        step: 'admin_password', 
        adminLogin: text 
      };
      bot.sendMessage(chatId, '🔐 Parolni kiriting:');
      break;
      
    case 'admin_password':
      if (state.adminLogin === process.env.ADMIN_LOGIN && text === process.env.ADMIN_PASSWORD) {
        await showAdminPanel(chatId, telegramId);
        delete userStates[telegramId];
      } else {
        bot.sendMessage(chatId, '❌ Login yoki parol noto\'g\'ri!\n\nQayta urinib ko\'ring /admin');
        delete userStates[telegramId];
      }
      break;
  }
});

// Tadbirlarni pagination bilan ko'rsatish
async function showEventsPage(chatId, telegramId, page = 0) {
  const activeEvents = await Event.find({ isActive: true });
  const itemsPerPage = 3;
  const totalPages = Math.ceil(activeEvents.length / itemsPerPage);
  const startIndex = page * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageEvents = activeEvents.slice(startIndex, endIndex);
  
  if (pageEvents.length === 0) {
    bot.sendMessage(chatId, 'Hozircha faol tadbirlar mavjud emas. Keyinroq qayta tekshiring! 🎯');
    return;
  }
  
  let eventButtons = pageEvents.map(event => [
    {
      text: `${event.title} - ${event.price} so'm`,
      callback_data: `event_${event._id}`
    }
  ]);
  
  // Pagination tugmalari
  const navigationButtons = [];
  if (totalPages > 1) {
    const navRow = [];
    if (page > 0) {
      navRow.push({ text: '⬅️ Oldingi', callback_data: `page_${page - 1}` });
    }
    navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: 'page_info' });
    if (page < totalPages - 1) {
      navRow.push({ text: 'Keyingi ➡️', callback_data: `page_${page + 1}` });
    }
    navigationButtons.push(navRow);
  }
  
  const keyboard = [...eventButtons, ...navigationButtons];
  
  bot.sendMessage(chatId, `${userStates[telegramId]?.fullName || 'Foydalanuvchi'}, qaysi tadbirga qatnashmoqchisiz?`, {
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

// Admin panelni ko'rsatish
async function showAdminPanel(chatId, telegramId) {
  try {
    const totalEvents = await Event.countDocuments();
    const activeEvents = await Event.countDocuments({ isActive: true });
    const totalRegistrations = await Registration.countDocuments();
    const canPayRegistrations = await Registration.countDocuments({ canPay: true });
    
    // Oxirgi 5 ta ro'yxatdan o'tish
    const recentRegistrations = await Registration.find()
      .populate('eventId')
      .sort({ registeredAt: -1 })
      .limit(5);
    
    let message = `🔐 *Admin Panel*\n\n`;
    message += `📊 *Umumiy statistika:*\n`;
    message += `🎯 Tadbirlar: ${totalEvents} (faol: ${activeEvents})\n`;
    message += `👥 Ro'yxatdan o'tganlar: ${totalRegistrations}\n`;
    message += `💰 To'lovga tayyor: ${canPayRegistrations}\n\n`;
    
    if (recentRegistrations.length > 0) {
      message += `📋 *Oxirgi ro'yxatdan o'tishlar:*\n`;
      recentRegistrations.forEach((reg, index) => {
        message += `${index + 1}. ${reg.firstName} ${reg.lastName} - ${reg.eventId.title}\n`;
      });
    }
    
    message += `\n🔧 *Admin komandalari:*\n`;
    message += `/stats - To'liq statistika\n`;
    message += `/events - Tadbirlar ro'yxati\n`;
    message += `/registrations - Ro'yxatdan o'tganlar\n`;
    message += `/create_event - Yangi tadbir yaratish\n`;
    message += `/help - Yordam`;
    
    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📊 Statistika', callback_data: 'admin_stats' },
            { text: '🎯 Tadbirlar', callback_data: 'admin_events' }
          ],
          [
            { text: '👥 Ro\'yxatdan o\'tganlar', callback_data: 'admin_registrations' },
            { text: '➕ Yangi tadbir', callback_data: 'admin_create_event' }
          ]
        ]
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Admin panelni yuklashda xatolik yuz berdi');
  }
}

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const telegramId = callbackQuery.from.id.toString();
  const data = callbackQuery.data;
  
  // Pagination uchun
  if (data.startsWith('page_')) {
    const page = parseInt(data.split('_')[1]);
    await showEventsPage(chatId, telegramId, page);
    bot.answerCallbackQuery(callbackQuery.id);
    return;
  }
  
  if (data === 'page_info') {
    bot.answerCallbackQuery(callbackQuery.id, { text: 'Sahifa ma\'lumoti' });
    return;
  }
  
  // Admin panel callback lar
  if (data.startsWith('admin_')) {
    switch (data) {
      case 'admin_stats':
        await showAdminStats(chatId);
        break;
      case 'admin_events':
        await showAdminEvents(chatId);
        break;
      case 'admin_registrations':
        await showAdminRegistrations(chatId);
        break;
      case 'admin_create_event':
        bot.sendMessage(chatId, '📝 Yangi tadbir yaratish:\n\nFormat:\n/nomi - Tadbir nomi\ntavsif - Tavsif\nsana - DD.MM.YYYY\nvaqt - HH:mm\njoyi - Joy\nnarx - 15000');
        break;
    }
    bot.answerCallbackQuery(callbackQuery.id);
    return;
  }
  
  if (data.startsWith('event_')) {
    const eventId = data.split('_')[1];
    const event = await Event.findById(eventId);
    
    if (!event) {
      bot.answerCallbackQuery(callbackQuery.id, 'Tadbir topilmadi');
      return;
    }
    
    userStates[telegramId] = { 
      step: 'payment', 
      fullName: userStates[telegramId]?.fullName || '',
      eventId: eventId 
    };
    
    bot.sendMessage(chatId, 
      `🎯 *${event.title}*\n\n` +
      `📅 Sanasi: ${event.date.toLocaleDateString('uz-UZ')}\n` +
      `⏰ Vaqti: ${event.time}\n` +
      `📍 Joyi: ${event.location}\n\n` +
      `🚀 ${event.description}\n\n` +
      `Tadbir kuni ${event.price} so'm olib kela olasizmi? (O'zingiz uchun bu pul orqali siz Party ya'ni yegulikga ishlatish uchun to'planadi)`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Ha, olib kelaman', callback_data: `pay_yes_${eventId}` },
              { text: 'Yo\'q, olib olmayman', callback_data: `pay_no_${eventId}` }
            ]
          ]
        }
      }
    );
  }
  
  if (data.startsWith('pay_yes_') || data.startsWith('pay_no_')) {
    const eventId = data.split('_')[2];
    const canPay = data.startsWith('pay_yes_');
    const event = await Event.findById(eventId);
    const state = userStates[telegramId];
    
    if (!state || !event) {
      bot.answerCallbackQuery(callbackQuery.id, 'Xatolik yuz berdi');
      return;
    }
    
    const [firstName, ...lastNameParts] = state.fullName.split(' ');
    const lastName = lastNameParts.join(' ') || '';
    
    // Ro'yxatdan o'tish
    const registration = new Registration({
      eventId: eventId,
      telegramId: telegramId,
      firstName: firstName,
      lastName: lastName,
      canPay: canPay
    });
    
    await registration.save();
    
    bot.sendMessage(chatId, 
      `🎉 Siz "${event.title}" tadbiriga muvaffaqiyatli ro'yxatdan o'tdingiz!\n\n` +
      `📅 Sanasi: ${event.date.toLocaleDateString('uz-UZ')}\n` +
      `⏰ Vaqti: ${event.time}\n` +
      `📍 Joyi: ${event.location}\n` +
      `${canPay ? `💰 To'lov: ${event.price} so'm` : '💰 To\'lov: Keltirmaysiz'}\n\n` +
      `Kech qolmang! 🚀`,
      {
        reply_markup: {
          remove_keyboard: true
        }
      }
    );
    
    delete userStates[telegramId];
  }
  
  bot.answerCallbackQuery(callbackQuery.id);
});

// Admin statistikasi
async function showAdminStats(chatId) {
  try {
    const totalEvents = await Event.countDocuments();
    const activeEvents = await Event.countDocuments({ isActive: true });
    const totalRegistrations = await Registration.countDocuments();
    const canPayRegistrations = await Registration.countDocuments({ canPay: true });
    
    // Kunlik statistika
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayRegistrations = await Registration.countDocuments({
      registeredAt: { $gte: today }
    });
    
    let message = `📊 *To'liq statistika*\n\n`;
    message += `🎯 *Tadbirlar:*\n`;
    message += `   Jami: ${totalEvents}\n`;
    message += `   Faol: ${activeEvents}\n`;
    message += `   Nofaol: ${totalEvents - activeEvents}\n\n`;
    
    message += `👥 *Ro'yxatdan o'tishlar:*\n`;
    message += `   Jami: ${totalRegistrations}\n`;
    message += `   Bugun: ${todayRegistrations}\n`;
    message += `   To'lovga tayyor: ${canPayRegistrations}\n`;
    message += `   To'lovga tayyor emas: ${totalRegistrations - canPayRegistrations}\n`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Statistikani olishda xatolik yuz berdi');
  }
}

// Admin tadbirlari
async function showAdminEvents(chatId) {
  try {
    const events = await Event.find().sort({ date: 1 });
    
    if (events.length === 0) {
      bot.sendMessage(chatId, 'Hozircha tadbirlar mavjud emas');
      return;
    }
    
    let message = `🎯 *Tadbirlar ro'yxati*\n\n`;
    events.forEach(async (event, index) => {
      const status = event.isActive ? '✅ Faol' : '❌ Faol emas';
      const registrationsCount = await Registration.countDocuments({ eventId: event._id });
      
      message += `${index + 1}. *${event.title}*\n`;
      message += `   📅 ${event.date.toLocaleDateString('uz-UZ')} ⏰ ${event.time}\n`;
      message += `   📍 ${event.location}\n`;
      message += `   💰 ${event.price} so'm\n`;
      message += `   👥 Ro'yxatdan o'tgan: ${registrationsCount}\n`;
      message += `   ${status}\n\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Tadbirlarni olishda xatolik yuz berdi');
  }
}

// Admin ro'yxatdan o'tganlari
async function showAdminRegistrations(chatId) {
  try {
    const registrations = await Registration.find()
      .populate('eventId')
      .sort({ registeredAt: -1 })
      .limit(20);
    
    if (registrations.length === 0) {
      bot.sendMessage(chatId, 'Hozircha hech kim ro\'yxatdan o\'tmagan');
      return;
    }
    
    let message = `👥 *Ro'yxatdan o'tganlar (oxirgi 20 ta)*\n\n`;
    registrations.forEach((reg, index) => {
      const paymentStatus = reg.canPay ? '✅ Tayyor' : '❌ Tayyor emas';
      message += `${index + 1}. ${reg.firstName} ${reg.lastName}\n`;
      message += `   🎯 ${reg.eventId.title}\n`;
      message += `   💰 ${reg.eventId.price} so'm ${paymentStatus}\n`;
      message += `   📅 ${reg.registeredAt.toLocaleDateString('uz-UZ')}\n\n`;
    });
    
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    bot.sendMessage(chatId, '❌ Ro\'yxatdan o\'tganlarni olishda xatolik yuz berdi');
  }
}

// API Routes

// Login
app.post('/api/login', async (req, res) => {
  const { login, password } = req.body;
  
  if (login === process.env.ADMIN_LOGIN && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ login }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } else {
    res.status(401).json({ message: 'Login yoki parol noto\'g\'ri' });
  }
});

// Events API
app.get('/api/events', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token kerak' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET);
    
    const events = await Event.find().sort({ date: 1 });
    res.json(events);
  } catch (error) {
    res.status(401).json({ message: 'Noto\'g\'ri token' });
  }
});

app.post('/api/events', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token kerak' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET);
    
    const event = new Event(req.body);
    await event.save();
    res.json(event);
  } catch (error) {
    res.status(401).json({ message: 'Noto\'g\'ri token' });
  }
});

app.put('/api/events/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token kerak' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET);
    
    const event = await Event.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(event);
  } catch (error) {
    res.status(401).json({ message: 'Noto\'g\'ri token' });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token kerak' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET);
    
    await Event.findByIdAndDelete(req.params.id);
    res.json({ message: 'Tadbir o\'chirildi' });
  } catch (error) {
    res.status(401).json({ message: 'Noto\'g\'ri token' });
  }
});

// Registrations API
app.get('/api/registrations', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token kerak' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET);
    
    const registrations = await Registration.find()
      .populate('eventId')
      .sort({ registeredAt: -1 });
    res.json(registrations);
  } catch (error) {
    res.status(401).json({ message: 'Noto\'g\'ri token' });
  }
});

// Barcha foydalanuvchilarni olish (eski uchun)
app.get('/api/users', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token kerak' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET);
    
    const users = await User.find().sort({ registeredAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(401).json({ message: 'Noto\'g\'ri token' });
  }
});

// Statistika
app.get('/api/stats', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: 'Token kerak' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET);
    
    const totalUsers = await User.countDocuments();
    const itAcademyUsers = await User.countDocuments({ isITAcademy: true });
    const canPayUsers = await User.countDocuments({ canPay: true });
    
    // Events statistikasi
    const totalEvents = await Event.countDocuments();
    const activeEvents = await Event.countDocuments({ isActive: true });
    const totalRegistrations = await Registration.countDocuments();
    const canPayRegistrations = await Registration.countDocuments({ canPay: true });
    
    res.json({
      // Eski statistika
      total: totalUsers,
      itAcademy: itAcademyUsers,
      canPay: canPayUsers,
      // Yangi statistika
      events: {
        total: totalEvents,
        active: activeEvents
      },
      registrations: {
        total: totalRegistrations,
        canPay: canPayRegistrations
      }
    });
  } catch (error) {
    res.status(401).json({ message: 'Noto\'g\'ri token' });
  }
});

app.listen(PORT, () => {
  console.log(`Server ${PORT} portida ishga tushdi`);
});
