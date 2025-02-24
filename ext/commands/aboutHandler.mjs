import fs from 'fs';
import path from 'path';
import { escapeHTML } from "../escapeHelper.mjs";

// Middleware for about cmd
const getBotDetails = () => {
  const packageJsonPath = path.resolve('./package.json');
  try {
    const packageData = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return {
      version: packageData.version,
      apivar: packageData.apivar,
      description: packageData.description,
      author: packageData.author,
      homepage: packageData.homepage,
      issues: packageData.bugs.url,
      license: packageData.license,
      copyright: packageData.copyright,
    };
  } catch (err) {
    console.error('Failed to read package.json:', err.message);
    return {
      version: 'Unknown',
    };
  }
};

// About Command
export const aboutCmd = async (ctx) => {
    const { version, apivar, description, author, homepage, issues, license, copyright } = getBotDetails();
    const message =
        `<b>About Bot:</b> <i>${escapeHTML(description)}</i>\n\n` +
        `⋗ <b>Client Version:</b> <i>${escapeHTML(version)}</i>\n` +
        `⋗ <b>Parser API:</b> <i>${escapeHTML(apivar)}</i>\n` +
        `⋗ <b>Author:</b> <i>${escapeHTML(author)}</i>\n` +
        `⋗ <b>Issues:</b> <i><a href="${escapeHTML(issues)}">Report Now!</a></i>\n` +
        `⋗ <b>Project Page:</b> <i><a href="${escapeHTML(homepage)}">Check NOw!</a></i>\n` +
        `⋗ <b>License:</b> <i>${escapeHTML(license)}</i>\n` +
        `⋗ <b>Copyright:</b> <i>${escapeHTML(copyright)}</i>`;

    await ctx.reply(message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
    });
}