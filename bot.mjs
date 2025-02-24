import { Bot } from 'grammy';
import { addCmd } from './ext/commands/addHandler.mjs';
import { delCmd } from './ext/commands/delHandler.mjs';
import { setCmd } from './ext/commands/setHandler.mjs';
import { connectDB } from './ext/db.mjs';
import { startCycle } from "./ext/sendRss.mjs";
import { startCmd } from './ext/commands/startHandler.mjs';
import { statsCmd } from './ext/commands/statsHandler.mjs';
import { aboutCmd } from './ext/commands/aboutHandler.mjs';
import { alertSender } from './ext/commands/alertSender.mjs';
import { handleExport, handleImport } from './ext/commands/opmlHandler.mjs';
import { handleList, handlePagination } from './ext/commands/listHandler.mjs';
import { isAdmin, spamProtection } from './ext/middlewares.mjs';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TOKEN;

// Initialize bot
const bot = new Bot(BOT_TOKEN);

// Bot commands
bot.command('start', spamProtection, isAdmin, startCmd);
bot.command('add', spamProtection, isAdmin, addCmd);
bot.command('del', spamProtection, isAdmin, delCmd);
bot.command('set', spamProtection, isAdmin, setCmd);
bot.command('stats', spamProtection, statsCmd);
bot.command('about', spamProtection, aboutCmd);
bot.command('list', spamProtection, isAdmin, handleList);
bot.callbackQuery(/^list_(prev|next)_(\d+)$/, spamProtection, isAdmin, handlePagination);
bot.command('send', alertSender);
bot.command('export', spamProtection, isAdmin, handleExport);
bot.command('import', spamProtection, isAdmin, handleImport);

(async () => {
  await connectDB();
  await startCycle();
  await bot.start({
    drop_pending_updates: true,
  });
})();
