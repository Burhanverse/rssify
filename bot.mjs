import { Bot } from 'grammy';
import { fetchRss } from './ext/parserApi.mjs';
import { escapeHTML } from './ext/escapeHelper.mjs';
import { addCmd } from './ext/commands/addHandler.mjs';
import { delCmd } from './ext/commands/delHandler.mjs';
import { setCmd } from './ext/commands/setHandler.mjs';
import { connectDB, chatCollection } from './ext/db.mjs';
import { startCmd } from './ext/commands/startHandler.mjs';
import { statsCmd } from './ext/commands/statsHandler.mjs';
import { aboutCmd } from './ext/commands/aboutHandler.mjs';
import { alertSender } from './ext/commands/alertSender.mjs';
import { handleExport, handleImport } from './ext/commands/opmlHandler.mjs';
import { handleList, handlePagination } from './ext/commands/listHandler.mjs';
import { isAdmin, spamProtection, updateLastLog, getLastLog, delay } from './ext/middlewares.mjs';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

// Initialize bot
const bot = new Bot(BOT_TOKEN);

// Bot commands
bot.command('start', spamProtection, isAdmin, startCmd);
bot.command('add', spamProtection, isAdmin, addCmd);
bot.command('del', spamProtection, isAdmin, delCmd);
bot.command('set', spamProtection, isAdmin, setCmd);
bot.command('stats', spamProtection, statsCmd);
bot.command('about', spamProtection, aboutCmd);
bot.command('list', spamProtection, isAdmin, handleList);
bot.callbackQuery(/^list_(prev|next)_(\d+)$/, spamProtection, isAdmin, handlePagination);
bot.command('send', alertSender);
bot.command('export', spamProtection, isAdmin, handleExport);
bot.command('import', spamProtection, isAdmin, handleImport);

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
      feedCache.set(url, []);
    }
  }

  for (const { chatId, topicId, rssFeeds } of chats) {
    const chatSubscription = await chatCollection.findOne({ chatId });
    if (!chatSubscription || !Array.isArray(chatSubscription.rssFeeds)) {
      continue;
    }

    for (const rssUrl of rssFeeds) {
      // Double-check that the chat is still subscribed to this feed.
      if (!chatSubscription.rssFeeds.includes(rssUrl)) {
        console.log(`Chat ${chatId} is no longer subscribed to ${rssUrl}. Skipping.`);
        continue;
      }

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
          const currentChat = await chatCollection.findOne({ chatId });
          if (!currentChat?.rssFeeds.includes(rssUrl)) {
            console.log(`Chat ${chatId} unsubscribed from ${rssUrl} during sending. Skipping further items.`);
            break;
          }

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
            await delay(1000); // 1sec delay.
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
        console.error(`Error processing ${rssUrl} for chat ${chatId}:`, err.message);
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
  await connectDB();
  startCycle();
  bot.start({
    drop_pending_updates: true,
  });
})();
