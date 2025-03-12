// opml.mjs - Extension Module for OPML Import/Export
import { InputFile } from 'grammy';
import xml2js from 'xml2js';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { chatCollection } from '../utils/db.mjs';
import { escapeXML } from '../utils/escapeHelper.mjs';
import dotenv from 'dotenv';
import { log } from '../utils/colorLog.mjs';

dotenv.config();

const botToken = process.env.TOKEN;
if (!botToken) throw new Error("TOKEN is not set");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Generate OPML content from Feed list
const generateOpml = (urls, options = {}) => {
    const {
        name = "rssify",
        id = "https://github.com/Burhanverse/rssify",
        date = new Date()
    } = options;

    const formatDateRFC822 = (date) => {
        return date.toUTCString();
    };

    return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXML(options.title || "rssify subscriptions")}</title>
    <ownerName>${escapeXML(name)}</ownerName>
    <ownerId>${escapeXML(id)}</ownerId>
    <dateCreated>
      ${formatDateRFC822(date)}
    </dateCreated>
  </head>
  <body>
    ${urls.map(url => `<outline type="rss" xmlUrl="${escapeXML(url)}" />`).join('\n    ')}
  </body>
</opml>`;
};


//  OPML Parser
const parseOpml = async (content) => {
    try {
        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(content);
        const urls = [];

        const processOutline = (outline) => {
            if (outline.$.type === 'rss' && outline.$.xmlUrl) {
                urls.push(outline.$.xmlUrl);
            }
            if (outline.outline) {
                outline.outline.forEach(processOutline);
            }
        };

        result.opml.body[0].outline.forEach(processOutline);
        return [...new Set(urls)]; // Return unique URLs
    } catch (err) {
        log.error('OPML parsing error:', err);
        return [];
    }
};

// Export handler
export const handleExport = async (ctx) => {
    const chatId = ctx.chat.id.toString();
    try {
        try {
            await ctx.react("🗿");
        } catch (error) {
            log.warn("Unable to react to message:", error.description || error.message);
        }

        const chat = await chatCollection.findOne({ chatId });
        if (!chat?.rssFeeds?.length) {
            return ctx.reply("<i>No subscriptions to export</i>", { parse_mode: 'HTML' });
        }

        const opmlContent = generateOpml(chat.rssFeeds);
        const fileName = `rssify_export_${Date.now()}.opml`;
        const filePath = path.join(__dirname, fileName);

        fs.writeFileSync(filePath, opmlContent);
        const replyOptions = {
            caption: `📥 <i>${chat.rssFeeds.length} feeds exported successfully!</i>`,
            parse_mode: 'HTML'
        };
        if (ctx.message?.message_thread_id) {
            replyOptions.message_thread_id = ctx.message.message_thread_id;
        }
        await ctx.replyWithDocument(new InputFile(filePath, fileName), replyOptions);
        fs.unlinkSync(filePath);
    } catch (err) {
        log.error('Export failed:', err);
        ctx.reply("<i>Failed to generate export file</i>", { parse_mode: 'HTML' });
    }
};

// Import handler
export const handleImport = async (ctx) => {
    try {
        await ctx.react("👨‍💻");
    } catch (error) {
        log.warn("Unable to react to message:", error.description || error.message);
    }

    const chatId = ctx.chat.id.toString();
    const repliedMessage = ctx.message.reply_to_message;

    if (!repliedMessage?.document) {
        return ctx.reply("<i>Reply to an OPML file with /import</i>", { parse_mode: 'HTML' });
    }

    try {
        const fileInfo = await ctx.api.getFile(repliedMessage.document.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

        const response = await axios.get(fileUrl);
        const urls = await parseOpml(response.data);

        if (!urls.length) {
            return ctx.reply("<i>No valid feeds found in file</i>", { parse_mode: 'HTML' });
        }

        let added = 0;
        const errors = [];

        for (const url of urls) {
            try {
                const exists = await chatCollection.findOne({
                    chatId,
                    rssFeeds: url
                });

                if (exists) continue;

                await chatCollection.updateOne(
                    { chatId },
                    { $addToSet: { rssFeeds: url } },
                    { upsert: true }
                );
                added++;
            } catch (err) {
                errors.push(`Failed ${url}: ${err.message}`);
            }
        }

        if (added === 0) {
            try {
                await ctx.reply("<i>Nothing to import</i>", { parse_mode: 'HTML' });
            } catch (replyErr) {
                if (replyErr.description && replyErr.description.includes("message thread not found")) {
                    await ctx.api.sendMessage(ctx.chat.id, "<i>Nothing to import</i>", {
                        parse_mode: 'HTML'
                    });
                } else {
                    throw replyErr;
                }
            }
            return;
        }

        let message =
            `<b>Imported ${added} feed</b>\n\n` +
            `<i>Reply with /list to view your subscriptions</i>\n` +
            `<i>Updates for the new feeds will be sent in a few minutes.</i>\n\n` +
            `<a href="burhanverse.t.me"><i>Prjkt:Sid.</i></a>`;
        if (errors.length) {
            message += `\n\nErrors (${errors.length}):\n${errors.slice(0, 3).join('\n')}`;
        }

        try {
            await ctx.reply(message, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });
        } catch (replyErr) {
            if (replyErr.description && replyErr.description.includes("message thread not found")) {
                await ctx.api.sendMessage(ctx.chat.id, message, {
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                });
            } else {
                throw replyErr;
            }
        }
    } catch (err) {
        log.error('Import error:', err);
        try {
            await ctx.reply("<i>Invalid OPML file format</i>", { parse_mode: 'HTML' });
        } catch (replyErr) {
            if (replyErr.description && replyErr.description.includes("message thread not found")) {
                await ctx.api.sendMessage(ctx.chat.id, "<i>Invalid OPML file format</i>", {
                    parse_mode: 'HTML'
                });
            } else {
                log.error('Reply error:', replyErr);
            }
        }
    }
};
