import dotenv from 'dotenv';
import { InlineKeyboard } from 'grammy';
import { log } from './colorLog.mjs';

dotenv.config();

const CH1 = process.env.CH1;
const CH2 = process.env.CH2;
const CH3 = process.env.CH3;

const requiredChannels = [
    { id: CH1?.split('/').pop(), url: CH1 },
    { id: CH2?.split('/').pop(), url: CH2 },
    { id: CH3?.split('/').pop(), url: CH3 },
].filter(channel => channel.id && channel.url);

const isSubscribed = async (bot, channelId, userId) => {
    try {
        const formattedChannelId = channelId.startsWith('@') ? channelId : `@${channelId}`;
        const member = await bot.api.getChatMember(formattedChannelId, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (error) {
        log.error(`Failed to check membership for channel ${channelId}:`, error);
        return false;
    }
};

export const createSubscriptionMiddleware = (bot) => {
    return async (ctx, next) => {
        try {
            const userId = ctx.from.id;

            const notSubscribedChannels = [];
            for (const channel of requiredChannels) {
                const subscribed = await isSubscribed(bot, channel.id, userId);
                if (!subscribed) {
                    notSubscribedChannels.push(channel);
                }
            }

            if (notSubscribedChannels.length === 0) {
                return next();
            }

            const keyboard = new InlineKeyboard();

            const channelCount = notSubscribedChannels.length;
            for (let i = 0; i < channelCount; i++) {
                const channel = notSubscribedChannels[i];
                keyboard.url(`Join @${channel.id}`, channel.url);
                if (i < 2 && i < channelCount - 1) {
                    keyboard.row();
                }
            }

            await ctx.reply("Please join the following channels to continue:", {
                reply_markup: keyboard
            });

        } catch (error) {
            log.error("Error in subscription middleware:", error);
            await ctx.reply("An error occurred. Please try again later.");
        }
    };
};

export const checkSubscription = async (ctx, next, bot) => {
    const middleware = createSubscriptionMiddleware(bot);
    return middleware(ctx, next);
};
