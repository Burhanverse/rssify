import { Bot, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { log } from './utils/colorLog.mjs';
import { fetchRss } from './utils/parserApi.mjs';
import { chatCollection } from './utils/db.mjs';
import { escapeHTML } from './utils/escapeHelper.mjs';
import { isFeedPaused } from './commands/feedHandler.mjs';
import { updateLastLog, getLastLog, delay, rateLimitSending } from './utils/middlewares.mjs';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

// Initialize bot
const bot = new Bot(BOT_TOKEN);

// Send RSS updates
export const sendRssUpdates = async () => {
    const chats = await chatCollection.find({ rssFeeds: { $exists: true, $not: { $size: 0 } } }).toArray();
    const uniqueUrls = [...new Set(chats.flatMap(chat => chat.rssFeeds))];
    const feedCache = new Map();

    for (const url of uniqueUrls) {
        try {
            const items = await fetchRss(url);
            feedCache.set(url, items);
            log.success(`Fetched ${items.length} items from ${url}`);
        } catch (err) {
            log.error(`Failed to fetch ${url}:`, err.message);
            feedCache.set(url, []);
        }
    }

    for (const { chatId, topicId, rssFeeds } of chats) {
        const chatSubscription = await chatCollection.findOne({ chatId });
        if (!chatSubscription || !Array.isArray(chatSubscription.rssFeeds)) {
            continue;
        }

        // Check if feed updates are paused for this chat
        const paused = await isFeedPaused(chatId);
        if (paused) {
            log.info(`Feed updates are paused for chat ${chatId}. Skipping.`);
            continue;
        }

        for (const rssUrl of rssFeeds) {
            // Double-check that the chat is still subscribed to this feed.
            if (!chatSubscription.rssFeeds.includes(rssUrl)) {
                log.info(`Chat ${chatId} is no longer subscribed to ${rssUrl}. Skipping.`);
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
                    log.info(`No new items in chat ${chatId} for ${rssUrl}`);
                    continue;
                }

                const itemsToSend = [...newItems].reverse();

                for (const item of itemsToSend) {
                    const currentChat = await chatCollection.findOne({ chatId });
                    if (!currentChat?.rssFeeds.includes(rssUrl)) {
                        log.info(`Chat ${chatId} unsubscribed from ${rssUrl} during sending. Skipping further items.`);
                        break;
                    }

                    const currentLog = await getLastLog(chatId, rssUrl);
                    const currentLinks = currentLog?.lastItems?.map(item => item.link) || [];

                    if (currentLinks.includes(item.link)) {
                        log.warn(`Duplicate detected in final check for ${item.link}`);
                        continue;
                    }

                    const message = `<b>${escapeHTML(item.title)}</b><a href="${escapeHTML(item.link)}">​</a>`;

                    // inline keyboard with Source button
                    const keyboard = new InlineKeyboard()
                        .url('Source', item.link);

                    try {
                        await rateLimitSending(chatId, async () => {
                            return await bot.api.sendMessage(chatId, message, {
                                parse_mode: 'HTML',
                                reply_markup: keyboard,
                                ...(topicId && { message_thread_id: parseInt(topicId) }),
                            });
                        });

                        await updateLastLog(chatId, rssUrl, [item]);
                        log.success(`Sent content in chat ${chatId} for ${rssUrl}`);
                        await delay(2000); // 2sec delay.
                    } catch (error) {
                        if (error.error_code === 403 || error.description?.includes('bot was blocked') ||
                            error.description?.includes('chat not found') || error.description?.includes('user is deactivated')) {
                            log.error(`Failed to send to chat ${chatId}: ${error.description}`);
                            await chatCollection.deleteOne({ chatId });
                            log.warn(`Deleted chat ${chatId} from database`);
                            break;
                        }

                        log.error(`Send message error for chat ${chatId}:`, {
                            message: error.message,
                            code: error.code,
                            errorCode: error.error_code,
                            description: error.description,
                            stack: error.stack?.split('\n')[0],
                            type: error.constructor.name
                        });

                        if (error.message?.includes('Network request') || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                            log.warn(`Network error occurred, will retry in next cycle for ${chatId}`);
                        }
                    }
                }
            } catch (err) {
                log.error(`Error processing ${rssUrl} for chat ${chatId}:`, {
                    message: err.message,
                    stack: err.stack?.split('\n')[0],
                    type: err.constructor.name
                });
            }
        }
    }
};

let isProcessing = false;

export async function startCycle() {
    if (isProcessing) return;
    isProcessing = true;
    try {
        log.start('Starting RSS update cycle...');
        await sendRssUpdates();
    } catch (err) {
        log.error('Error in sendRssUpdates:', err);
    } finally {
        isProcessing = false;
        log.success('Cycle complete. Waiting 10 seconds before starting next cycle...');
        setTimeout(startCycle, 10 * 1000);
    }
}