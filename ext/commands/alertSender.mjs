import { Bot } from "grammy";
import { chatCollection } from '../db.mjs';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

// Initialize bot
const bot = new Bot(BOT_TOKEN);

export const alertSender = async (ctx) => {
    await ctx.react('🍾');
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

    for (const subscriber of subscribers) {
        try {
            await bot.api.forwardMessage(subscriber.chatId, chatId, originalMessage.message_id);
        } catch (error) {
            if (error.on?.payload?.chat_id) {
                console.error(`Failed to send to chat ${error.on.payload.chat_id}`);
                await chatCollection.deleteOne({ chatId: subscriber.chatId });
                console.log(`Deleted chat ${subscriber.chatId} from database`);
                break;
            }
            console.error('Send message error:', error.message);
        }
    }

    ctx.reply('<i>Message forwarded successfully.</i>',
        { parse_mode: 'HTML' }
    );
}