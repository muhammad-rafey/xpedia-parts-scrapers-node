import { logger } from '../config/logger.js';
import { getProxyAgent, rotateProxies } from '../config/proxy.js';

/**
 * Oxylabs Proxy Manager
 * Manages proxies from Oxylabs service for scraping operations
 */
class OxylabsProxyManager {
  constructor() {
    this.proxyRotator = null;
    this.initialized = false;
  }

  /**
   * Initialize the proxy manager
   */
  initialize() {
    try {
      this.proxyRotator = rotateProxies();
      this.initialized = true;
      logger.info('Initialized Oxylabs proxy manager');
    } catch (error) {
      logger.error('Error initializing Oxylabs proxy manager:', error);
      throw error;
    }
  }

  /**
   * Get the next proxy agent
   * @returns {HttpsProxyAgent} The next proxy agent
   */
  getNextProxy() {
    if (!this.initialized) {
      this.initialize();
    }
    return this.proxyRotator.next().value;
  }

  /**
   * Get a proxy agent for a specific index
   * @param {number} index - The index of the proxy to use
   * @returns {HttpsProxyAgent} The proxy agent
   */
  getProxyByIndex(index) {
    if (!this.initialized) {
      this.initialize();
    }
    return getProxyAgent(index, 'country-code');
  }

  /**
   * Reset the proxy rotation
   */
  resetProxyRotation() {
    this.proxyRotator = rotateProxies();
  }
}

// Export a singleton instance
const proxyManager = new OxylabsProxyManager();
export default proxyManager; 