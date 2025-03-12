import { Bot } from 'grammy';
import { chatCollection } from '../utils/db.mjs';
import dotenv from 'dotenv';
import { log } from '../utils/colorLog.mjs';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

// Initialize bot
const bot = new Bot(BOT_TOKEN);

export const startCmd = async (ctx) => {
  try {
    try {
      await ctx.react("😍");
    } catch (error) {
      log.warn("Unable to react to message:", error.description || error.message);
    }

    const extraOptions = {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(ctx.message?.message_thread_id && { message_thread_id: ctx.message.message_thread_id })
    };

    await bot.api.sendMessage(
      ctx.chat.id,
      '<b><i>RSS-ify brings you the latest updates from your favorite feeds right into Telegram, hassle-free!</i></b>\n\n' +
      '🌐 <b>Homepage:</b> <a href="burhanverse.eu.org/blog/rssify"><i>visit now!</i></a>\n\n' +
      '<a href="burhanverse.t.me"><i>Prjkt:Sid.</i></a>',
      extraOptions
    );
  } catch (error) {
    if (error.on?.payload?.chat_id) {
      const chatId = error.on.payload.chat_id;
      log.error(`Failed to send to chat ${chatId}`);
      await chatCollection.deleteOne({ chatId });
      log.debug(`Deleted chat ${chatId} from database`);
      return;
    }
    log.error('Send message error:', error.message);
  }
}