import { Bot } from "grammy";
import { chatCollection } from '../utils/db.mjs';
import dotenv from 'dotenv';
import { log } from "../utils/colorLog.mjs";

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

// Initialize bot
const bot = new Bot(BOT_TOKEN);

export const alertSender = async (ctx) => {
    try {
        await ctx.react('🍾');
    } catch (error) {
        log.warn("Unable to react to message:", error.description || error.message);
    }

    const chatId = ctx.chat.id.toString();
    const authorizedUser = process.env.OWNER_ID;

    if (chatId !== authorizedUser) {
        return ctx.reply('<i>Reserved for owner only</i>',
            { parse_mode: 'HTML' }
        );
    }

    const originalMessage = ctx.message.reply_to_message;
    if (!originalMessage) {
        return ctx.reply('<i>Please reply to a message you want to forward.</i>',
            { parse_mode: 'HTML' }
        );
    }

    const subscribers = await chatCollection.find().toArray();

    let successCount = 0;
    let failCount = 0;

    for (const subscriber of subscribers) {
        try {
            await bot.api.forwardMessage(
                subscriber.chatId,
                ctx.chat.id,
                originalMessage.message_id,
                subscriber.topicId ? { message_thread_id: parseInt(subscriber.topicId) } : {}
            );
            successCount++;
        } catch (error) {
            if (error.error_code === 403 || error.description?.includes('bot was blocked') ||
                error.description?.includes('chat not found') || error.description?.includes('user is deactivated')) {
                log.error(`Failed to send to chat ${subscriber.chatId}: ${error.description}`);
                await chatCollection.deleteOne({ chatId: subscriber.chatId });
                log.debug(`Deleted chat ${subscriber.chatId} from database`);
            } else {
                log.error('Send message error:', error.message);
            }
            failCount++;
        }
    }

    return ctx.reply(`<i>Alert forwarded to ${successCount} chats.\n${failCount} failed.</i>`,
        { parse_mode: 'HTML' }
    );
}