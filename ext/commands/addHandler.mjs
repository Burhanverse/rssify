import { Bot, InlineKeyboard } from 'grammy';
import dotenv from 'dotenv';
import { fetchRss } from "../utils/parserApi.mjs";
import { chatCollection } from "../utils/db.mjs";
import { updateLastLog } from "../utils/middlewares.mjs";
import { escapeHTML } from "../utils/escapeHelper.mjs";
import { log } from '../utils/colorLog.mjs';

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
    }); inlin

    const latestItem = items[0];
    await updateLastLog(chatId, rssUrl, [latestItem]);

    const message = `<b>${escapeHTML(latestItem.title)}</b><a href="${escapeHTML(latestItem.link)}">​</a>`;
    
    // inline keyboard with Source button
    const keyboard = new InlineKeyboard()
      .url('Source', latestItem.link);
    
    await bot.api.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
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