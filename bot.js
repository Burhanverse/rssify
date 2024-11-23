const { Telegraf } = require('telegraf');
const axios = require('axios');
const FeedParser = require('feedparser');
const fs = require('fs');

// Bot Token
const BOT_TOKEN = '7884373548:AAHjUAYg6Yexw3vbO00e-wP7I2WlqTFDbSY';
const bot = new Telegraf(BOT_TOKEN);

// Configuration file
const CONFIG_FILE = './config.json';
const LAST_LOG_DIR = './last_logs';

// Load or initialize configuration
const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
};

const saveConfig = (config) => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
};

// Helper functions for last logs
const getLastLog = (chatId, rssUrl) => {
  const filePath = `${LAST_LOG_DIR}/${chatId}_${encodeURIComponent(rssUrl)}.log`;
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    } else {
      return null;
    }
  } catch (err) {
    return null;
  }
};

const updateLastLog = (chatId, rssUrl, lastItemTitle) => {
  const filePath = `${LAST_LOG_DIR}/${chatId}_${encodeURIComponent(rssUrl)}.log`;
  fs.writeFileSync(filePath, lastItemTitle, 'utf8');
};

// Global Config
let config = loadConfig();

bot.start((ctx) => {
  ctx.reply(
    'Rssify brings you the latest updates from your favorite feeds, hassle-free!\n' +
      'Commands:\n' +
      '/set - Set topic for RSS updates\n' +
      '/add rss_url - Add an RSS feed\n' +
      '/list - List all RSS feeds\n' +
      '/del rss_url - Delete an RSS feed',
    { parse_mode: 'HTML' }
  );
});

// Set Topic Command
bot.command('set', (ctx) => {
  const chatId = ctx.chat.id.toString();
  const topicId = ctx.message.message_thread_id;

  if (!topicId) {
    return ctx.reply('You can only use this command inside a topic.', { parse_mode: 'Markdown' });
  }

  config[chatId] = config[chatId] || {};
  config[chatId].topicId = topicId;
  saveConfig(config);

  ctx.reply(`Topic ID set to ${topicId} for this group.`, { parse_mode: 'Markdown' });
});

// Manual HTML escape function
const escapeHTML = (text) => {
  return text.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
};

// Add RSS Command
bot.command('add', async (ctx) => {
  const [rssUrl] = ctx.message.text.split(' ').slice(1);

  if (!rssUrl) {
    return ctx.reply('Usage: /add <rss_url>', { parse_mode: 'Markdown' });
  }

  const chatId = ctx.chat.id.toString();
  config[chatId] = config[chatId] || {};
  config[chatId].rssFeeds = config[chatId].rssFeeds || [];

  if (config[chatId].rssFeeds.includes(rssUrl)) {
    return ctx.reply('This RSS feed is already added.', { parse_mode: 'Markdown' });
  }

  try {
    console.log(`Adding RSS feed: ${rssUrl}`);
    const items = await fetchRss(rssUrl);
    if (items.length === 0) throw new Error('Empty feed.');

    config[chatId].rssFeeds.push(rssUrl);
    saveConfig(config);

    const escapedUrl = escapeHTML(rssUrl);
    await ctx.reply(`RSS feed added successfully: <a href="${escapedUrl}">${escapedUrl}</a>`, { parse_mode: 'HTML' });

    const latestItem = items[0];
    const escapedTitle = escapeHTML(latestItem.title);
    const escapedLink = escapeHTML(latestItem.link);

    // Update the last log immediately
    updateLastLog(chatId, rssUrl, latestItem.title);

    await ctx.reply(
      `Latest item from the feed:\n<b>${escapedTitle}</b>\n<a href="${escapedLink}">${escapedLink}</a>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error(`Error adding RSS feed: ${rssUrl}`, err);
    await ctx.reply(
      `Failed to add RSS feed: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>\nReason: ${escapeHTML(err.message)}`,
      { parse_mode: 'HTML' }
    );
  }
});

// List RSS Feeds Command
bot.command('list', async (ctx) => {
  const chatId = ctx.chat.id.toString();

  if (!config[chatId] || !config[chatId].rssFeeds || config[chatId].rssFeeds.length === 0) {
    return ctx.reply('No RSS feeds have been added yet.', { parse_mode: 'Markdown' });
  }

  const rssList = config[chatId].rssFeeds
    .map((rssUrl, index) => `${index + 1}. ${escapeHTML(rssUrl)}`)
    .join('\n');

  ctx.reply(`RSS feeds for this chat:\n\n${rssList}`, { parse_mode: 'HTML' });
});

// Delete RSS Feed Command
bot.command('del', async (ctx) => {
  const [rssUrl] = ctx.message.text.split(' ').slice(1);

  if (!rssUrl) {
    return ctx.reply('Usage: /del <rss_url>', { parse_mode: 'Markdown' });
  }

  const chatId = ctx.chat.id.toString();

  if (!config[chatId] || !config[chatId].rssFeeds) {
    return ctx.reply('No RSS feeds have been added to delete.', { parse_mode: 'Markdown' });
  }

  const index = config[chatId].rssFeeds.indexOf(rssUrl);

  if (index === -1) {
    return ctx.reply('The specified RSS feed does not exist in this chat.', { parse_mode: 'Markdown' });
  }

  config[chatId].rssFeeds.splice(index, 1);
  saveConfig(config);

  // Delete the last log for this RSS feed
  const logFilePath = `${LAST_LOG_DIR}/${chatId}_${encodeURIComponent(rssUrl)}.log`;
  if (fs.existsSync(logFilePath)) {
    fs.unlinkSync(logFilePath);
  }

  ctx.reply(`RSS feed removed: <a href="${escapeHTML(rssUrl)}">${escapeHTML(rssUrl)}</a>`, { parse_mode: 'HTML' });
});

// Fetch RSS
const fetchRss = async (rssUrl) => {
  return new Promise((resolve, reject) => {
    const items = [];
    const feedparser = new FeedParser();

    axios
      .get(rssUrl, { responseType: 'stream' })
      .then((response) => {
        response.data.pipe(feedparser);
      })
      .catch((err) => {
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
  const feedTasks = [];

  for (const [chatId, settings] of Object.entries(config)) {
    if (!settings.rssFeeds || settings.rssFeeds.length === 0) continue;

    console.log(`Processing chat: ${chatId}`);
    for (const rssUrl of settings.rssFeeds) {
      feedTasks.push(
        (async () => {
          console.log(`Fetching feed: ${rssUrl}`);
          try {
            const items = await fetchRss(rssUrl);
            const lastLogTitle = getLastLog(chatId, rssUrl);

            if (items.length > 0) {
              const latestItem = items[0];
              if (!lastLogTitle || latestItem.title !== lastLogTitle) {
                const escapedLink = escapeHTML(latestItem.link);
                const message = `<b>${escapeHTML(latestItem.title)}</b>\n<a href="${escapedLink}">${escapedLink}</a>`;

                console.log(`Sending update to chat ${chatId} for feed: ${rssUrl}`);
                await bot.telegram.sendMessage(
                  chatId,
                  message,
                  settings.topicId
                    ? { message_thread_id: parseInt(settings.topicId), parse_mode: 'HTML' }
                    : { parse_mode: 'HTML' }
                );

                // Update last log only after successful message delivery
                updateLastLog(chatId, rssUrl, latestItem.title);
              } else {
                console.log(`No new items for feed: ${rssUrl}`);
              }
            }
          } catch (err) {
            console.error(`Failed to fetch or process feed: ${rssUrl}`, err);
          }
        })()
      );
    }
  }

  await Promise.all(feedTasks);
};

// Start periodic updates
setInterval(() => {
  sendRssUpdates(bot);
}, 5 * 60 * 1000); // Every 10 minutes

// Start the bot
bot.launch().then(() => {
  console.log('Bot is running...');
});