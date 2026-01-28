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
