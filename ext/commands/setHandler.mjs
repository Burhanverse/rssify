import { log } from '../utils/colorLog.mjs';
import { chatCollection } from '../utils/db.mjs';

export const setCmd = async (ctx) => {
  try {
    await ctx.react('👌');
  } catch (error) {
    log.warn("Unable to react to message:", error.description || error.message);
  }

  const chatId = ctx.chat.id.toString();
  const topicId = ctx.message.message_thread_id;

  if (!topicId) {
    return ctx.reply('<i>This command can only be used in a topic.</i>', { parse_mode: 'HTML' });
  }

  await chatCollection.updateOne({ chatId }, { $set: { topicId } }, { upsert: true });
  ctx.reply(`<i>Feed updates will now be sent to ID:</i> ${topicId}.`,
    { parse_mode: 'HTML' }
  );
}