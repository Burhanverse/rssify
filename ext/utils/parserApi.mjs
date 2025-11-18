import axios from 'axios';

// Fetch RSS feeds using ParserAPI
export const fetchRss = async (rssUrl) => {
  try {
    const response = await axios.get('http://dono-03.danbot.host:2058/parse', {
      params: { url: rssUrl },
    });
    
    // API returns array of items directly [{ title, link }, ...]
    return response.data;
  } catch (error) {
    // Handle new error format from FastAPI
    const errorMessage = error.response?.data?.detail || 
                         error.response?.data?.error || 
                         error.message || 
                         'Failed to fetch RSS feed';
    throw new Error(errorMessage);
  }
};