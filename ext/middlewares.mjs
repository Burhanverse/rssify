import { spamCollection, logCollection } from './db.mjs';

// isAdmin Middleware
export const isAdmin = async (ctx, next) => {
  if (ctx.chat.type === 'private') {
    return next();
  }

  try {
    const chatMember = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id);
    if (['administrator', 'creator'].includes(chatMember.status)) {
      return next();
    } else {
      return ctx.reply('<i>You must be an admin to use this command.</i>',
        { parse_mode: 'HTML' }
      );
    }
  } catch (err) {
    console.error('Error in isAdmin middleware:', err);
    return ctx.reply('<i>Unable to verify your access rights.</i>',
      { parse_mode: 'HTML' }
    );
  }
};

// Spam protection middleware
export const spamProtection = async (ctx, next) => {
  try {
    const userId = ctx.from.id.toString();
    const command = ctx.message.text.split(' ')[0];
    const now = new Date();

    const user = await spamCollection.findOne({ userId });
    if (user?.blockUntil && new Date(user.blockUntil) > now) {
      return ctx.reply('<i>You are blocked due to excessive bot command usage. Wait until the cooldown expires</i>',
        { parse_mode: 'HTML' }
      );
    }

    const recentCommands = (user?.commands || []).filter(cmd =>
      cmd.command === command && new Date(cmd.timestamp) > now - 60 * 1000
    );

    if (recentCommands.length >= 4) {
      const warnings = (user?.warnings || 0) + 1;

      if (warnings >= 4) {
        await spamCollection.updateOne({ userId }, {
          $set: { blockUntil: new Date(now.getTime() + 60 * 60 * 1000) }, // 1 hour cooldown
          $unset: { commands: '' }
        });
        return ctx.reply('<i>YOU are blocked for 1 hour due to repeated spamming</i>',
          { parse_mode: 'HTML' }
        );
      } else {
        await spamCollection.updateOne({ userId }, { $set: { warnings }, $push: { commands: { command, timestamp: now } } });
        return ctx.reply(`<i>Stop spamming. Warning ${warnings}/3.</i>`,
          { parse_mode: 'HTML' }
        );
      }
    }

    await spamCollection.updateOne(
      { userId },
      { $push: { commands: { command, timestamp: now } }, $setOnInsert: { warnings: 0 } },
      { upsert: true }
    );
    next();
  } catch (err) {
    console.error('Spam protection failed:', err.message);
    next();
  }
};

// Last log functions
export const getLastLog = async (chatId, rssUrl) => {
  return await logCollection.findOne({ chatId, rssUrl });
};

export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const updateLastLog = async (chatId, rssUrl, items) => {
  const timestamp = new Date();

  const itemsToPush = items.map(item => ({
    title: item.title,
    link: item.link,
    timestamp: timestamp,
  }));

  const lastLog = await logCollection.findOne({ chatId, rssUrl });
  const existingLinks = lastLog?.lastItems?.map(item => item.link) || [];

  const uniqueItems = itemsToPush.filter(item =>
    !existingLinks.includes(item.link)
  );

  if (uniqueItems.length === 0) return;

  await logCollection.updateOne(
    { chatId, rssUrl },
    {
      $push: {
        lastItems: {
          $each: uniqueItems,
          $sort: { timestamp: -1 },
          $slice: 50
        }
      }
    },
    { upsert: true }
  );
};
