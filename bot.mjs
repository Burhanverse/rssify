import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import FeedParser from 'feedparser';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.DB_URI;
const DATABASE_NAME = process.env.DB_NAME || 'rssify';

// Initialize
const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);

let db, chatCollection, logCollection, spamCollection;

async function initDatabase() {
  await client.connect();
  db = client.db(DATABASE_NAME);
  chatCollection = db.collection('chats');
  logCollection = db.collection('logs');
  spamCollection = db.collection('spam');
  console.log('Connected to MongoDB');
}

const escapeHTML = (text) => {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return char;
    }
  });
};

const getLastLog = async (chatId, rssUrl) => {
  const log = await logCollection.findOne({ chatId, rssUrl });
  return log ? { title: log.lastItemTitle, link: log.lastItemLink } : null;
};

const updateLastLog = async (chatId, rssUrl, lastItemTitle, lastItemLink) => {
  await logCollection.updateOne(
    { chatId, rssUrl },
    { $set: { lastItemTitle, lastItemLink } },
    { upsert: true }
  );
};

// Spam protection middleware
const spamProtection = async (ctx, next) => {
  const userId = ctx.from.id.toString();
  const command = ctx.message.text.split(' ')[0];
  const now = new Date();

  // Check if the user is blocked
  const user = await spamCollection.findOne({ userId });
  if (user?.blockUntil && new Date(user.blockUntil) > now) {
    return ctx.reply('You have been blocked for 24 hours for repeated spamming. Comeback after the cooldown ends and avoid spamming in the future.');
  }

  // Record command usage
  await spamCollection.updateOne(
    { userId },
    { 
      $setOnInsert: { warnings: 0 },
      $push: { commands: { command, timestamp: now } },
    },
    { upsert: true }
  );

  // Check for spamming
  const spamCheck = await spamCollection.findOne({ userId });
  const recentCommands = spamCheck.commands.filter(cmd =>
    cmd.command === command &&
    new Date(cmd.timestamp) > new Date(now.getTime() - 60 * 1000) // Last 60 seconds
  );

  if (recentCommands.length > 3) {
    if (spamCheck.warnings >= 3) {
      // Block the user
      await spamCollection.updateOne(
        { userId },
        { $set: { blockUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000) } } // Block for 24 hours
      );
      return ctx.reply('You have been blocked for 24 hours for repeated spamming.');
    } else {
      // Warn the user
      await spamCollection.updateOne({ userId }, { $inc: { warnings: 1 } });
      return ctx.reply(`Please stop spamming commands. This is your ${spamCheck.warnings + 1}/3 warning.`);
    }
  }

  // Proceed to the next middleware
  next();
};

// Cleanup spam records periodically
const cleanUpSpamRecords = async () => {
  const now = new Date();
  await spamCollection.updateMany(
    { blockUntil: { $lte: now } },
    { $unset: { blockUntil: '' } }
  );
  await spamCollection.updateMany(
    {},
    { $pull: { commands: { timestamp: { $lte: new Date(now.getTime() - 60 * 1000) } } } } // Remove commands older than 60 seconds
  );
};
setInterval(cleanUpSpamRecords, 60 * 1000); // Cleanup every minute

// Bot commands
bot.start(spamProtection, (ctx) => {
  ctx.reply(
    'RSS-ify brings you the latest updates from your favorite feeds right into Telegram, hassle-free!\n\n' +
    'Available Commands:\n' +
    '/add rss_url - Add RSS feed\n' +
    '/del rss_url - Delete RSS feed\n' +
    '/list - List your subscribed RSS feeds\n' +
    '/set - Set topic for RSS updates (group only)',
    { parse_mode: 'HTML' }
  );
});

bot.command('add', spamProtection, async (ctx) => {
  const rssUrl = ctx.message.text.split(' ')[1];
  if (!rssUrl) {
    return ctx.reply('Usage: /add rss_url', { parse_mode: 'HTML' });
  }

  const chatId = ctx.chat.id.toString();
  try {
    const items = await fetchRss(rssUrl);
    if (items.length === 0) throw new Error('Empty feed.');

    await chatCollection.updateOne({ chatId }, { $addToSet: { rssFeeds: rssUrl } }, { upsert: true });
    ctx.reply(`RSS feed added: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>`, { parse_mode: 'HTML' });
    
    const latestItem = items[0];
    await updateLastLog(chatId, rssUrl, latestItem.title, latestItem.link);

    const message = `<b>${escapeHTML(latestItem.title)}</b>\n\n` +
          `<a href="${escapeHTML(latestItem.link)}"><i>Source</i></a>`;
    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...(ctx.message.message_thread_id && { message_thread_id: parseInt(ctx.message.message_thread_id) }),
    });
    
  } catch (err) {
    ctx.reply(`Failed to add RSS feed: ${escapeHTML(err.message)}`, { parse_mode: 'HTML' });
  }
});

bot.command('del', spamProtection, async (ctx) => {
  const rssUrl = ctx.message.text.split(' ')[1];
  if (!rssUrl) {
    return ctx.reply('Usage: /del rss_url', { parse_mode: 'HTML' });
  }

  const chatId = ctx.chat.id.toString();
  await chatCollection.updateOne({ chatId }, { $pull: { rssFeeds: rssUrl } });
  await logCollection.deleteOne({ chatId, rssUrl });

  ctx.reply(`RSS feed removed: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>`, { parse_mode: 'HTML' });
});

bot.command('list', spamProtection, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const chat = await chatCollection.findOne({ chatId });

  if (!chat?.rssFeeds?.length) {
    return ctx.reply('No RSS feeds added.', { parse_mode: 'Markdown' });
  }

  const feeds = chat.rssFeeds.map((url, i) => `${i + 1}. <a href="${escapeHTML(url)}">${escapeHTML(url)}</a>`).join('\n');
  ctx.reply(`Your RSS feeds:\n\n${feeds}`, { parse_mode: 'HTML' });
});

bot.command('set', spamProtection, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const topicId = ctx.message.message_thread_id;

  if (!topicId) {
    return ctx.reply('This command can only be used in a topic.', { parse_mode: 'HTML' });
  }

  await chatCollection.updateOne({ chatId }, { $set: { topicId } }, { upsert: true });
  ctx.reply(`RSS updates will now be sent to this topic (ID: ${topicId}).`);
});

bot.command('send', spamProtection, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const authorizedUser = process.env.OWNER_ID;

  if (chatId !== authorizedUser) {
    return ctx.reply('You are not authorized to send emergency messages.');
  }

  const message = ctx.message.text.split(' ').slice(1).join(' ');
  if (!message) {
    return ctx.reply('Usage: /send "your_message"');
  }

  const subscribers = await chatCollection.find().toArray();

  for (const subscriber of subscribers) {
    try {
      await bot.telegram.sendMessage(subscriber.chatId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`Failed to send message to ${subscriber.chatId}:`, err);
    }
  }

  ctx.reply('Emergency message sent to all subscribers.');
});

// Fetch RSS
const fetchRss = async (rssUrl) => {
  const items = [];
  const feedparser = new FeedParser();

  return new Promise((resolve, reject) => {
    axios.get(rssUrl, { responseType: 'stream' })
      .then((res) => res.data.pipe(feedparser))
      .catch(() => reject(new Error('Invalid URL')));

    feedparser.on('error', () => reject(new Error('Invalid feed format.')));
    feedparser.on('readable', function () {
      let item;
      while ((item = this.read())) items.push(item);
    });
    feedparser.on('end', () => resolve(items));
  });
};

// Send RSS updates
const sendRssUpdates = async () => {
  const chats = await chatCollection.find({ rssFeeds: { $exists: true, $not: { $size: 0 } } }).toArray();
  for (const { chatId, topicId, rssFeeds } of chats) {
    for (const rssUrl of rssFeeds) {
      try {
        const items = await fetchRss(rssUrl);
        if (!items.length) continue;

        const latestItem = items[0];
        const lastLog = await getLastLog(chatId, rssUrl);

        if (!lastLog || latestItem.title !== lastLog.title || latestItem.link !== lastLog.link) {
          const message = `<b>${escapeHTML(latestItem.title)}</b>\n\n` +
          `<a href="${escapeHTML(latestItem.link)}"><i>Source</i></a>`;

          await bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'HTML',
            ...(topicId && { message_thread_id: parseInt(topicId) }),
          }).catch(async (error) => {
            if (error.on?.payload?.chat_id) {
              console.error(`Failed to send message to chat ID: ${error.on.payload.chat_id}`);
              
              // Remove the chatId from the database
              await chatCollection.deleteOne({ chatId });
              console.log('Deleted chat from database:', error.on.payload.chat_id);
            } else {
              console.error('Unexpected error:', error.message);
            }
          });

          // Update the last log after successfully sending the message
          await updateLastLog(chatId, rssUrl, latestItem.title, latestItem.link);
        }
      } catch (err) {
        console.error(`Failed to process feed ${rssUrl}:`, err.message);
      }
    }
  }
};

let isProcessing = false;

setInterval(async () => {
  if (isProcessing) return;
  isProcessing = true;
  try {
    await sendRssUpdates(bot);
  } catch (err) {
    console.error('Error in sendRssUpdates:', err);
  } finally {
    isProcessing = false;
  }
}, 80 * 1000); // 80 seconds


// Initialize and Start the bot
(async () => {
  await initDatabase();
  bot.launch().then(() => {
    console.log('Bot is running...');
  });
})();