// listHandler.mjs
import { InlineKeyboard } from 'grammy';
import { escapeHTML } from '../escapeHelper.mjs';
import { chatCollection } from '../db.mjs';
import { log } from '../colorLog.mjs';

// Utility function to split an array into chunks of a given size.
export function chunkArray(arr, chunkSize) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
}

// Format the current page of feed URLs into a message.
export function formatPage(feedsChunk, currentPage, totalPages) {
    const feeds = feedsChunk
        .map((url, index) => {
            const number = currentPage * 15 + index + 1;
            let linkTitle;
            try {
                const parsedUrl = new URL(url);
                linkTitle = parsedUrl.hostname;
            } catch (error) {
                linkTitle = url;
            }
            const escapedUrl = escapeHTML(url);
            const escapedTitle = escapeHTML(linkTitle);
            return `${number}. <b><a href="${escapedUrl}">${escapedTitle}</a></b>\n ╰➤ <code>${escapedUrl}</code>`;
        })
        .join('\n');

    return `<b><i>Your Subscribed feeds (Page ${currentPage + 1} of ${totalPages})</i></b>:\n\n${feeds}\n\n<a href="https://t.me/burhanverse"><i>Prjkt:Sid.</i></a>`;
}

// Build the pagination keyboard for navigating between pages.
export function buildPaginationKeyboard(currentPage, totalPages) {
    const keyboard = new InlineKeyboard();

    if (currentPage > 0) {
        keyboard.text('⬅  Previous', `list_prev_${currentPage}`);
    }
    if (currentPage < totalPages - 1) {
        keyboard.text('Next  ➡', `list_next_${currentPage}`);
    }

    return keyboard;
}

// Handler for the '/list' command.
export async function handleList(ctx) {
    try {
        await ctx.react('🥱');
    } catch (error) {
        log.warn("Unable to react to message:", error.description || error.message);
    }

    const chatId = ctx.chat.id.toString();
    const chat = await chatCollection.findOne({ chatId });

    if (!chat?.rssFeeds?.length) {
        return ctx.reply("<i>You haven't Subscribed to a feed yet.</i>", {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
        });
    }

    const feeds = chat.rssFeeds;
    const chunks = chunkArray(feeds, 15);
    const totalPages = chunks.length;
    const currentPage = 0;

    const messageText = formatPage(chunks[currentPage], currentPage, totalPages);
    const keyboard = buildPaginationKeyboard(currentPage, totalPages);

    return ctx.reply(messageText, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: keyboard,
    });
}

// Handler for pagination callback queries.
export async function handlePagination(ctx) {
    const action = ctx.match[1];
    const originalPage = parseInt(ctx.match[2], 10);
    const chatId = ctx.chat.id.toString();

    const chat = await chatCollection.findOne({ chatId });
    if (!chat?.rssFeeds?.length) {
        await ctx.answerCallbackQuery({ text: "No feeds available!" });
        return ctx.deleteMessage();
    }

    const feeds = chat.rssFeeds;
    const chunks = chunkArray(feeds, 15);
    const totalPages = chunks.length;

    // Determine the new page based on the action.
    let newPage = action === 'next' ? originalPage + 1 : originalPage - 1;
    newPage = Math.max(0, Math.min(newPage, totalPages - 1));

    const messageText = formatPage(chunks[newPage], newPage, totalPages);
    const keyboard = buildPaginationKeyboard(newPage, totalPages);

    await ctx.editMessageText(messageText, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: keyboard,
    });
    await ctx.answerCallbackQuery();
}