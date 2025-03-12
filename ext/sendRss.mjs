import { Bot } from 'grammy';
import dotenv from 'dotenv';
import { fetchRss } from './parserApi.mjs';
import { chatCollection } from './db.mjs';
import { escapeHTML } from './escapeHelper.mjs';
import { isFeedPaused } from './commands/feedHandler.mjs';
import { updateLastLog, getLastLog, delay, rateLimitSending } from './middlewares.mjs';

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

        // Check if feed updates are paused for this chat
        const paused = await isFeedPaused(chatId);
        if (paused) {
            console.log(`Feed updates are paused for chat ${chatId}. Skipping.`);
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
                        await rateLimitSending(chatId, async () => {
                            return await bot.api.sendMessage(chatId, message, {
                                parse_mode: 'HTML',
                                ...(topicId && { message_thread_id: parseInt(topicId) }),
                            });
                        });

                        await updateLastLog(chatId, rssUrl, [item]);
                        console.log(`Sent content in chat ${chatId} for ${rssUrl}`);
                        await delay(1000); // 1sec delay.
                    } catch (error) {
                        if (error.error_code === 403 || error.description?.includes('bot was blocked') ||
                            error.description?.includes('chat not found') || error.description?.includes('user is deactivated')) {
                            console.error(`Failed to send to chat ${chatId}: ${error.description}`);
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

export async function startCycle() {
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