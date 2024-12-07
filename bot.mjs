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
  try {
    await client.connect();
    db = client.db(DATABASE_NAME);
    chatCollection = db.collection('chats');
    logCollection = db.collection('logs');
    spamCollection = db.collection('spam');
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }
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
  try {
    const userId = ctx.from.id.toString();
    const command = ctx.message.text.split(' ')[0];
    const now = new Date();

    // Retrieve spam data
    const user = await spamCollection.findOne({ userId });
    if (user?.blockUntil && new Date(user.blockUntil) > now) {
      return ctx.reply('You are blocked for spamming. Wait until the cooldown expires.');
    }

    // Update usage and check for spam
    const recentCommands = (user?.commands || []).filter(cmd =>
      cmd.command === command && new Date(cmd.timestamp) > now - 60 * 1000
    );

    if (recentCommands.length >= 3) {
      const warnings = (user?.warnings || 0) + 1;

      if (warnings >= 3) {
        await spamCollection.updateOne({ userId }, {
          $set: { blockUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
          $unset: { commands: '' }
        });
        return ctx.reply('You are blocked for 24 hours for repeated spamming.');
      } else {
        await spamCollection.updateOne({ userId }, { $set: { warnings }, $push: { commands: { command, timestamp: now } } });
        return ctx.reply(`Stop spamming. Warning ${warnings}/3.`);
      }
    }

    // Allow the user to proceed
    await spamCollection.updateOne(
      { userId },
      { $push: { commands: { command, timestamp: now } }, $setOnInsert: { warnings: 0 } },
      { upsert: true }
    );
    next();
  } catch (err) {
    console.error('Spam protection failed:', err.message);
    next();
  }
};

// Middleware isAdmin check
async function isAdmin(ctx, next) {
  try {
    // Fetch chat member info for the user
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    if (['administrator', 'creator'].includes(member.status)) {
      return next(); // Proceed to the next middleware/command
    }
    return ctx.reply('𝘠𝘰𝘶 𝘮𝘶𝘴𝘵 𝘣𝘦 𝘢𝘯 𝘢𝘥𝘮𝘪𝘯 𝘵𝘰 𝘶𝘴𝘦 𝘵𝘩𝘪𝘴 𝘤𝘰𝘮𝘮𝘢𝘯𝘥.');
  } catch (err) {
    console.error('Error checking admin status:', err);
    return ctx.reply('𝘜𝘯𝘢𝘣𝘭𝘦 𝘵𝘰 𝘷𝘦𝘳𝘪𝘧𝘺 𝘢𝘥𝘮𝘪𝘯 𝘴𝘵𝘢𝘵𝘶𝘴.');
  }
}

// Middleware for about cmd
const getBotDetails = () => {
  const packageJsonPath = path.resolve('./package.json');
  try {
    const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return {
      version: packageData.version,
      description: packageData.description || 'RSS-ify Telegram Bot',
      author: packageData.author || 'Unknown',
      license: packageData.license || 'N/A',
    };
  } catch (err) {
    console.error('Failed to read package.json:', err.message);
    return {
      version: 'Unknown',
      description: 'RSS-ify brings you the latest updates from your favorite feeds right into Telegram, hassle-free!',
      author: 'Burhanverse',
      license: 'BSPL - Proprietary License',
    };
  }
};

// Bot start command
bot.start(spamProtection, isAdmin, (ctx) => {
  ctx.reply(
    '<i>RSS-ify brings you the latest updates from your favorite feeds right into Telegram, hassle-free!</i>\n\n' +
    '<b>Available Commands:</b>\n' +
    '/add FeedURL - <i>Add a feed</i>\n' +
    '/del FeedURL - <i>Delete a feed</i>\n' +
    '/list - <i>List of your subscribed feeds</i>\n' +
    '/set - <i>Set topic for RSS updates (group only)</i>\n' +
    '/about - <i>About RSS-ify version, description, etc...</i>',
    { parse_mode: 'HTML' }
  );
});

// Add command 
bot.command('add', spamProtection, isAdmin, async (ctx) => {
  const rssUrl = ctx.message.text.split(' ')[1];
  if (!rssUrl) {
    return ctx.reply('Usage: /𝘢𝘥𝘥 𝘳𝘴𝘴_𝘶𝘳𝘭', { parse_mode: 'HTML' });
  }

  const chatId = ctx.chat.id.toString();
  try {
    const items = await fetchRss(rssUrl);
    if (items.length === 0) throw new Error('Empty feed.');

    await chatCollection.updateOne({ chatId }, { $addToSet: { rssFeeds: rssUrl } }, { upsert: true });
    ctx.reply(`𝘙𝘚𝘚 𝘧𝘦𝘦𝘥 𝘢𝘥𝘥𝘦𝘥: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>`, { parse_mode: 'HTML' });

    const latestItem = items[0];
    await updateLastLog(chatId, rssUrl, latestItem.title, latestItem.link);

    const message = `<b>${escapeHTML(latestItem.title)}</b>\n\n` +
      `<a href="${escapeHTML(latestItem.link)}">𝘚𝘰𝘶𝘳𝘤𝘦</a>`;
    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...(ctx.message.message_thread_id && { message_thread_id: parseInt(ctx.message.message_thread_id) }),
    });

  } catch (err) {
    ctx.reply(`𝘍𝘢𝘪𝘭𝘦𝘥 𝘵𝘰 𝘢𝘥𝘥 𝘙𝘚𝘚 𝘧𝘦𝘦𝘥: ${escapeHTML(err.message)}`, { parse_mode: 'HTML' });
  }
});

// Delete command 
bot.command('del', spamProtection, isAdmin, async (ctx) => {
  const rssUrl = ctx.message.text.split(' ')[1];
  if (!rssUrl) {
    return ctx.reply('Usage: /𝘥𝘦𝘭 𝘳𝘴𝘴_𝘶𝘳𝘭', { parse_mode: 'HTML' });
  }

  const chatId = ctx.chat.id.toString();
  await chatCollection.updateOne({ chatId }, { $pull: { rssFeeds: rssUrl } });
  await logCollection.deleteOne({ chatId, rssUrl });

  ctx.reply(`𝘙𝘚𝘚 𝘧𝘦𝘦𝘥 𝘳𝘦𝘮𝘰𝘷𝘦𝘥: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>`, { parse_mode: 'HTML' });
});

// List command 
bot.command('list', spamProtection, isAdmin, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const chat = await chatCollection.findOne({ chatId });

  if (!chat?.rssFeeds?.length) {
    return ctx.reply('𝘕𝘰 𝘙𝘚𝘚 𝘧𝘦𝘦𝘥𝘴 𝘢𝘥𝘥𝘦𝘥.', { parse_mode: 'Markdown' });
  }

  const feeds = chat.rssFeeds.map((url, i) => `${i + 1}. <a href="${escapeHTML(url)}">${escapeHTML(url)}</a>`).join('\n');
  ctx.reply(`𝘠𝘰𝘶𝘳 𝘴𝘶𝘣𝘴𝘤𝘳𝘪𝘣𝘦𝘥 𝘧𝘦𝘦𝘥𝘴:\n\n${feeds}`, { parse_mode: 'HTML' });
});

// Set command 
bot.command('set', spamProtection, isAdmin, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const topicId = ctx.message.message_thread_id;

  if (!topicId) {
    return ctx.reply('𝘛𝘩𝘪𝘴 𝘤𝘰𝘮𝘮𝘢𝘯𝘥 𝘤𝘢𝘯 𝘰𝘯𝘭𝘺 𝘣𝘦 𝘶𝘴𝘦𝘥 𝘪𝘯 𝘢 𝘵𝘰𝘱𝘪𝘤.', { parse_mode: 'HTML' });
  }

  await chatCollection.updateOne({ chatId }, { $set: { topicId } }, { upsert: true });
  ctx.reply(`𝘙𝘚𝘚 𝘶𝘱𝘥𝘢𝘵𝘦𝘴 𝘸𝘪𝘭𝘭 𝘯𝘰𝘸 𝘣𝘦 𝘴𝘦𝘯𝘵 𝘵𝘰 𝘵𝘩𝘪𝘴 𝘵𝘰𝘱𝘪𝘤 (𝘐𝘋: ${topicId}).`);
});

// Send command (owner only)
bot.command('send', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const authorizedUser = process.env.OWNER_ID;

  if (chatId !== authorizedUser) {
    return ctx.reply('𝘙𝘦𝘴𝘦𝘳𝘷𝘦𝘥 𝘧𝘰𝘳 𝘰𝘸𝘯𝘦𝘳 𝘶𝘴𝘦 𝘰𝘯𝘭𝘺.');
  }

  const originalMessage = ctx.message.reply_to_message;
  if (!originalMessage) {
    return ctx.reply('𝘗𝘭𝘦𝘢𝘴𝘦 𝘳𝘦𝘱𝘭𝘺 𝘵𝘰 𝘵𝘩𝘦 𝘮𝘦𝘴𝘴𝘢𝘨𝘦 𝘺𝘰𝘶 𝘸𝘢𝘯𝘵 𝘵𝘰 𝘧𝘰𝘳𝘸𝘢𝘳𝘥.');
  }

  const subscribers = await chatCollection.find().toArray();

  for (const subscriber of subscribers) {
    try {
      await bot.telegram.forwardMessage(subscriber.chatId, chatId, originalMessage.message_id);
    } catch (err) {
      console.error(`Failed to send message to ${subscriber.chatId}:`, err);
    }
  }

  ctx.reply('𝘔𝘦𝘴𝘴𝘢𝘨𝘦 𝘧𝘰𝘳𝘸𝘢𝘳𝘥𝘦𝘥 𝘴𝘶𝘤𝘤𝘦𝘴𝘴𝘧𝘶𝘭𝘭𝘺.');
});

// About command
bot.command('about', spamProtection, async (ctx) => {
  const { version, description, author, license } = getBotDetails();
  const message =
    '<b>RSS-ify Version:</b> <i>' + escapeHTML(version) + '</i>\n\n' +
    '<b>Description:</b> <i>' + escapeHTML(description) + '</i>\n' +
    '<b>Author:</b> <i>' + escapeHTML(author) + '</i>\n' +
    '<b>License:</b> <i>' + escapeHTML(license) + '</i>';

  ctx.reply(message, { parse_mode: 'HTML' });
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
            `<a href="${escapeHTML(latestItem.link)}">𝘚𝘰𝘶𝘳𝘤𝘦</a>`;

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

          await updateLastLog(chatId, rssUrl, latestItem.title, latestItem.link);
        }
      } catch (err) {
        console.error(`𝘍𝘢𝘪𝘭𝘦𝘥 𝘵𝘰 𝘱𝘳𝘰𝘤𝘦𝘴𝘴 𝘧𝘦𝘦𝘥 ${rssUrl}:`, err.message);
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
