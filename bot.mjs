import dotenv from 'dotenv';
import { Bot } from 'grammy';
import { connectDB } from './ext/db.mjs';
import { startCycle } from "./ext/sendRss.mjs";
import { addCmd } from './ext/commands/addHandler.mjs';
import { delCmd } from './ext/commands/delHandler.mjs';
import { setCmd } from './ext/commands/setHandler.mjs';
import { startCmd } from './ext/commands/startHandler.mjs';
import { statsCmd } from './ext/commands/statsHandler.mjs';
import { aboutCmd } from './ext/commands/aboutHandler.mjs';
import { checkSubscription } from './ext/isSubscribed.mjs';
import { alertSender } from './ext/commands/alertSender.mjs';
import { pauseCmd, resumeCmd } from './ext/commands/feedHandler.mjs';
import { handleExport, handleImport } from './ext/commands/opmlHandler.mjs';
import { handleList, handlePagination } from './ext/commands/listHandler.mjs';
import { isAdmin, spamProtection, handleThreadId } from './ext/middlewares.mjs';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

// Initialize bot
const bot = new Bot(BOT_TOKEN);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

await bot.api.setMyCommands([
  { command: "start", description: "Start the bot.." },
  { command: "add", description: "Add a new feed.." },
  { command: "del", description: "Delete a feed.." },
  { command: "list", description: "List of subscribed feeds.." },
  { command: "set", description: "Set a group topic for feeds.." },
  { command: "pause", description: "Pause feed updates.." },
  { command: "resume", description: "Resume feed updates.." },
  { command: "export", description: "Export feeds to OPML.." },
  { command: "import", description: "Import feeds from OPML.." },
  { command: "help", description: "Get some drugs.." },
  { command: "stats", description: "Show bot server stats.." },
  { command: "about", description: "Show information about the bot.." },
]);

bot.use(handleThreadId);
bot.use((ctx, next) => checkSubscription(ctx, next, bot));
bot.command('start', spamProtection, isAdmin, startCmd);
bot.command('add', spamProtection, isAdmin, addCmd);
bot.command('del', spamProtection, isAdmin, delCmd);
bot.command('set', spamProtection, isAdmin, setCmd);
bot.command('pause', spamProtection, isAdmin, pauseCmd);
bot.command('resume', spamProtection, isAdmin, resumeCmd);
bot.command('stats', spamProtection, statsCmd);
bot.command('about', spamProtection, aboutCmd);
bot.command('list', spamProtection, isAdmin, handleList);
bot.callbackQuery(/^list_(prev|next)_(\d+)$/, spamProtection, isAdmin, handlePagination);
bot.command('send', alertSender);
bot.command('export', spamProtection, isAdmin, handleExport);
bot.command('import', spamProtection, isAdmin, handleImport);

(async () => {
  await connectDB();
  startCycle();
  bot.start({
    drop_pending_updates: true,
  });
})();
