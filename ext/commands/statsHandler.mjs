import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import prettyBytes from 'pretty-bytes';
import { log } from '../utils/colorLog.mjs';

const execPromise = promisify(exec);

// Bot start time
const botStartTime = Date.now();

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return days > 0
    ? `${days}d ${hours}h ${minutes}m ${secs}s`
    : `${hours}h ${minutes}m ${secs}s`;
}

// Stats Command
export const statsCmd = async (ctx) => {
  try {
    await ctx.react('⚡');
  } catch (error) {
    log.warn("Unable to react to message:", error.description || error.message);
  }

  const start = Date.now();

  try {
    const botUptime = formatUptime(Date.now() - botStartTime);
    const { stdout: networkOutput } = await execPromise('cat /sys/class/net/eth0/statistics/rx_bytes /sys/class/net/eth0/statistics/tx_bytes');
    const [rxBytes, txBytes] = networkOutput.trim().split('\n').map((val) => parseInt(val, 10));
    const inbound = prettyBytes(rxBytes);
    const outbound = prettyBytes(txBytes);

    const ping = Date.now() - start;

    const stats =
      `<i><b>Bot Server Stats</b></i>\n\n` +
      `⋗ <b>Ping:</b> <i>${ping} ms </i> \n` +
      `⋗ <b>Uptime:</b> <i>${botUptime} </i> \n` +
      `⋗ <b>Inbound:</b> <i>${inbound} </i>\n` +
      `⋗ <b>Outbound:</b> <i>${outbound} </i>`;
    await ctx.reply(
      stats,
      { parse_mode: 'HTML' }
    );

  } catch (err) {
    log.error('Error in /stats command:', err);
    await ctx.reply('<i>An error occurred while fetching server stats. Please try again later.</i>',
      { parse_mode: 'HTML' }
    );
  }
}