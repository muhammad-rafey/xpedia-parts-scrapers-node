import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';

// Create a prisma client instance
const prisma = new PrismaClient();

/**
 * Creates a base scraper with common functionality
 * @param {string} name - The name of the scraper
 * @param {Object} config - The scraper configuration
 * @returns {Object} - The base scraper object with methods
 */
export function createBaseScraper(name, config) {
  // State to be maintained between function calls
  const state = {
    name,
    config,
    runId: null
  };

  /**
   * Initialize the scraper with a run ID
   * @param {string} runId - The ID for this scraper run
   */
  async function initialize(runId) {
    state.runId = runId;
    await prisma.scraperRun.update({
      where: { id: runId },
      data: { status: 'running' }
    });
    
    logger.info(`Initialized scraper: ${state.name} with runId: ${runId}`);
  }

  /**
   * Run the scraper
   */
  async function run() {
    if (!state.runId) {
      throw new Error('Scraper not initialized with runId');
    }
    
    try {
      logger.info(`Starting scraper: ${state.name}`);
      
      let pageCounter = 1;
      let currentPageValue = state.config.pagination?.initialValue || 1;
      let hasMorePages = true;
      
      while (hasMorePages) {
        const url = state.config.url;
        const params = { ...state.config.params };
        
        // Handle pagination if enabled
        if (state.config.pagination?.enabled) {
          params[state.config.pagination.param] = currentPageValue.toString();
        }
        
        // Fetch data
        const response = await axios.get(url, {
          headers: state.config.headers,
          params
        });
        
        // Process the data (to be implemented by child scrapers)
        const items = await processData(response.data);
        
        // Save items to database
        if (items.length > 0) {
          await saveItems(items);
        }
        
        // Update pagination
        pageCounter++;
        if (state.config.pagination?.type === 'page' || state.config.pagination?.type === 'offset') {
          currentPageValue = typeof currentPageValue === 'number' 
            ? currentPageValue + (state.config.pagination.increment || 1)
            : parseInt(currentPageValue) + (state.config.pagination.increment || 1);
        } else if (state.config.pagination?.type === 'cursor') {
          // Cursor-based pagination should be implemented by child scrapers
          // by overriding the getNextCursor method
          currentPageValue = await getNextCursor(response.data);
        }
        
        // Check if we should continue
        hasMorePages = hasMorePages(response.data, pageCounter);
        
        // Rate limiting
        if (hasMorePages && state.config.rateLimitDelay) {
          await new Promise(resolve => setTimeout(resolve, state.config.rateLimitDelay));
        }
      }
      
      // Mark as completed
      await prisma.scraperRun.update({
        where: { id: state.runId },
        data: { 
          status: 'completed', 
          finishedAt: new Date(),
          stats: {
            pagesScrapped: pageCounter - 1,
            // Add more stats as needed
          }
        }
      });
      
      logger.info(`Scraper ${state.name} completed successfully`);
    } catch (error) {
      logger.error(`Error in scraper ${state.name}:`, error);
      
      // Mark as failed
      await prisma.scraperRun.update({
        where: { id: state.runId },
        data: { 
          status: 'failed', 
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : String(error)
        }
      });
      
      throw error;
    }
  }
  
  /**
   * Process data - to be implemented by specific scrapers
   * @param {any} data - The data to process
   * @returns {Promise<Array>} - The processed data
   */
  async function processData(data) {
    // This should be overridden by the specific scraper implementation
    throw new Error('processData method must be implemented by the specific scraper');
  }
  
  /**
   * Save items to the database
   * @param {Array} items - The items to save
   */
  async function saveItems(items) {
    if (!state.runId) throw new Error('Scraper not initialized with runId');
    
    // Save items to the database
    await Promise.all(items.map(item => 
      prisma.scrapedItem.create({
        data: {
          scraperRunId: state.runId,
          data: item,
          url: item.url || null
        }
      })
    ));
  }
  
  /**
   * Get the next cursor for cursor-based pagination
   * @param {any} data - The response data
   * @returns {Promise<string>} - The next cursor
   */
  async function getNextCursor(data) {
    return ''; // Override in specific scrapers
  }
  
  /**
   * Check if there are more pages to scrape
   * @param {any} data - The response data
   * @param {number} currentPage - The current page number
   * @returns {boolean} - Whether there are more pages
   */
  function hasMorePages(data, currentPage) {
    if (state.config.maxPages && currentPage >= state.config.maxPages) {
      return false;
    }
    // Override in specific scrapers for more specific logic
    return true;
  }
  
  // Return the base scraper object with methods
  return {
    name: state.name,
    config: state.config,
    initialize,
    run,
    processData,
    saveItems,
    getNextCursor,
    hasMorePages,
    getPrisma: () => prisma,
    getState: () => state
  };
}

// Export a function to create a new scraper with the provided method overrides
export function createScraper(name, config, overrides = {}) {
  const baseScraper = createBaseScraper(name, config);
  
  // Merge the base scraper with the provided overrides
  return {
    ...baseScraper,
    ...overrides
  };
} 