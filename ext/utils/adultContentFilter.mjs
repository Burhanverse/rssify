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
            'porn', 'simp', 'xxx', 'adult', 'sex', 'nude', 'naked',
            'hentai', 'nsfw', 'erotic', 'sexy', '18plus', 'erotic',
            'porno', 'fap', 'masturbation', 'orgasm', 'fetish',
            'bondage', 'kink', 'camgirl', 'webcam', 'strip',
            'bukkake', 'milf', 'dilf', 'escort', 'hooker', 'rule34',
            'swinger', 'threesome', 'gangbang', 'anal', 'blowjob',
            'ecchi', 'yaoi', 'yuri', 'lewd', 'hardcore', 'thots',
            'softcore', 'onlyfans', 'fansly', 'fanvue', 'chaturbate', 'livejasmin'
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
    const commandParts = ctx.message?.text?.split(' ');
    if (!commandParts || commandParts.length < 2) {
        return next();
    }
    const rssUrl = commandParts[1];

    if (!rssUrl.startsWith('http://') && !rssUrl.startsWith('https://')) {
        return next();
    }

    if (isAdultSite(rssUrl)) {
        log.warn(`Blocked adult content URL attempt by user ${ctx.from?.id}: ${rssUrl}`);
        await ctx.reply('⚠️ <i>Adult or inappropriate content is not allowed. Please add appropriate RSS feeds only.</i>',
            { parse_mode: 'HTML' });
        return;
    }

    return next();
};