import { escapeHTML } from '../utils/escapeHelper.mjs';
import { chatCollection, logCollection } from '../utils/db.mjs';
import { log } from '../utils/colorLog.mjs';

export const delCmd = async (ctx) => {
  try {
    await ctx.react('😢');
  } catch (error) {
    log.warn("Unable to react to message:", error.description || error.message);
  }

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
}