import axios from 'axios';
import { log } from './colorLog.mjs';

// Fetch RSS feeds using ParserAPI
export const fetchRss = async (rssUrl) => {
  try {
    const response = await axios.get('http://127.0.0.1:5000/parse', {
      params: { url: rssUrl },
    });
    return response.data.items;
  } catch (error) {
    const statusCode = error.response?.status;
    const errorMessage = error.response?.data?.error || error.message || 'Failed to fetch RSS feed';

    log.error(`for ${rssUrl}: Status ${statusCode}, Message: ${errorMessage}`);

    throw new Error(JSON.stringify({
      message: errorMessage,
      status: statusCode || 0,
      url: rssUrl
    }));
  }
};