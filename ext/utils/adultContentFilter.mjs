import { chatCollection, logCollection } from './db.mjs';
import { escapeHTML } from './escapeHelper.mjs';
import { log } from './colorLog.mjs';
import { Bot } from 'grammy';
import dotenv from 'dotenv';

dotenv.config();
const BOT_TOKEN = process.env.TOKEN;
const bot = new Bot(BOT_TOKEN);

/**
 * Checks if a URL points to an adult site
 * @param {string} url - URL to check
 * @returns {boolean} - True if detected, false otherwise
 */
export const isAdultSite = (url) => {
    try {
        const urlLower = url.toLowerCase();
        const parsedUrl = new URL(urlLower);
        const domain = parsedUrl.hostname;

        const adultDomains = [
            'pornhub.com', 'xvideos.com', 'xnxx.com', 'redtube.com',
            'youporn.com', 'xhamster.com', 'spankbang.com', 'tube8.com',
            'brazzers.com', 'onlyfans.com', 'playboy.com', 'chaturbate.com',
            'livejasmin.com', 'bongacams.com', 'stripchat.com', 'cam4.com',
            'flirt4free.com', 'adultfriendfinder.com',
            'manyvids.com', 'camsoda.com', 'myfreecams.com', 'naughtyamerica.com',
            'realitykings.com', 'mofos.com', 'bangbros.com', 'tushy.com',
            'vixen.com', 'blacked.com', 'digitalplayground.com', 'x-art.com',
            'youjizz.com', 'daftsex.com', 'eporner.com', 'hqporner.com',
            'keezmovies.com', 'nudevista.com', 'porntube.com', 'sex.com'
        ];

        if (adultDomains.some(blockedDomain =>
            domain === blockedDomain || domain.endsWith('.' + blockedDomain))) {
            return true;
        }

        const adultKeywords = [
            'porn', 'xxx', 'adult', 'sex', 'nude', 'naked',
            'hentai', 'nsfw', 'erotic', 'sexy', '18plus',
            'porno', 'fap', 'masturbation', 'orgasm', 'fetish',
            'bondage', 'kink', 'camgirl', 'webcam', 'strip',
            'bukkake', 'milf', 'dilf', 'escort', 'hooker',
            'swinger', 'threesome', 'gangbang', 'anal', 'blowjob',
            'ecchi', 'yaoi', 'yuri', 'lewd', 'hardcore',
            'softcore', 'onlyfans', 'chaturbate', 'livejasmin'
        ];

        if (adultKeywords.some(keyword => domain.includes(keyword) || urlLower.includes(keyword))) {
            return true;
        }

        return false;
    } catch (err) {
        log.error(`Error parsing URL ${url}: ${err.message}`);
        return false;
    }
};

export const adultContentFilter = async (ctx, next) => {
    const rssUrl = ctx.message.text.split(' ')[1];
    if (!rssUrl) {
        return next();
    }

    if (isAdultSite(rssUrl)) {
        await ctx.reply('⚠️ <i>Adult or inappropriate content is not allowed. Please add appropriate RSS feeds only.</i>',
            { parse_mode: 'HTML' });
        return;
    }

    return next();
};

export const scanForAdultContent = async () => {
    log.info('Scanning for adult content in existing feeds...');
    const chats = await chatCollection.find({ rssFeeds: { $exists: true, $not: { $size: 0 } } }).toArray();
    let totalRemoved = 0;

    for (const { chatId, rssFeeds } of chats) {
        if (!Array.isArray(rssFeeds)) continue;

        const adultFeeds = rssFeeds.filter(url => isAdultSite(url));

        if (adultFeeds.length > 0) {
            log.warn(`Found ${adultFeeds.length} adult feeds in chat ${chatId}`);

            for (const adultUrl of adultFeeds) {
                try {
                    await chatCollection.updateOne(
                        { chatId },
                        { $pull: { rssFeeds: adultUrl } }
                    );
                    await logCollection.deleteOne({ chatId, rssUrl: adultUrl });

                    await bot.api.sendMessage(
                        chatId,
                        `⚠️ <i>A feed with inappropriate content was found and removed: ${escapeHTML(adultUrl)}.\nPlease do not add adult content as it violates our usage policy.</i>`,
                        {
                            parse_mode: 'HTML',
                            disable_web_page_preview: true
                        }
                    );
                    log.warn(`Removed adult feed ${adultUrl} from chat ${chatId}`);
                    totalRemoved++;
                } catch (error) {
                    log.error(`Error removing adult feed ${adultUrl} from chat ${chatId}:`, error.message);
                }
            }
        }
    }

    if (totalRemoved > 0) {
        log.warn(`Total adult feeds removed: ${totalRemoved}`);
    } else {
        log.success('No adult feeds found in scan');
    }
};