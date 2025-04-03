import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../config/logger.js';
import { addScraperJob, getQueueStatus, getActiveJobs, getFailedJobs, isRedisAvailable } from '../../queues/scraper.queue.js';
import { lkqScraper } from '../../scrapers/lkq-scraper.js';
import { registerScraper } from '../../scrapers/index.js';

const router = Router();
const prisma = new PrismaClient();

// Register the LKQ scraper when this module is imported
registerScraper('lkq', lkqScraper);

// Start a new LKQ scraper job
router.post('/run', async (req, res) => {
  try {
    logger.info('Received request to start LKQ scraper');
    // Extract parameters from request
    const { maxProducts = 1000 } = req.body;
    
    // Get or create the scraper in the database
    let scraper = await prisma.scraper.findUnique({
      where: { name: 'lkq' }
    });
    
    if (!scraper) {
      logger.info('LKQ scraper not found in database, creating new record');
      scraper = await prisma.scraper.create({
        data: {
          name: 'lkq',
          description: 'LKQ Online Auto Parts Scraper',
          enabled: true,
          config: {
            maxProductsToScrape: maxProducts
          }
        }
      });
      logger.info(`Created LKQ scraper record in database with id: ${scraper.id}`);
    } else {
      logger.info(`Found existing LKQ scraper with id: ${scraper.id}`);
    }
    
    // Create a new scraper run record
    logger.info('Creating scraper run record');
    const scraperRun = await prisma.scraperRun.create({
      data: {
        scraperId: scraper.id,
        status: 'pending'
      }
    });
    logger.info(`Created scraper run with id: ${scraperRun.id}`);
    
    // Check if Redis is available
    const redisAvailable = isRedisAvailable();
    
    // Add job to queue for background processing
    logger.info('Adding job to queue');
    const job = await addScraperJob({
      scraperId: scraper.id,
      runId: scraperRun.id,
      config: {
        maxProductsToScrape: maxProducts
      }
    });
    
    logger.info(`Job ${redisAvailable ? 'added to queue' : 'executed directly'} with id: ${job.id}`);
    
    res.status(202).json({
      message: redisAvailable 
        ? 'LKQ scraper job queued' 
        : 'LKQ scraper job executed directly (Redis unavailable)',
      runId: scraperRun.id,
      jobId: job.id,
      maxProducts,
      redisAvailable
    });
  } catch (error) {
    logger.error('Error starting LKQ scraper:', error);
    logger.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Failed to start LKQ scraper',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get LKQ scraper status and statistics
router.get('/status', async (req, res) => {
  try {
    logger.info('Received request for LKQ scraper status');
    const scraper = await prisma.scraper.findUnique({
      where: { name: 'lkq' }
    });
    
    if (!scraper) {
      logger.warn('LKQ scraper not found in database');
      return res.status(404).json({ error: 'LKQ scraper not found' });
    }
    
    // Get the latest run
    logger.info(`Finding latest run for scraper id: ${scraper.id}`);
    const latestRun = await prisma.scraperRun.findFirst({
      where: { scraperId: scraper.id },
      orderBy: { startedAt: 'desc' }
    });
    
    // Get statistics
    logger.info('Counting LKQ products');
    const totalProducts = await prisma.lkqProduct.count();
    
    // Check if Redis is available
    const redisAvailable = isRedisAvailable();
    
    res.json({
      scraper,
      latestRun,
      statistics: {
        totalProducts
      },
      queueStatus: {
        redisAvailable
      }
    });
  } catch (error) {
    logger.error('Error fetching LKQ scraper status:', error);
    logger.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch LKQ scraper status',
      message: error.message 
    });
  }
});

// Get queue debug information
router.get('/queue-debug', async (req, res) => {
  try {
    logger.info('Received request for queue debug information');
    
    // Check if Redis is available
    const redisAvailable = isRedisAvailable();
    
    if (!redisAvailable) {
      return res.json({
        redisAvailable: false,
        message: 'Redis is not available. Queue functionality is disabled.',
        queueStatus: {
          counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
          isReady: false,
          isPaused: false
        },
        activeJobs: [],
        failedJobs: []
      });
    }
    
    // Get queue status
    const queueStatus = await getQueueStatus();
    
    // Get active jobs
    const activeJobs = await getActiveJobs();
    
    // Get failed jobs
    const failedJobs = await getFailedJobs();
    
    res.json({
      redisAvailable: true,
      queueStatus,
      activeJobs: activeJobs.map(job => ({
        id: job.id,
        data: job.data,
        progress: job.progress(),
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp
      })),
      failedCount: failedJobs.length,
      lastFailedJobs: failedJobs.slice(0, 5).map(job => ({
        id: job.id,
        data: job.data,
        failedReason: job.failedReason,
        stacktrace: job.stacktrace,
        attemptsMade: job.attemptsMade,
        timestamp: job.timestamp
      }))
    });
  } catch (error) {
    logger.error('Error fetching queue debug information:', error);
    logger.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch queue debug information',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Retry a failed job
router.post('/retry-job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    logger.info(`Received request to retry job ${jobId}`);
    
    // Check if Redis is available
    const redisAvailable = isRedisAvailable();
    
    if (!redisAvailable) {
      return res.status(400).json({
        error: 'Redis is not available. Cannot retry jobs.',
        redisAvailable: false
      });
    }
    
    // Get the job from the failed jobs
    const failedJobs = await getFailedJobs();
    const job = failedJobs.find(j => j.id === jobId);
    
    if (!job) {
      logger.warn(`Job ${jobId} not found in failed jobs`);
      return res.status(404).json({ error: 'Failed job not found' });
    }
    
    // Retry the job
    logger.info(`Retrying job ${jobId}`);
    await job.retry();
    
    res.json({
      message: `Job ${jobId} requeued for retry`,
      job: {
        id: job.id,
        data: job.data
      }
    });
  } catch (error) {
    logger.error(`Error retrying job ${req.params.jobId}:`, error);
    res.status(500).json({ 
      error: 'Failed to retry job',
      message: error.message
    });
  }
});

export default router; 