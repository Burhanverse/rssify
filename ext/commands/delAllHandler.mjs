import { InputFile } from 'grammy';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chatCollection, logCollection } from '../db.mjs';
import { escapeXML } from '../escapeHelper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const delAllCmd = async (ctx) => {
    await ctx.react('😱');
    const chatId = ctx.chat.id.toString();

    const chat = await chatCollection.findOne({ chatId });
    if (!chat?.rssFeeds?.length) {
        return ctx.reply("<i>You don't have any subscribed feeds to delete.</i>", { parse_mode: 'HTML' });
    }

    const feedCount = chat.rssFeeds.length;
    const feeds = [...chat.rssFeeds];

    try {
        const formatDateRFC822 = (date) => {
            return date.toUTCString();
        };

        const opmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${escapeXML("rssify subscriptions backup")}</title>
    <ownerName>${escapeXML("rssify")}</ownerName>
    <ownerId>${escapeXML("https://github.com/Burhanverse/rssify")}</ownerId>
    <dateCreated>
      ${formatDateRFC822(new Date())}
    </dateCreated>
  </head>
  <body>
    ${feeds.map(url => `<outline type="rss" xmlUrl="${escapeXML(url)}" />`).join('\n    ')}
  </body>
</opml>`;

        const fileName = `rssify_backup_${Date.now()}.opml`;
        const filePath = path.join(__dirname, fileName);

        fs.writeFileSync(filePath, opmlContent);
        const replyOptions = {
            caption: `📥 <i>Backup created with ${feedCount} feeds.</i>`,
            parse_mode: 'HTML'
        };
        if (ctx.message?.message_thread_id) {
            replyOptions.message_thread_id = ctx.message.message_thread_id;
        }
        await ctx.replyWithDocument(new InputFile(filePath, fileName), replyOptions);

        fs.unlinkSync(filePath);

        await chatCollection.updateOne(
            { chatId },
            { $set: { rssFeeds: [] } }
        );

        await logCollection.deleteMany({ chatId });

        return ctx.reply(`<i>The feeds have been successfully deleted.</i>`, {
            parse_mode: 'HTML'
        });

    } catch (err) {
        console.error('Feed deletion failed:', err);
        return ctx.reply("<i>Failed to delete feeds. Please try again later.</i>", {
            parse_mode: 'HTML'
        });
    }
};
