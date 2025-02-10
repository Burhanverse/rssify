import { Bot } from 'grammy';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
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
const bot = new Bot(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);

// MongoDB
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

// Last log functions
const getLastLog = async (chatId, rssUrl) => {
  return await logCollection.findOne({ chatId, rssUrl });
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const updateLastLog = async (chatId, rssUrl, items) => {
  const timestamp = new Date();

  const itemsToPush = items.map(item => ({
    title: item.title,
    link: item.link,
    timestamp: timestamp,
  }));

  const lastLog = await logCollection.findOne({ chatId, rssUrl });
  const existingLinks = lastLog?.lastItems?.map(item => item.link) || [];

  const uniqueItems = itemsToPush.filter(item =>
    !existingLinks.includes(item.link)
  );

  if (uniqueItems.length === 0) return;

  await logCollection.updateOne(
    { chatId, rssUrl },
    {
      $push: {
        lastItems: {
          $each: uniqueItems,
          $sort: { timestamp: -1 },
          $slice: 5
        }
      }
    },
    { upsert: true }
  );
};

// Bot start time
const botStartTime = Date.now();

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return days > 0
    ? `${days}d ${hours}h ${minutes}m ${secs}s`
    : `${hours}h ${minutes}m ${secs}s`;
}

// Escape HTML helper
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

    const user = await spamCollection.findOne({ userId });
    if (user?.blockUntil && new Date(user.blockUntil) > now) {
      return ctx.reply('<i>You are blocked due to excessive bot command usage. Wait until the cooldown expires</i>',
        { parse_mode: 'HTML' }
      );
    }

    const recentCommands = (user?.commands || []).filter(cmd =>
      cmd.command === command && new Date(cmd.timestamp) > now - 60 * 1000
    );

    if (recentCommands.length >= 4) {
      const warnings = (user?.warnings || 0) + 1;

      if (warnings >= 4) {
        await spamCollection.updateOne({ userId }, {
          $set: { blockUntil: new Date(now.getTime() + 60 * 60 * 1000) }, // 1 hour cooldown
          $unset: { commands: '' }
        });
        return ctx.reply('<i>YOU are blocked for 1 hour due to repeated spamming</i>',
          { parse_mode: 'HTML' }
        );
      } else {
        await spamCollection.updateOne({ userId }, { $set: { warnings }, $push: { commands: { command, timestamp: now } } });
        return ctx.reply(`<i>Stop spamming. Warning ${warnings}/3.</i>`,
          { parse_mode: 'HTML' }
        );
      }
    }

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


// isAdmin Middleware
const isAdmin = async (ctx, next) => {
  if (ctx.chat.type === 'private') {
    return next();
  }

  try {
    const chatMember = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    if (['administrator', 'creator'].includes(chatMember.status)) {
      return next();
    } else {
      return ctx.reply('<i>You must be an admin to use this command.</i>',
        { parse_mode: 'HTML' }
      );
    }
  } catch (err) {
    console.error('Error in isAdmin middleware:', err);
    return ctx.reply('<i>Unable to verify your access rights.</i>',
      { parse_mode: 'HTML' }
    );
  }
};

// Middleware for about cmd
const getBotDetails = () => {
  const packageJsonPath = path.resolve('./package.json');
  try {
    const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return {
      version: packageData.version,
      apivar: packageData.apivar,
      description: packageData.description,
      author: packageData.author,
      homepage: packageData.homepage,
      issues: packageData.bugs.url,
      license: packageData.license,
      copyright: packageData.copyright,
    };
  } catch (err) {
    console.error('Failed to read package.json:', err.message);
    return {
      version: 'Unknown',
    };
  }
};

// Bot start command
bot.command('start', spamProtection, isAdmin, (ctx) => {
  ctx.reply(
    '🤖 <i>RSS-ify brings you the latest updates from your favorite feeds right into Telegram, hassle-free!</i>\n\n' +
    'ℹ️ <i>Visit project homepage for more details.</i>\n' +
    '🌐 <b>Homepage:</b> <a href="burhanverse.eu.org/blog/rssify"><i>visit now!</i></a>\n\n' +
    '<a href="burhanverse.t.me"><i>Prjkt:Sid.</i></a>',
    {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }
  );
});

// Add command 
bot.command('add', spamProtection, isAdmin, async (ctx) => {
  const rssUrl = ctx.message.text.split(' ')[1];
  if (!rssUrl) {
    return ctx.reply('Usage: /add <code>source_url</code>', { parse_mode: 'HTML' });
  }

  const chatId = ctx.chat.id.toString();
  try {
    const chat = await chatCollection.findOne({ chatId });
    if (chat?.rssFeeds?.includes(rssUrl)) {
      return ctx.reply(`<i>Feed already exists</i>`, {
        parse_mode: 'HTML',
      });
    }

    const items = await fetchRss(rssUrl);
    if (items.length === 0) throw new Error('𝘌𝘮𝘱𝘵𝘺 𝘧𝘦𝘦𝘥.');

    await chatCollection.updateOne({ chatId }, { $addToSet: { rssFeeds: rssUrl } }, { upsert: true });
    ctx.reply(`<i>Feed added</i>: ${escapeHTML(rssUrl)}`, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    const latestItem = items[0];
    await updateLastLog(chatId, rssUrl, [latestItem]);

    const message = `<b>${escapeHTML(latestItem.title)}</b>\n\n` +
      `<a href="${escapeHTML(latestItem.link)}"><i>Source</i></a>`;
    await bot.api.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      ...(ctx.message.message_thread_id && { message_thread_id: parseInt(ctx.message.message_thread_id) }),
    });
    console.log(`Chat ${chatId} added a new feed URL: ${rssUrl}`);

  } catch (err) {
    ctx.reply(`<i>Failed to add feed</i>: ${escapeHTML(err.message)}`, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }
});

// Delete command 
bot.command('del', spamProtection, isAdmin, async (ctx) => {
  const rssUrl = ctx.message.text.split(' ')[1];
  if (!rssUrl) {
    return ctx.reply('Usage: /del <code>source_url</code>', { parse_mode: 'HTML' });
  }

  const chatId = ctx.chat.id.toString();
  await chatCollection.updateOne({ chatId }, { $pull: { rssFeeds: rssUrl } });
  await logCollection.deleteOne({ chatId, rssUrl });

  ctx.reply(`<i>Feed removed</i>: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>`, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
});

// List command 
bot.command('list', spamProtection, isAdmin, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const chat = await chatCollection.findOne({ chatId });

  if (!chat?.rssFeeds?.length) {
    return ctx.reply("<i>You haven't Subscribed to a feed yet.</i>", {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  const feeds = chat.rssFeeds.map((url, i) => `${i + 1}. <a href="${escapeHTML(url)}">${escapeHTML(url)}</a>`).join('\n');
  ctx.reply(`</b><i>Your Subscribed feeds</i><b>:\n\n${feeds}\n\n<a href="burhanverse.t.me"><i>Prjkt:Sid.</i></a>`, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
});

// Set command 
bot.command('set', spamProtection, isAdmin, async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const topicId = ctx.message.message_thread_id;

  if (!topicId) {
    return ctx.reply('<i>This command can only be used in a topic.</i>', { parse_mode: 'HTML' });
  }

  await chatCollection.updateOne({ chatId }, { $set: { topicId } }, { upsert: true });
  ctx.reply(`<i>Feed updates will now be sent to this topic</i> (𝘐𝘋: ${topicId}).`,
    { parse_mode: 'HTML' }
  );
});

// Send command (owner only)
bot.command('send', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const authorizedUser = process.env.OWNER_ID;

  if (chatId !== authorizedUser) {
    return ctx.reply('<i>Reserved for owner only</i>',
      { parse_mode: 'HTML' }
    );
  }

  const originalMessage = ctx.message.reply_to_message;
  if (!originalMessage) {
    return ctx.reply('<i>Please reply to a message you want to forward.</i>',
      { parse_mode: 'HTML' }
    );
  }

  const subscribers = await chatCollection.find().toArray();

  for (const subscriber of subscribers) {
    try {
      await bot.api.forwardMessage(subscriber.chatId, chatId, originalMessage.message_id);
    } catch (error) {
      if (error.on?.payload?.chat_id) {
        console.error(`Failed to send to chat ${error.on.payload.chat_id}`);
        await chatCollection.deleteOne({ chatId });
        console.log(`Deleted chat ${chatId} from database`);
        break;
      }
      console.error('Send message error:', error.message);
    }
  }

  ctx.reply('<i>Message forwarded successfully.</i>',
    { parse_mode: 'HTML' }
  );
});

// /stats command implementation ( works only on ptrodactyl eggs )
bot.command('stats', spamProtection, async (ctx) => {
  const start = Date.now();

  try {
    const botUptime = formatUptime(Date.now() - botStartTime);
    const { stdout: networkOutput } = await execPromise('cat /sys/class/net/eth0/statistics/rx_bytes /sys/class/net/eth0/statistics/tx_bytes');
    const [rxBytes, txBytes] = networkOutput.trim().split('\n').map((val) => parseInt(val, 10));
    const inbound = prettyBytes(rxBytes);
    const outbound = prettyBytes(txBytes);

    const ping = Date.now() - start;

    const stats =
      `<i><b>Bot Server Stats</b></i>\n\n` +
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
    await ctx.reply('<i>An error occurred while fetching server stats. Please try again later.</i>',
      { parse_mode: 'HTML' }
    );
  }
});

// About command
bot.command('about', spamProtection, async (ctx) => {
  const { version, apivar, description, author, homepage, issues, license, copyright } = getBotDetails();
  const message =
    `<b>About Bot:</b> <i>${escapeHTML(description)}</i>\n\n` +
    `⋗ <b>Client Version:</b> <i>${escapeHTML(version)}</i>\n` +
    `⋗ <b>Parser API:</b> <i>${escapeHTML(apivar)}</i>\n` +
    `⋗ <b>Author:</b> <i>${escapeHTML(author)}</i>\n` +
    `⋗ <b>Issues:</b> <i><a href="${escapeHTML(issues)}">Report Now!</a></i>\n` +
    `⋗ <b>Project Page:</b> <i><a href="${escapeHTML(homepage)}">Check NOw!</a></i>\n` +
    `⋗ <b>License:</b> <i>${escapeHTML(license)}</i>\n` +
    `⋗ <b>Copyright:</b> <i>${escapeHTML(copyright)}</i>`;

  await ctx.reply(message, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
});

// Fetch RSS feeds using ParserAPI
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

// Send RSS updates
const sendRssUpdates = async () => {
  const chats = await chatCollection.find({ rssFeeds: { $exists: true, $not: { $size: 0 } } }).toArray();
  const uniqueUrls = [...new Set(chats.flatMap(chat => chat.rssFeeds))];
  const feedCache = new Map();

  for (const url of uniqueUrls) {
    try {
      const items = await fetchRss(url);
      feedCache.set(url, items);
      console.log(`Fetched ${items.length} items from ${url}`);
    } catch (err) {
      console.error(`Failed to fetch ${url}:`, err.message);
      feedCache.set(url, []); // Store empty array on failure
    }
  }

  for (const { chatId, topicId, rssFeeds } of chats) {
    for (const rssUrl of rssFeeds) {
      const cachedItems = feedCache.get(rssUrl);
      if (!cachedItems || cachedItems.length === 0) continue;

      try {
        const lastLog = await getLastLog(chatId, rssUrl);
        const existingLinks = lastLog?.lastItems?.map(item => item.link) || [];
        const newItems = [];

        for (const item of cachedItems) {
          if (existingLinks.includes(item.link)) break;
          newItems.push(item);
        }

        if (newItems.length === 0) {
          console.log(`No new items in chat ${chatId} for ${rssUrl}`);
          continue;
        }

        const itemsToSend = [...newItems].reverse();

        for (const item of itemsToSend) {
          const currentLog = await getLastLog(chatId, rssUrl);
          const currentLinks = currentLog?.lastItems?.map(item => item.link) || [];

          if (currentLinks.includes(item.link)) {
            console.log(`Duplicate detected in final check for ${item.link}`);
            continue;
          }

          const message = `<b>${escapeHTML(item.title)}</b>\n\n` +
            `<a href="${escapeHTML(item.link)}"><i>Source</i></a>`;

          try {
            await bot.api.sendMessage(chatId, message, {
              parse_mode: 'HTML',
              ...(topicId && { message_thread_id: parseInt(topicId) }),
            });

            await updateLastLog(chatId, rssUrl, [item]);
            console.log(`Sent content in chat ${chatId} for ${rssUrl}`);
            await delay(1000); // Maintain rate limiting
          } catch (error) {
            if (error.on?.payload?.chat_id) {
              console.error(`Failed to send to chat ${error.on.payload.chat_id}`);
              await chatCollection.deleteOne({ chatId });
              console.log(`Deleted chat ${chatId} from database`);
              break;
            }
            console.error('Send message error:', error.message);
          }
        }
      } catch (err) {
        console.error(`Error processing ${rssUrl}:`, err.message);
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
    setTimeout(startCycle, 10 * 1000);
  }
}

(async () => {
  await initDatabase();
  startCycle();
  bot.start();
})();
