import axios from 'axios';

// Fetch RSS feeds using ParserAPI
export const fetchRss = async (rssUrl) => {
  try {
    const response = await axios.get('http://127.0.0.1:5000/parse', {
      params: { url: rssUrl },
    });
    return response.data.items;
  } catch (error) {
    throw new Error(error.response?.data?.error || 'Failed to fetch RSS feed');
  }
};