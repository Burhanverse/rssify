import { chatCollection } from '../db.mjs';

export const setCmd = async (ctx) => {
  await ctx.react('👌');
  const chatId = ctx.chat.id.toString();
  const topicId = ctx.message.message_thread_id;

  if (!topicId) {
    return ctx.reply('<i>This command can only be used in a topic.</i>', { parse_mode: 'HTML' });
  }

  await chatCollection.updateOne({ chatId }, { $set: { topicId } }, { upsert: true });
  ctx.reply(`<i>Feed updates will now be sent to this topic</i> (𝘐𝘋: ${topicId}).`,
    { parse_mode: 'HTML' }
  );
}