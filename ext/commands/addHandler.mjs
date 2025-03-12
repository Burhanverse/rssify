import { Bot } from 'grammy';
import dotenv from 'dotenv';
import { fetchRss } from "../parserApi.mjs";
import { chatCollection } from "../db.mjs";
import { updateLastLog } from "../middlewares.mjs";
import { escapeHTML } from "../escapeHelper.mjs";
import { log } from '../colorLog.mjs';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

const bot = new Bot(BOT_TOKEN);

export const addCmd = async (ctx) => {
  try {
    await ctx.react('❤‍🔥');
  } catch (error) {
    log.warn("Unable to react to message:", error.description || error.message);
  }

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
    log.success(`Chat ${chatId} added a new feed URL: ${rssUrl}`);

  } catch (err) {
    ctx.reply(`<i>Failed to add feed</i>: ${escapeHTML(err.message)}`, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }
}