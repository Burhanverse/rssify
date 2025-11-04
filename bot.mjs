import dotenv from 'dotenv';
import { Bot } from 'grammy';
import { connectDB } from './ext/utils/db.mjs';
import { startCycle } from "./ext/sendRss.mjs";
import { addCmd } from './ext/commands/addHandler.mjs';
import { delCmd } from './ext/commands/delHandler.mjs';
import { setCmd } from './ext/commands/setHandler.mjs';
import { cleanCmd } from "./ext/commands/cleanHandler.mjs";
import { statsCmd } from './ext/commands/statsHandler.mjs';
import { aboutCmd } from './ext/commands/aboutHandler.mjs';
import { delAllCmd } from './ext/commands/delAllHandler.mjs';
import { alertSender } from './ext/commands/alertSender.mjs';
import { pauseCmd, resumeCmd } from './ext/commands/feedHandler.mjs';
import { adultContentFilter } from './ext/utils/adultContentFilter.mjs';
import { handleExport, handleImport } from './ext/commands/opmlHandler.mjs';
import { handleList, handlePagination } from './ext/commands/listHandler.mjs';
import { isAdmin, spamProtection, handleThreadId, checkFeedLimit } from './ext/utils/middlewares.mjs';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

// Initialize bot
const bot = new Bot(BOT_TOKEN);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

await bot.api.setMyCommands([
  { command: "start", description: "Start RSS-ify..." },
  { command: "add", description: "Add a new feed..." },
  { command: "del", description: "Delete a feed..." },
  { command: "list", description: "List of subscribed feeds..." },
  { command: "set", description: "Set a group topic for feeds..." },
  { command: "del_all", description: "Delete all feeds with backup..." },
  { command: "pause", description: "Pause feed updates..." },
  { command: "resume", description: "Resume feed updates..." },
  { command: "export", description: "Export feeds to OPML..." },
  { command: "import", description: "Import feeds from OPML..." },
  { command: "help", description: "Get some drugs..." },
  { command: "stats", description: "Show bot server stats..." },
  { command: "about", description: "Show information about the bot..." },
  { command: "clean", description: "Clean defunct feeds OWNER ONLY..." },
  { command: "send", description: "Broadcast a message OWNER ONLY..." },
]);

bot.use(handleThreadId);
bot.command('send', alertSender);
bot.command('stats', spamProtection, statsCmd);
bot.command('about', spamProtection, aboutCmd);
bot.command('clean', spamProtection, cleanCmd);
bot.command('del', spamProtection, isAdmin, delCmd);
bot.command('set', spamProtection, isAdmin, setCmd);
bot.command('pause', spamProtection, isAdmin, pauseCmd);
bot.command('start', spamProtection, isAdmin, aboutCmd);
bot.command('list', spamProtection, isAdmin, handleList);
bot.command('resume', spamProtection, isAdmin, resumeCmd);
bot.command('del_all', spamProtection, isAdmin, delAllCmd);
bot.command('export', spamProtection, isAdmin, handleExport);
bot.command('import', spamProtection, isAdmin, handleImport);
bot.command('add', checkFeedLimit, spamProtection, isAdmin, adultContentFilter, addCmd);
bot.callbackQuery(/^list_(prev|next)_(\d+)$/, spamProtection, isAdmin, handlePagination);
(async () => {
  await connectDB();
  startCycle();
  bot.start({
    drop_pending_updates: true,
  });
})();
