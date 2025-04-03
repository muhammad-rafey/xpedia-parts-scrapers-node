import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';
import { lkqScraper, createLkqScraper } from './lkq-scraper.js';

// Create a prisma client instance
const prisma = new PrismaClient();

// Store registered scrapers
const scrapers = new Map();

/**
 * Register a scraper by name
 * @param {string} name - The name of the scraper
 * @param {Object} scraper - The scraper object
 */
export function registerScraper(name, scraper) {
  scrapers.set(name, scraper);
  logger.info(`Registered scraper: ${name}`);
}

/**
 * Get a scraper by name
 * @param {string} name - The name of the scraper
 * @returns {Object} - The scraper object
 */
export function getScraper(name) {
  if (!scrapers.has(name)) {
    throw new Error(`Scraper not found: ${name}`);
  }
  
  return scrapers.get(name);
}

/**
 * Run a scraper by name
 * @param {string} name - The name of the scraper
 * @param {Object} options - Options including runId and configuration
 * @returns {Promise<Object>} - Result of the scraper run
 */
export async function runScraper(name, options) {
  const scraper = getScraper(name);
  
  // Handle LKQ-specific configuration
  if (name === 'lkq') {
    logger.info(`[Scraper:${options.runId}] Running LKQ scraper with customized config`);
    // Create a new LKQ scraper with custom configuration
    const customLkqScraper = createLkqScraper({
      ...scraper.config,
      ...(options.config || {})
    });
    
    // Use the scrape function instead of run
    return customLkqScraper.scrape(customLkqScraper.config);
  }
  
  // Default behavior for other scrapers
  logger.info(`[Scraper:${options.runId}] Running scraper: ${name}`);
  return scraper.run ? scraper.run(options) : scraper.scrape(options);
}

/**
 * Get all registered scrapers
 * @returns {Array} - Array of scraper names
 */
export function getScraperNames() {
  return Array.from(scrapers.keys());
}

/**
 * Get details of all registered scrapers
 * @returns {Array<Object>} - Array of scraper details
 */
export function getScraperDetails() {
  return Array.from(scrapers.entries()).map(([name, scraper]) => ({
    name,
    description: scraper.description || 'No description provided',
    config: scraper.config || {}
  }));
}

// Register the LKQ scraper by default
registerScraper('lkq', lkqScraper);

export default {
  registerScraper,
  getScraper,
  runScraper,
  getScraperNames,
  getScraperDetails
}; 