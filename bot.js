const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Telegraf } = require('telegraf');
const FeedParser = require('feedparser');
const { MongoClient } = require('mongodb');

require('dotenv').config();

const BOT_TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.DB_URI;
const DATABASE_NAME = process.env.DB_NAME || 'rssify';

// Initialize
const bot = new Telegraf(BOT_TOKEN);
const client = new MongoClient(MONGO_URI);

let db, chatCollection, logCollection;

const CONFIG_FILE = './config.json';
const LAST_LOG_DIR = './last_logs';

async function initDatabase() {
  await client.connect();
  db = client.db(DATABASE_NAME);
  chatCollection = db.collection('chats');
  logCollection = db.collection('logs');
  console.log('Connected to MongoDB');
}

async function migrateData() {
  if (fs.existsSync(CONFIG_FILE)) {
    console.log('Migrating config.json...');
    const configData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const configEntries = Object.entries(configData).map(([chatId, settings]) => ({
      chatId,
      ...settings,
    }));

    if (configEntries.length > 0) {
      for (const { chatId, topicId, rssFeeds } of configEntries) {
        await chatCollection.updateOne(
          { chatId },
          { $set: { topicId, rssFeeds: rssFeeds || [] } },
          { upsert: true }
        );
      }
      console.log('config.json migrated successfully!');
    } else {
      console.log('config.json is empty. Skipping...');
    }
    fs.unlinkSync(CONFIG_FILE);
    console.log('config.json successfully deleted.');
  } else {
    console.log('config.json not found. Skipping...');
  }

  if (fs.existsSync(LAST_LOG_DIR)) {
    console.log('Migrating last_logs...');
    const logFiles = fs.readdirSync(LAST_LOG_DIR);

    for (const file of logFiles) {
      const [chatId, encodedUrl] = file.split('_');
      const rssUrl = decodeURIComponent(encodedUrl.replace('.log', ''));
      const lastItemTitle = fs.readFileSync(path.join(LAST_LOG_DIR, file), 'utf8');

      await logCollection.updateOne(
        { chatId, rssUrl },
        { $set: { lastItemTitle } },
        { upsert: true }
      );
    }
    console.log('last_logs migrated successfully!');
    fs.rmSync(LAST_LOG_DIR, { recursive: true, force: true });
    console.log('last_logs successfully deleted!');
  } else {
    console.log('last_logs directory not found. Skipping...');
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
  return log ? log.lastItemTitle : null;
};

const updateLastLog = async (chatId, rssUrl, lastItemTitle) => {
  await logCollection.updateOne(
    { chatId, rssUrl },
    { $set: { lastItemTitle } },
    { upsert: true }
  );
};

// Bot commands 
bot.start((ctx) => {
  ctx.reply(
    'RSS-ify Brings you the latest updates from your favorite feeds right into Telegram, hassle-free!\n' +
    'Available Commands:\n' +
    '/add rss_url - Add RSS feed\n' +
    '/del rss_url - Delete RSS feed\n' +
    '/list - Lists your subscribed RSS feeds\n' +
    '/set - Sets the current group topic for RSS feed updates',
    { parse_mode: 'HTML' }
  );
});

bot.command('set', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const topicId = ctx.message.message_thread_id;

  if (!topicId) {
    return ctx.reply('You can only use this command inside a topic.', { parse_mode: 'Markdown' });
  }

  await chatCollection.updateOne(
    { chatId },
    { $set: { topicId } },
    { upsert: true }
  );

  ctx.reply(`Topic ID set to ${topicId} for this group.`, { parse_mode: 'Markdown' });
});

bot.command('add', async (ctx) => {
  const [rssUrl] = ctx.message.text.split(' ').slice(1);

  if (!rssUrl) {
    return ctx.reply('Usage: /add rss_url', { parse_mode: 'Markdown' });
  }

  const chatId = ctx.chat.id.toString();

  try {
    const items = await fetchRss(rssUrl);
    if (items.length === 0) throw new Error('Empty feed.');

    await chatCollection.updateOne(
      { chatId },
      { $addToSet: { rssFeeds: rssUrl } },
      { upsert: true }
    );

    const escapedUrl = escapeHTML(rssUrl);
    ctx.reply(`RSS feed added successfully: <a href="${escapedUrl}">${escapedUrl}</a>`, { parse_mode: 'HTML' });

    const latestItem = items[0];
    const escapedTitle = escapeHTML(latestItem.title);
    const escapedLink = escapeHTML(latestItem.link);

    await updateLastLog(chatId, rssUrl, latestItem.title);

    ctx.reply(
      `Latest item from the feed:\n<b>${escapedTitle}</b>\n<a href="${escapedLink}">${escapedLink}</a>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    ctx.reply(
      `Failed to add RSS feed: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>\nReason: ${escapeHTML(err.message)}`,
      { parse_mode: 'HTML' }
    );
  }
});

bot.command('list', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const chat = await chatCollection.findOne({ chatId });

  if (!chat || !chat.rssFeeds || chat.rssFeeds.length === 0) {
    return ctx.reply('No RSS feeds have been added yet.', { parse_mode: 'Markdown' });
  }

  const rssList = chat.rssFeeds
    .map((rssUrl, index) => `${index + 1}. ${escapeHTML(rssUrl)}`)
    .join('\n');

  ctx.reply(`RSS feeds for this chat:\n\n${rssList}`, { parse_mode: 'HTML' });
});

bot.command('del', async (ctx) => {
  const [rssUrl] = ctx.message.text.split(' ').slice(1);

  if (!rssUrl) {
    return ctx.reply('Usage: /del rss_url', { parse_mode: 'Markdown' });
  }

  const chatId = ctx.chat.id.toString();

  const chat = await chatCollection.findOneAndUpdate(
    { chatId },
    { $pull: { rssFeeds: rssUrl } },
    { returnDocument: 'after' }
  );

  if (!chat || !chat.value || !chat.value.rssFeeds.includes(rssUrl)) {
    return ctx.reply(`RSS feed removed: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>`, { parse_mode: 'HTML' });
  }

  await logCollection.deleteOne({ chatId, rssUrl });

  ctx.reply('The specified RSS feed does not exist in this chat.', { parse_mode: 'Markdown' });
});

// Fetch RSS
const fetchRss = async (rssUrl) => {
  return new Promise((resolve, reject) => {
    const items = [];
    const feedparser = new FeedParser();

    axios.get(rssUrl, { responseType: 'stream' })
      .then((response) => {
        response.data.pipe(feedparser);
      })
      .catch(() => {
        reject(new Error('Invalid or inaccessible URL.'));
      });

    feedparser.on('error', () => {
      reject(new Error('Invalid or unsupported RSS format.'));
    });

    feedparser.on('readable', function () {
      let item;
      while ((item = this.read())) {
        items.push(item);
      }
    });

    feedparser.on('end', () => {
      resolve(items);
    });
  });
};

// Send RSS Updates
const sendRssUpdates = async (bot) => {
  const chats = await chatCollection.find({ rssFeeds: { $exists: true, $not: { $size: 0 } } }).toArray();

  for (const chat of chats) {
    const { chatId, topicId, rssFeeds } = chat;

    for (const rssUrl of rssFeeds) {
      try {
        const items = await fetchRss(rssUrl);
        const lastLogTitle = await getLastLog(chatId, rssUrl);

        if (items.length > 0) {
          const latestItem = items[0];
          if (!lastLogTitle || latestItem.title !== lastLogTitle) {
            const escapedLink = escapeHTML(latestItem.link);
            const message = `<b>${escapeHTML(latestItem.title)}</b>\n<a href="${escapedLink}">${escapedLink}</a>`;

            await bot.telegram.sendMessage(
              chatId,
              message,
              topicId ? { message_thread_id: parseInt(topicId), parse_mode: 'HTML' } : { parse_mode: 'HTML' }
            );

            await updateLastLog(chatId, rssUrl, latestItem.title);
          }
        }
      } catch (err) {
        console.error(`Failed to fetch or process feed: ${rssUrl}`, err);
      }
    }
  }
};

setInterval(() => {
  sendRssUpdates(bot);
}, 10 * 1000); // 10sec

// Initialize and Start the bot
(async () => {
  await initDatabase();
  await migrateData();
  bot.launch().then(() => {
    console.log('Bot is running...');
  });
})();