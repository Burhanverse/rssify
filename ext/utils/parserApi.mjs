import axios from 'axios';

// Fetch RSS feeds using ParserAPI
export const fetchRss = async (rssUrl) => {
  try {
    const response = await axios.get('http://127.0.0.1:5000/parse', {
      params: { url: rssUrl },
    });
    
    // New API structure returns { feed, items, source }
    return response.data.items;
  } catch (error) {
    // Handle new error format from FastAPI
    const errorMessage = error.response?.data?.detail || 
                         error.response?.data?.error || 
                         error.message || 
                         'Failed to fetch RSS feed';
    throw new Error(errorMessage);
  }
};