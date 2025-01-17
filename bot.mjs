import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { Telegraf } from 'telegraf';
import { MongoClient } from 'mongodb';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import prettyBytes from 'pretty-bytes';

import dotenv from 'dotenv';

dotenv.config();

const execPromise = promisify(exec);

const BOT_TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.DB_URI;
const DATABASE_NAME = process.env.DB_NAME || 'rssify';

// Initialize
const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);

// MongoDB connection and collections
let db, chatCollection, logCollection, spamCollection;

const initDatabase = async () => {
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
};

// Middleware to check if the user exists in the database
const isUserInDb = async (ctx, next) => {
  try {
    if (!db) {
      await initDatabase();
    }

    const chatId = ctx.chat.id;
    console.log(`Checking if user with chat ID ${chatId} exists in the database...`);

    const userExists = await chatCollection.findOne({ chatId: chatId.toString() });
    if (!userExists) {
      console.log(`User with chat ID ${chatId} not found. Adding to database.`);
      await chatCollection.insertOne({
        chatId: chatId.toString(),
      });

      console.log(`User with chat ID ${chatId} added to the database.`);
    } else {
      console.log(`User with chat ID ${chatId} is already in the database.`);
    }

    return next();
  } catch (error) {
    console.error('Error in isUserInDb middleware:', error);
    return ctx.reply('An error occurred while processing your request. Please try again later.');
  }
};

// Last log functions
const getLastLog = async (chatId, rssUrl) => {
  return await logCollection.findOne({ chatId, rssUrl });
};

const updateLastLog = async (chatId, rssUrl, lastItemTitle, lastItemLink) => {
  const timestamp = new Date();
  await logCollection.updateOne(
    { chatId, rssUrl },
    { $set: { lastItemTitle, lastItemLink, timestamp } },
    { upsert: true }
  );
};

// Store the bot start time
const botStartTime = Date.now();

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

// Escape HTML helper function
const escapeHTML = (text) => {
  return text.replace(/[&<>"'’]/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      case '’': return '&#8217;';
      default: return char;
    }
  });
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

    // Allow to proceed
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
const isAdmin = async (ctx, next) => {
  // If the chat is private, allow the command to proceed
  if (ctx.chat.type === 'private') {
    return next();
  }

  try {
    const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    if (['administrator', 'creator'].includes(chatMember.status)) {
      return next();
    } else {
      return ctx.reply('𝘠𝘰𝘶 𝘮𝘶𝘴𝘵 𝘣𝘦 𝘢𝘯 𝘢𝘥𝘮𝘪𝘯 𝘵𝘰 𝘶𝘴𝘦 𝘵𝘩𝘪𝘴 𝘤𝘰𝘮𝘮𝘢𝘯𝘥.');
    }
  } catch (err) {
    console.error('Error in isAdmin middleware:', err);
    return ctx.reply('𝘜𝘯𝘢𝘣𝘭𝘦 𝘵𝘰 𝘷𝘦𝘳𝘪𝘧𝘺 𝘺𝘰𝘶𝘳 𝘢𝘤𝘤𝘦𝘴𝘴 𝘳𝘪𝘨𝘩𝘵𝘴. 𝘗𝘭𝘦𝘢𝘴𝘦 𝘵𝘳𝘺 𝘢𝘨𝘢𝘪𝘯.');
  }
};

// Middleware for about cmd
const getBotDetails = () => {
  const packageJsonPath = path.resolve('./package.json');
  try {
    const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return {
      version: packageData.version,
      description: packageData.description,
      author: packageData.author,
      homepage: packageData.homepage,
      license: packageData.license,
    };
  } catch (err) {
    console.error('Failed to read package.json:', err.message);
    return {
      version: 'Unknown',
      description: 'RSS-ify brings you the latest updates from your favorite feeds right into Telegram, hassle-free!',
      author: 'Burhanverse',
      license: '𝘗𝘳𝘫𝘬𝘵:𝘚𝘪𝘥. - Proprietary License',
    };
  }
};

// Bot start command
bot.start(spamProtection, isUserInDb, isAdmin, (ctx) => {
  ctx.reply(
    '🤖 <i>RSS-ify brings you the latest updates from your favorite feeds right into Telegram, hassle-free!</i>\n\n' +
    '<b>⚙️ Supported feed types:</b> <i>Atom, RSS2.0 & RSS1.0</i>\n\n' +
    '<b>⌨️ Available Commands:</b>\n' +
    '/add FeedURL - <i>Add a feed</i>\n' +
    '/del FeedURL - <i>Delete a feed</i>\n' +
    '/list - <i>List of your subscribed feeds</i>\n' +
    '/set - <i>Set topic for RSS updates (group only)</i>\n' +
    '/about - <i>About RSS-ify version, description, etc...</i>\n\n' +
    '©️<a href="burhanverse.t.me"><i>Prjkt:Sid.</i></a>',
    {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }
  );
});

// Add command 
bot.command('add', spamProtection, isUserInDb, isAdmin, async (ctx) => {
  const rssUrl = ctx.message.text.split(' ')[1];
  if (!rssUrl) {
    return ctx.reply('Usage: /𝘢𝘥𝘥 𝘳𝘴𝘴_𝘶𝘳𝘭', { parse_mode: 'HTML' });
  }

  const chatId = ctx.chat.id.toString();
  try {
    // Check if the feed already exists
    const chat = await chatCollection.findOne({ chatId });
    if (chat?.rssFeeds?.includes(rssUrl)) {
      return ctx.reply(`𝘍𝘦𝘦𝘥 𝘢𝘭𝘳𝘦𝘢𝘥𝘺 𝘦𝘹𝘪𝘴𝘵𝘴`, {
        parse_mode: 'HTML',
      });
    }

    // Fetch and validate the RSS feed
    const items = await fetchRss(rssUrl);
    if (items.length === 0) throw new Error('𝘌𝘮𝘱𝘵𝘺 𝘧𝘦𝘦𝘥.');

    // Add the feed to the database
    await chatCollection.updateOne({ chatId }, { $addToSet: { rssFeeds: rssUrl } }, { upsert: true });
    ctx.reply(`𝘍𝘦𝘦𝘥 𝘢𝘥𝘥𝘦𝘥: ${escapeHTML(rssUrl)}`, { parse_mode: 'HTML' });

    // Update the last log with the latest feed item
    const latestItem = items[0];
    await updateLastLog(chatId, rssUrl, latestItem.title, latestItem.link);

    // Send the latest feed item as a message
    const message = `<b>${escapeHTML(latestItem.title)}</b>\n\n` +
      `<a href="${escapeHTML(latestItem.link)}">Source</a> | <a href="burhanverse.t.me"><i>Prjkt:Sid.</i></a>`;
    await bot.telegram.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...(ctx.message.message_thread_id && { message_thread_id: parseInt(ctx.message.message_thread_id) }),
    });

  } catch (err) {
    ctx.reply(`Failed to add feed: ${escapeHTML(err.message)}`, { parse_mode: 'HTML' });
  }
});

// Delete command 
bot.command('del', spamProtection, isUserInDb, isAdmin, async (ctx) => {
  const rssUrl = ctx.message.text.split(' ')[1];
  if (!rssUrl) {
    return ctx.reply('Usage: /𝘥𝘦𝘭 𝘳𝘴𝘴_𝘶𝘳𝘭', { parse_mode: 'HTML' });
  }

  const chatId = ctx.chat.id.toString();
  await chatCollection.updateOne({ chatId }, { $pull: { rssFeeds: rssUrl } });
  await logCollection.deleteOne({ chatId, rssUrl });

  ctx.reply(`𝘍𝘦𝘦𝘥 𝘳𝘦𝘮𝘰𝘷𝘦𝘥: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>`, { parse_mode: 'HTML' });
});

// List command 
bot.command('list', spamProtection, isUserInDb, isAdmin, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const chat = await chatCollection.findOne({ chatId });

  if (!chat?.rssFeeds?.length) {
    return ctx.reply('𝘕𝘰 𝘍𝘦𝘦𝘥𝘴 𝘢𝘥𝘥𝘦𝘥.', { parse_mode: 'Markdown' });
  }

  const feeds = chat.rssFeeds.map((url, i) => `${i + 1}. <a href="${escapeHTML(url)}">${escapeHTML(url)}</a>`).join('\n');
  ctx.reply(`𝘠𝘰𝘶𝘳 𝘴𝘶𝘣𝘴𝘤𝘳𝘪𝘣𝘦𝘥 𝘧𝘦𝘦𝘥𝘴:\n\n${feeds}\n\n<a href="burhanverse.t.me"><i>Prjkt:Sid.</i></a>`, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
});

// Set command 
bot.command('set', spamProtection, isUserInDb, isAdmin, async (ctx) => {
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

// /stats command implementation
bot.command('stats', spamProtection, isUserInDb, isAdmin, async (ctx) => {
  const start = Date.now();

  try {
    // Calculate bot uptime
    const botUptime = formatUptime(Date.now() - botStartTime);

    // Get network usage
    const { stdout: networkOutput } = await execPromise('cat /sys/class/net/eth0/statistics/rx_bytes /sys/class/net/eth0/statistics/tx_bytes');
    const [rxBytes, txBytes] = networkOutput.trim().split('\n').map((val) => parseInt(val, 10));
    const inbound = prettyBytes(rxBytes);
    const outbound = prettyBytes(txBytes);

    // Calculate bot ping
    const ping = Date.now() - start;

    const stats =
      `<b>Bot Stats</b>\n\n` +
      `⋗ <b>Ping:</b> <i>${ping} ms </i> \n` +
      `⋗ <b>Uptime:</b> <i>${botUptime} </i> \n` +
      `⋗ <b>Inbound:</b> <i>${inbound} </i>\n` +
      `⋗ <b>Outbound:</b> <i>${outbound} </i>`;
    await ctx.reply(
      stats,
      { parse_mode: 'HTML' }
    );

  } catch (err) {
    console.error('Error in /stats command:', err);
    await ctx.reply('An error occurred while fetching stats. Please try again later.');
  }
});

// About command
bot.command('about', spamProtection, isUserInDb, async (ctx) => {
  const { version, description, author, homepage, license } = getBotDetails();
  const message =
    `<b>RSS-ify Version:</b> <i>${escapeHTML(version)}</i>\n\n` +
    `<b>Description:</b> <i>${escapeHTML(description)}</i>\n` +
    `<b>Project Page:</b> <i><a href="${escapeHTML(homepage)}">Link</a></i>\n` +
    `<b>Author:</b> <i>${escapeHTML(author)}</i>\n` +
    `<b>License:</b> <i>${escapeHTML(license)}</i>`;

  await ctx.reply(message, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
});

// Fetch RSS feeds from api
const fetchRss = async (rssUrl) => {
  try {
    const response = await axios.get('http://127.0.0.1:5000/parse', {
      params: { url: rssUrl },
    });
    return response.data.items;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to fetch RSS feed');
  }
};

// Send RSS updates to Telegram
const sendRssUpdates = async () => {
  const chats = await chatCollection.find({ rssFeeds: { $exists: true, $not: { $size: 0 } } }).toArray();
  for (const { chatId, topicId, rssFeeds } of chats) {
    for (const rssUrl of rssFeeds) {
      try {
        const items = await fetchRss(rssUrl);
        if (!items.length) continue;

        const latestItem = items[0];
        const lastLog = await getLastLog(chatId, rssUrl);

        if (lastLog && latestItem.link === lastLog.lastItemLink) {
          console.log(`No new updates for chat ${chatId} on feed ${rssUrl}`);
          continue;
        }

        const message = `<b>${escapeHTML(latestItem.title)}</b>\n\n` +
          `<a href="${escapeHTML(latestItem.link)}">𝘚𝘰𝘶𝘳𝘤𝘦</a> | <a href="burhanverse.t.me"><i>Prjkt:Sid.</i></a>`;

        await bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'HTML',
          ...(topicId && { message_thread_id: parseInt(topicId) }),
        }).catch(async (error) => {
          if (error.on?.payload?.chat_id) {
            console.error(`Failed to send message to chat ID: ${error.on.payload.chat_id}`);
            await chatCollection.deleteOne({ chatId });
            console.log('Deleted chat from database:', error.on.payload.chat_id);
          } else {
            console.error('Unexpected error:', error.message);
          }
        });

        await updateLastLog(chatId, rssUrl, latestItem.title, latestItem.link);
      } catch (err) {
        console.error(`Failed to process feed ${rssUrl}:`, err.message);
      }
    }
  }
};

let isProcessing = false;

async function startCycle() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    console.log('Starting RSS update cycle...');
    await sendRssUpdates();
  } catch (err) {
    console.error('Error in sendRssUpdates:', err);
  } finally {
    isProcessing = false;
    console.log('Cycle complete. Waiting 10 seconds before starting next cycle...');
    setTimeout(startCycle, 10 * 1000); // Wait 10 seconds before next cycle
  }
}

// Initialize the bot
(async () => {
  await initDatabase();
  startCycle();
  bot.launch().then(() => {
    console.log('Bot is running...');
  });
})();
