import axios from 'axios';

// Fetch RSS feeds using ParserAPI and normalize response to an array
export const fetchRss = async (rssUrl) => {
  try {
    const response = await axios.get('http://dono-03.danbot.host:2058/parse', {
      params: { url: rssUrl },
    });

    const data = response.data;

    if (Array.isArray(data)) {
      return data;
    }

    if (Array.isArray(data?.items)) {
      return data.items;
    }

    throw new Error('Parser API returned no items');
  } catch (error) {
    // Handle new error format from FastAPI
    const errorMessage = error.response?.data?.detail || 
                         error.response?.data?.error || 
                         error.message || 
                         'Failed to fetch RSS feed';
    throw new Error(errorMessage);
  }
};