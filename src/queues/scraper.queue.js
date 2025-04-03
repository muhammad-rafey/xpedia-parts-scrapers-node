import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';
import { runScraper, getScraper } from '../scrapers/index.js';

const prisma = new PrismaClient();

// Set Redis as always unavailable since we're removing queue functionality
const redisAvailable = false;

/**
 * Add a scraper job - now runs directly without queueing
 * @param {Object} jobData - Job data including scraperId, runId, and config
 * @returns {Promise<Object>} - The result of direct execution
 */
export const addScraperJob = async (jobData) => {
  logger.info(`Running scraper directly (no queue):`, jobData);
  try {
    const { scraperId, runId, config } = jobData;
    
    // Update run status to processing
    await prisma.scraperRun.update({
      where: { id: runId },
      data: { 
        status: 'processing',
        startedAt: new Date()
      }
    });
    
    // Get the scraper from the database
    const scraper = await prisma.scraper.findUnique({
      where: { id: scraperId }
    });
    
    if (!scraper) {
      throw new Error(`Scraper with ID ${scraperId} not found`);
    }
    
    // Run the scraper directly
    const result = await runScraper(scraper.name, {
      runId,
      config
    });
    
    // Update run status to completed
    await prisma.scraperRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        statistics: result
      }
    });
    
    return { id: 'direct-execution-no-queue', result };
  } catch (error) {
    logger.error('Direct scraper execution failed:', error);
    
    // Update run status to failed
    if (jobData.runId) {
      await prisma.scraperRun.update({
        where: { id: jobData.runId },
        data: {
          status: 'failed',
          error: error.message,
          completedAt: new Date()
        }
      });
    }
    
    throw error;
  }
};

/**
 * Get active scraper jobs
 * @returns {Promise<Array>} - Empty array since we don't have queues
 */
export const getActiveJobs = async () => {
  logger.warn('Queue functionality disabled. No active jobs available.');
  return [];
};

/**
 * Get completed scraper jobs
 * @returns {Promise<Array>} - Empty array since we don't have queues
 */
export const getCompletedJobs = async () => {
  logger.warn('Queue functionality disabled. No completed jobs available.');
  return [];
};

/**
 * Get failed scraper jobs
 * @returns {Promise<Array>} - Empty array since we don't have queues
 */
export const getFailedJobs = async () => {
  logger.warn('Queue functionality disabled. No failed jobs available.');
  return [];
};

/**
 * Clean up completed and failed jobs
 * @returns {Promise} - No-op function
 */
export const cleanupJobs = async () => {
  logger.warn('Queue functionality disabled. No jobs to clean up.');
  return;
};

/**
 * Get queue status information
 * @returns {Promise<Object>} - Queue status (always reports as disabled)
 */
export const getQueueStatus = async () => {
  return {
    redisAvailable: false,
    counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
    isReady: false,
    isPaused: false,
    activeCount: 0,
    failedJobs: [],
    pendingJobs: []
  };
};

/**
 * Check if Redis is available (always returns false)
 * @returns {boolean} - Whether Redis is available
 */
export const isRedisAvailable = () => false;

export default {
  addScraperJob,
  getActiveJobs,
  getCompletedJobs,
  getFailedJobs,
  cleanupJobs,
  getQueueStatus,
  isRedisAvailable
}; 