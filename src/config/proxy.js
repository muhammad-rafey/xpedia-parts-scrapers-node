import dotenv from 'dotenv';
import { HttpsProxyAgent } from 'https-proxy-agent';

dotenv.config();

export const PROXY_CONFIG = {
  baseUrl: process.env.PROXY_BASE_URL,
  sessionId: process.env.PROXY_SESSION_ID,
  sessionTime: process.env.PROXY_SESSION_TIME,
  country: process.env.PROXY_COUNTRY
};

export const PROXY_CREDENTIALS = [
  {
    username: process.env.PROXY_USERNAME_1,
    password: process.env.PROXY_PASSWORD_1
  },
  {
    username: process.env.PROXY_USERNAME_2,
    password: process.env.PROXY_PASSWORD_2
  },
  {
    username: process.env.PROXY_USERNAME_3,
    password: process.env.PROXY_PASSWORD_3
  }
];

/**
 * Get a proxy agent for making requests
 * @param {number} credentialIndex - Index of the credential to use (optional)
 * @param {string} proxyMethod - Method to use for proxy connection ('country-code', 'country-node', or 'simple')
 * @returns {HttpsProxyAgent} Configured proxy agent
 */
export function getProxyAgent(credentialIndex, proxyMethod = 'country-code') {
  const index = credentialIndex !== undefined 
    ? credentialIndex 
    : Math.floor(Math.random() * PROXY_CREDENTIALS.length);
  
  const credential = PROXY_CREDENTIALS[index];
  const { username, password } = credential;
  const { baseUrl, country } = PROXY_CONFIG;
  
  let proxyUrl;
  
  switch(proxyMethod) {
    case 'country-code':
      proxyUrl = `http://customer-${username}-cc-${country.toUpperCase()}:${password}@${baseUrl}`;
      break;
      
    case 'country-node':
      const [host, port] = baseUrl.split(':');
      const countryCode = country.toLowerCase();
      const countryNode = `${countryCode}-pr.oxylabs.io:${port || '7777'}`;
      proxyUrl = `http://customer-${username}:${password}@${countryNode}`;
      break;
      
    case 'simple':
    default:
      proxyUrl = `http://${username}:${password}@${baseUrl}`;
      break;
  }
  
  return new HttpsProxyAgent(proxyUrl);
}

/**
 * Generator function to rotate through proxy credentials
 * @param {number} startIndex - Starting index for credential rotation
 * @param {string} proxyMethod - Method to use for proxy connection
 * @yields {HttpsProxyAgent} Configured proxy agent
 */
export function* rotateProxies(startIndex = 0, proxyMethod = 'country-code') {
  let currentIndex = startIndex;
  while (true) {
    yield getProxyAgent(currentIndex, proxyMethod);
    currentIndex = (currentIndex + 1) % PROXY_CREDENTIALS.length;
  }
}

/**
 * Create a proxy-aware fetch configuration
 * @param {Object} options - Fetch options
 * @param {number} credentialIndex - Index of the credential to use
 * @param {string} proxyMethod - Method to use for proxy connection
 * @returns {Object} Fetch configuration with proxy agent
 */
export function createProxyFetchConfig(options = {}, credentialIndex, proxyMethod = 'country-code') {
  return {
    ...options,
    agent: getProxyAgent(credentialIndex, proxyMethod),
    timeout: options.timeout || 30000,
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      ...options.headers
    }
  };
} 