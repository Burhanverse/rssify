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
        const preprocessedContent = content.replace(
            /(xmlUrl=["'][^"']*)&(?!amp;|lt;|gt;|quot;|apos;|#)([^"']*?=)/g,
            (match, p1, p2) => `${p1}&amp;${p2}`
        );

        const parser = new xml2js.Parser({
            explicitArray: false,
            normalizeTags: true,
        });

        const result = await parser.parseStringPromise(preprocessedContent);
        let urls = [];

        const processOutline = (outline) => {
            if (!outline) return;

            if (outline.$ && outline.$.type === 'rss' && outline.$.xmlurl) {
                try {
                    const decodedUrl = outline.$.xmlurl
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&apos;/g, "'");
                    urls.push(decodedUrl);
                } catch (decodeError) {
                    log.warn(`Failed to decode URL after parsing: ${outline.$.xmlurl}`, decodeError);
                    urls.push(outline.$.xmlurl);
                }
            }

            if (outline.outline) {
                if (Array.isArray(outline.outline)) {
                    outline.outline.forEach(item => processOutline(item));
                } else {
                    processOutline(outline.outline);
                }
            }
        };

        if (result.opml && result.opml.body) {
            if (Array.isArray(result.opml.body)) {
                result.opml.body.forEach(body => {
                    if (body.outline) {
                        if (Array.isArray(body.outline)) {
                            body.outline.forEach(outline => processOutline(outline));
                        } else {
                            processOutline(body.outline);
                        }
                    }
                });
            } else if (result.opml.body.outline) {
                if (Array.isArray(result.opml.body.outline)) {
                    result.opml.body.outline.forEach(outline => processOutline(outline));
                } else {
                    processOutline(result.opml.body.outline);
                }
            }
        }

        if (urls.length === 0) {
            log.warn('Standard parsing found no URLs, trying fallback extraction');
            const extractedUrls = [];
            const xmlUrlRegex = /xmlUrl=["']([^"']+)["']/gi;
            let match;
            while ((match = xmlUrlRegex.exec(content)) !== null) {
                if (match[1] && match[1].trim()) {
                    try {
                        const decodedUrl = match[1].trim()
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&quot;/g, '"')
                            .replace(/&apos;/g, "'");
                        extractedUrls.push(decodedUrl);
                    } catch (decodeError) {
                        log.warn(`Failed to decode regex-extracted URL: ${match[1].trim()}`, decodeError);
                        extractedUrls.push(match[1].trim());
                    }
                }
            }
            urls = extractedUrls;
        }

        return [...new Set(urls)].filter(url => {
            try {
                new URL(url);
                return true;
            } catch (e) {
                log.warn(`Invalid URL skipped: ${url}`);
                return false;
            }
        });
    } catch (err) {
        log.error('OPML parsing error:', err);

        try {
            log.warn('XML parsing failed, attempting regex-based extraction');
            const urls = [];
            const xmlUrlRegex = /xmlUrl=["']([^"']+)["']/gi;
            let match;
            while ((match = xmlUrlRegex.exec(content)) !== null) {
                if (match[1] && match[1].trim()) {
                    try {
                        const decodedUrl = match[1].trim()
                            .replace(/&amp;/g, '&')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                            .replace(/&quot;/g, '"')
                            .replace(/&apos;/g, "'");
                        urls.push(decodedUrl);
                    } catch (decodeError) {
                        log.warn(`Failed to decode regex-extracted URL during fallback: ${match[1].trim()}`, decodeError);
                        urls.push(match[1].trim());
                    }
                }
            }

            return [...new Set(urls)].filter(url => {
                try {
                    new URL(url);
                    return true;
                } catch (e) {
                    return false;
                }
            });
        } catch (regexErr) {
            log.error('Regex extraction failed:', regexErr);
            return [];
        }
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
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const fileName = `rssify_export_${year}-${month}-${day}.opml`;
        const filePath = path.join(__dirname, fileName);
        const dirPath = path.dirname(filePath);
        fs.mkdirSync(dirPath, { recursive: true });

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
        const addedUrls = [];

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
                addedUrls.push(url);
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

        const urlList = addedUrls.map(url => `• ${url}`).join('\n');
        
        let message =
            `<b>Imported ${added} feed${added > 1 ? 's' : ''}</b>\n\n` +
            `<u>Added feeds:</u>\n${urlList}\n\n` +
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
