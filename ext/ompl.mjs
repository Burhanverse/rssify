// ompl.mjs - Extension Module for OMPL Import/Export
import { InputFile } from 'grammy';
import xml2js from 'xml2js';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { chatCollection } from './db.mjs';
import dotenv from 'dotenv';

dotenv.config();

const botToken = process.env.TOKEN;
if (!botToken) throw new Error("TOKEN is not set");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const escapeXML = (str) => {
    return str.replace(/[<>"']/g, (char) => {
        switch (char) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&apos;';
            default: return char;
        }
    });
};

// Generate OMPL content from Feed list
const generateOpml = (urls) => `<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
  <head>
    <title>rssify export</title>
  </head>
  <body>
    ${urls.map(url => `<outline type="rss" xmlUrl="${escapeXML(url)}" />`).join('\n    ')}
  </body>
</opml>`;

//  OMPL Parser
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
        console.error('OPML parsing error:', err);
        return [];
    }
};

// Export handler
export const handleExport = async (ctx) => {
    const chatId = ctx.chat.id.toString();
    try {
        const chat = await chatCollection.findOne({ chatId });
        if (!chat?.rssFeeds?.length) {
            return ctx.reply("<i>No subscriptions to export</i>", { parse_mode: 'HTML' });
        }

        const opmlContent = generateOpml(chat.rssFeeds);
        const fileName = `rss_export_${Date.now()}.opml`;
        const filePath = path.join(__dirname, fileName);

        fs.writeFileSync(filePath, opmlContent);
        await ctx.replyWithDocument(new InputFile(filePath, fileName), {
            caption: '<i>Feeds subscription export</i> 📥\nReply to OMPL file with /import to restore',
            parse_mode: 'HTML'
        });
        fs.unlinkSync(filePath);
    } catch (err) {
        console.error('Export failed:', err);
        ctx.reply("<i>Failed to generate export file</i>", { parse_mode: 'HTML' });
    }
};

// Import handler
export const handleImport = async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const repliedMessage = ctx.message.reply_to_message;

    if (!repliedMessage?.document) {
        return ctx.reply("<i>Reply to an OMPL file with /import</i>", { parse_mode: 'HTML' });
    }

    try {
        const fileInfo = await ctx.api.getFile(repliedMessage.document.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.file_path}`;

        const response = await axios.get(fileUrl);
        const urls = await parseOpml(response.data);

        if (!urls.length) {
            return ctx.reply("<i>No valid RSS feeds found in file</i>", { parse_mode: 'HTML' });
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

        let message = `<i>Imported ${added} feeds</i>`;
        if (errors.length) {
            message += `\n\nErrors (${errors.length}):\n${errors.slice(0, 3).join('\n')}`;
        }

        ctx.reply(message, { parse_mode: 'HTML' });
    } catch (err) {
        console.error('Import error:', err);
        ctx.reply("<i>Invalid OMPL file format</i>", { parse_mode: 'HTML' });
    }
};
