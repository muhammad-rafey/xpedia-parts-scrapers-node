import axios from 'axios';
import { createProxyFetchConfig, rotateProxies } from '../config/proxy.js';

/**
 * Make a request using a proxy with automatic retry and rotation
 * @param {string} url - URL to request
 * @param {Object} options - Request options
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} retryDelay - Delay between retries in milliseconds
 * @returns {Promise<any>} Response data
 */
export async function makeProxyRequest(url, options = {}, maxRetries = 3, retryDelay = 1000) {
  const proxyRotator = rotateProxies();
  let lastError;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const proxyAgent = proxyRotator.next().value;
      const config = createProxyFetchConfig(options, undefined, 'country-code');
      
      const response = await axios({
        ...config,
        url,
        httpsAgent: proxyAgent,
        validateStatus: status => status >= 200 && status < 300
      });
      
      return response.data;
    } catch (error) {
      lastError = error;
      
      // Handle specific error cases
      if (error.response) {
        const status = error.response.status;
        
        // If we get a rate limit or authentication error, try a different proxy
        if (status === 429 || status === 407) {
          continue;
        }
        
        // For other server errors, wait before retrying
        if (status >= 500) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
      }
      
      // For network errors, wait before retrying
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      
      // For other errors, throw immediately
      throw error;
    }
  }
  
  throw lastError;
}

/**
 * Make multiple requests in parallel with proxy rotation
 * @param {Array<string>} urls - URLs to request
 * @param {Object} options - Request options
 * @param {number} concurrency - Maximum number of concurrent requests
 * @returns {Promise<Array<any>>} Array of response data
 */
export async function makeParallelProxyRequests(urls, options = {}, concurrency = 3) {
  const results = [];
  const errors = [];
  
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchPromises = batch.map(url => 
      makeProxyRequest(url, options)
        .then(data => ({ url, data, error: null }))
        .catch(error => ({ url, data: null, error }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(result => {
      if (result.error) {
        errors.push({ url: result.url, error: result.error });
      } else {
        results.push(result.data);
      }
    });
    
    // Add a small delay between batches to avoid rate limiting
    if (i + concurrency < urls.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  if (errors.length > 0) {
    console.error('Some requests failed:', errors);
  }
  
  return results;
} 