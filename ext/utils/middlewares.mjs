import { log } from './colorLog.mjs';
import { spamCollection, logCollection, chatCollection } from './db.mjs';
import dotenv from 'dotenv';

dotenv.config();

// Middleware to automatically include message_thread_id if available from message or callbackQuery
export const handleThreadId = async (ctx, next) => {
  let threadId;
  if (ctx.message && ctx.message.message_thread_id) {
    threadId = parseInt(ctx.message.message_thread_id);
  } else if (
    ctx.callbackQuery &&
    ctx.callbackQuery.message &&
    ctx.callbackQuery.message.message_thread_id
  ) {
    threadId = parseInt(ctx.callbackQuery.message.message_thread_id);
  }

  if (threadId) {
    const originalReply = ctx.reply.bind(ctx);
    ctx.reply = (text, extra = {}) => {
      extra = { ...extra, message_thread_id: threadId };
      return originalReply(text, extra);
    };
  }
  return next();
};

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
    log.error('Error in isAdmin middleware:', err);
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
    log.error('Spam protection failed:', err.message);
    next();
  }
};

// Rate limit settings
const messageQueues = new Map();

const RATE_LIMIT = {
  PRIVATE: { messages: 25, period: 60000 }, // 25 messages per minute
  GROUP: { messages: 15, period: 60000 }    // 15 messages per minute 
};

export const rateLimitSending = async (chatId, sendFunction) => {
  const chatKey = chatId.toString();

  if (!messageQueues.has(chatKey)) {
    messageQueues.set(chatKey, {
      lastSent: 0,
      sentCount: 0,
      resetTime: Date.now() + RATE_LIMIT.GROUP.period
    });
  }

  const queue = messageQueues.get(chatKey);
  const now = Date.now();

  if (now > queue.resetTime) {
    queue.sentCount = 0;
    queue.resetTime = now + RATE_LIMIT.GROUP.period;
  }

  let delayMs = 0;

  if (queue.sentCount >= RATE_LIMIT.GROUP.messages) {
    delayMs = queue.resetTime - now;
  } else if (queue.lastSent > 0) {
    const timeSinceLastSend = now - queue.lastSent;
    delayMs = Math.max(0, 300 - timeSinceLastSend);
  }

  if (delayMs > 0) {
    await delay(delayMs);
  }

  try {
    const result = await sendFunction();
    queue.lastSent = Date.now();
    queue.sentCount++;
    return result;
  } catch (error) {
    if (error.description?.includes('Too Many Requests')) {
      const retryAfter = (error.parameters?.retry_after || 5) * 1000;
      await delay(retryAfter);
      const result = await sendFunction();
      queue.lastSent = Date.now();
      queue.sentCount++;
      return result;
    }
    throw error;
  }
};

// Middleware to check feed limit
export const checkFeedLimit = async (ctx, next) => {
  const chatId = ctx.chat.id.toString();
  const feedLimit = parseInt(process.env.FEED_LIMIT, 10) || 20;

  try {
    const chat = await chatCollection.findOne({ chatId });
    const currentFeedCount = chat?.rssFeeds?.length || 0;

    if (currentFeedCount >= feedLimit) {
      log.warn(`Chat ${chatId} reached feed limit (${feedLimit}). Add command blocked.`);
      return ctx.reply(
        `<i>You have reached the maximum limit of ${feedLimit} feeds. Remove some feeds before adding new ones.</i>`,
        { parse_mode: 'HTML' }
      );
    }

    return next();
  } catch (err) {
    log.error(`Error checking feed limit for chat ${chatId}:`, err);
    return next();
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
