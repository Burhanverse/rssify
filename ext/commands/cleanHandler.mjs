import { Bot } from "grammy";
import { chatCollection } from '../utils/db.mjs';
import dotenv from 'dotenv';
import { log } from "../utils/colorLog.mjs";

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

const bot = new Bot(BOT_TOKEN);

function extractDomain(url) {
    try {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        const parsedUrl = new URL(url);
        return parsedUrl.hostname.toLowerCase();
    } catch (e) {
        return url.toLowerCase();
    }
}

function domainsMatch(feedDomain, targetDomain) {
    const normalizedFeedDomain = feedDomain.replace(/^www\./, '');
    const normalizedTargetDomain = targetDomain.replace(/^www\./, '');
    
    if (normalizedFeedDomain === normalizedTargetDomain) {
        return true;
    }
    
    if (normalizedFeedDomain.endsWith('.' + normalizedTargetDomain)) {
        return true;
    }
    
    const targetParts = normalizedTargetDomain.split('.');
    
    if (targetParts.length >= 2) {
        const targetBaseDomain = targetParts.slice(-2).join('.');
        return normalizedFeedDomain.endsWith(targetBaseDomain);
    }
    
    return false;
}

export const cleanCmd = async (ctx) => {
    try {
        await ctx.react('👨‍💻');
    } catch (error) {
        log.warn("Unable to react to message:", error.description || error.message);
    }

    const chatId = ctx.chat.id.toString();
    const authorizedUser = process.env.OWNER_ID?.trim();

    log.debug(`Checking auth - Chat ID: ${chatId}, Owner ID: ${authorizedUser}`);

    if (chatId !== authorizedUser && ctx.from.id.toString() !== authorizedUser) {
        return ctx.reply('<i>Reserved for owner only</i>', 
            { parse_mode: 'HTML' }
        );
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply('<i>Usage: /clean domain.example</i>', 
            { parse_mode: 'HTML' }
        );
    }

    const domainToClean = extractDomain(args[1]);
    log.warn(`Starting cleanup of domain: ${domainToClean}`);

    try {
        const chats = await chatCollection.find({ 
            rssFeeds: { $exists: true, $not: { $size: 0 } } 
        }).toArray();

        let totalFeedsRemoved = 0;
        let chatsAffected = 0;
        let removedFeedsList = [];

        for (const chat of chats) {
            if (!chat.rssFeeds || chat.rssFeeds.length === 0) continue;
            
            const feedsToRemove = chat.rssFeeds.filter(feed => {
                try {
                    const feedDomain = extractDomain(feed);
                    return domainsMatch(feedDomain, domainToClean);
                } catch (error) {
                    log.error(`Error processing feed URL ${feed}: ${error.message}`);
                    return false;
                }
            });
            
            if (feedsToRemove.length > 0) {
                const result = await chatCollection.updateOne(
                    { chatId: chat.chatId },
                    { $pull: { rssFeeds: { $in: feedsToRemove } } }
                );
                
                if (result.modifiedCount > 0) {
                    totalFeedsRemoved += feedsToRemove.length;
                    chatsAffected++;
                    
                    log.info(`Removed ${feedsToRemove.length} feeds from chat ${chat.chatId}`);
                    feedsToRemove.forEach(feed => {
                        log.debug(`Removed: ${feed}`);
                        removedFeedsList.push(feed);
                    });
                }
            }
        }

        const feedSamples = removedFeedsList.slice(0, 5).map(f => `• ${f}`).join('\n');
        const hasMoreFeeds = removedFeedsList.length > 5;

        return ctx.reply(
            `<b><i>Domain cleanup complete:</i></b>\n` +
            `<b>Domain:</b> ${domainToClean}\n` +
            `<b>Feeds removed:</b> ${totalFeedsRemoved}\n` +
            `<b>Chats affected:</b> ${chatsAffected}` +
            (feedSamples ? `\n\n<b>Removed feeds:</b>\n${feedSamples}` : '') +
            (hasMoreFeeds ? `\n<i>...and ${removedFeedsList.length - 5} more</i>` : ''),
            { parse_mode: 'HTML', disable_web_page_preview: true }
        );
    } catch (error) {
        log.error('Error during domain cleanup:', error);
        return ctx.reply(`<i>Error during cleanup: ${error.message}</i>`, 
            { parse_mode: 'HTML' }
        );
    }
};