import { log } from '../utils/colorLog.mjs';
import { chatCollection } from '../utils/db.mjs';

export const pauseCmd = async (ctx) => {
    try {
        await ctx.react('🤨');
    } catch (error) {
        log.warn("Unable to react to message:", error.description || error.message);
    }

    const chatId = ctx.chat.id.toString();

    const chat = await chatCollection.findOne({ chatId });
    if (!chat) {
        return ctx.reply("<i>No subscription found.</i>", { parse_mode: 'HTML' });
    }

    if (chat.isPaused) {
        return ctx.reply("<i>Feed updates are already paused.</i>", { parse_mode: 'HTML' });
    }

    await chatCollection.updateOne({ chatId }, { $set: { isPaused: true } });

    ctx.reply("<i>Feed updates have been paused.</i>", { parse_mode: 'HTML' });
};

export const resumeCmd = async (ctx) => {
    try {
        await ctx.react('😁');
    } catch (error) {
        log.warn("Unable to react to message:", error.description || error.message);
    }

    const chatId = ctx.chat.id.toString();

    const chat = await chatCollection.findOne({ chatId });
    if (!chat) {
        return ctx.reply("<i>No subscription found.</i>", { parse_mode: 'HTML' });
    }

    if (!chat.isPaused) {
        return ctx.reply("<i>Feed updates are already active.</i>", { parse_mode: 'HTML' });
    }

    await chatCollection.updateOne({ chatId }, { $set: { isPaused: false } });

    ctx.reply("<i>Feed updates have been resumed.</i>", { parse_mode: 'HTML' });
};

// Function to check if updates are paused for a chat
export const isFeedPaused = async (chatId) => {
    const chat = await chatCollection.findOne({ chatId });
    return chat?.isPaused || false;
};