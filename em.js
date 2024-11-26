import { Telegraf } from 'telegraf';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.DB_URI;
const DATABASE_NAME = process.env.DB_NAME';

// Initialize
const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);

let db, chatCollection;

async function initDatabase() {
  await client.connect();
  db = client.db(DATABASE_NAME);
  chatCollection = db.collection('chats');
  console.log('Connected to MongoDB');
}

bot.on('new_chat_members', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const newUser = ctx.message.new_chat_members[0];

  if (newUser.is_bot) return;

  await chatCollection.updateOne({ chatId }, { $set: { chatId } }, { upsert: true });
  ctx.reply('You have been subscribed to emergency updates.');
});

// /send command to send emergency message to all subscribers
bot.command('send', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const authorizedUser = process.env.OWNER_ID;

  if (chatId !== authorizedUser) {
    return ctx.reply('You are not authorized to send emergency messages.');
  }

  const message = ctx.message.text.split(' ').slice(1).join(' ');
  if (!message) {
    return ctx.reply('Usage: /send "your_message"');
  }

  // Send message to all chatIds (subscribers)
  const subscribers = await chatCollection.find().toArray();

  for (const subscriber of subscribers) {
    try {
      await bot.telegram.sendMessage(subscriber.chatId, message, { parse_mode: 'HTML' });
    } catch (err) {
      console.error(`Failed to send message to ${subscriber.chatId}:`, err);
    }
  }

  ctx.reply('Emergency message sent to all subscribers.');
});

// Initialize and start the bot
(async () => {
  await initDatabase();
  bot.launch().then(() => {
    console.log('Emergency bot is running...');
  });
})();