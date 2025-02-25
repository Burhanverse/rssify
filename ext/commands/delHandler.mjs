import { escapeHTML } from '../escapeHelper.mjs';
import { chatCollection, logCollection } from '../db.mjs';

export const delCmd = async (ctx) => {
  await ctx.react('😨');
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