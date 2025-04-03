import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger.js';
import shortid from 'shortid';
import { LKQ_CONFIG } from '../config/lkq-config.js';
import { LKQ_HEADERS } from '../config/lkq-headers.js';
import oxylabsProxyManager from '../services/proxy-manager.js';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const prisma = new PrismaClient();

/**
 * Create a new LKQ scraper with custom configuration
 * @param {Object} customConfig - Custom configuration options
 * @returns {Object} - The LKQ scraper object with custom configuration
 */
export const createLkqScraper = (customConfig = {}) => {
  const config = { ...LKQ_CONFIG, ...customConfig };
  return {
    ...lkqScraper,
    config
  };
};

/**
 * Scrape LKQ Online for auto parts using direct API requests
 * @param {Object} config - Configuration for the scraper
 * @param {Object} options - Additional options including runId
 * @returns {Promise<Object>} - Scraping results with status and stats
 */
const scrape = async (config = LKQ_CONFIG, options = {}) => {
  const startTime = Date.now();
  const runId = options.runId || shortid.generate();
  
  const stats = {
    startTime: new Date().toISOString(),
    categories: {
      processed: 0,
      total: config.categories.length
    },
    products: {
      scraped: 0,
      saved: 0,
      duplicates: 0,
      errors: 0
    },
    pages: {
      processed: 0,
      errors: 0
    },
    timings: {}
  };
  
  let runStatus = {
    id: runId,
    scraperId: options.scraperId,
    status: 'starting',
    startTime: new Date().toISOString(),
    endTime: null,
    message: 'Initializing scraper',
    stats
  };
  
  logger.info(`[Scraper:${runId}] ${runStatus.message}`);
  await updateRunStatus(runStatus);
  
  try {
    logger.info(`[Scraper:${runId}] Starting API scrape`);
    
    runStatus.status = 'running';
    runStatus.message = 'Starting API requests';
    logger.info(`[Scraper:${runId}] ${runStatus.message}`);
    await updateRunStatus(runStatus);
    
    for (let i = 0; i < config.categories.length; i++) {
      const category = config.categories[i];
      const categoryStartTime = Date.now();
      
      logger.info(`[Scraper:${runId}] Processing category ${i + 1}/${config.categories.length}: ${category.name}`);
      
      runStatus.message = `Scraping category: ${category.name} (${i + 1}/${config.categories.length})`;
      logger.info(`[Scraper:${runId}] ${runStatus.message}`);
      await updateRunStatus(runStatus);
      
      try {
        let apiUrl = category.url;
        logger.info(`[Scraper:${runId}] Using API URL: ${apiUrl}`);
        
        let pageNum = 1;
        let hasMoreProducts = true;
        let skip = 0;
        const take = 50;
        let maxPages = config.maxPages || 10;
        
        while (hasMoreProducts && pageNum <= maxPages) {
          const pageStartTime = Date.now();
          
          if (skip > 0) {
            try {
              const url = new URL(apiUrl);
              url.searchParams.set('skip', skip.toString());
              url.searchParams.set('take', take.toString());
              apiUrl = url.toString();
              logger.info(`[Scraper:${runId}] Updated API URL with skip=${skip}: ${apiUrl}`);
            } catch (urlError) {
              logger.error(`[Scraper:${runId}] Error updating URL parameters: ${urlError.message}`);
              logger.error(`[Scraper:${runId}] Invalid URL: ${apiUrl}`);
              break;
            }
          }
          
          logger.info(`[Scraper:${runId}] Processing API page ${pageNum} for category: ${category.name}`);
          logger.info(`[Scraper:${runId}] API URL: ${apiUrl}`);
          
          try {
            const response = await makeApiRequest(apiUrl, config.securityTokens, runId);
            
            if (!response) {
              logger.error(`[Scraper:${runId}] Failed to get API response for category: ${category.name}`);
              stats.pages.errors++;
              break;
            }
            
            logger.info(`[Scraper:${runId}] Extracting products from API response`);
            const pageProducts = extractProductsFromApi(response, category, runId);
            
            if (pageProducts.length > 0) {
              logger.info(`[Scraper:${runId}] Found ${pageProducts.length} products on page ${pageNum} for ${category.name}`);
              stats.products.scraped += pageProducts.length;
              
              // Save products immediately after each API response
              logger.info(`[Scraper:${runId}] Saving ${pageProducts.length} products for category: ${category.name}`);
              const saveResults = await saveProducts(pageProducts, category.name, runId);
              
              stats.products.saved += saveResults.saved;
              stats.products.duplicates += saveResults.duplicates;
              stats.products.errors += saveResults.errors;
              
              // Update run status with progress
              runStatus.message = `Saved ${saveResults.saved}/${pageProducts.length} products for ${category.name}`;
              logger.info(`[Scraper:${runId}] ${runStatus.message}`);
              runStatus.stats = stats;
              await updateRunStatus(runStatus);
            } else {
              logger.warn(`[Scraper:${runId}] No products found on API page ${pageNum} for ${category.name}`);
              hasMoreProducts = false;
            }
            
            stats.pages.processed++;
            hasMoreProducts = pageProducts.length === take;
            
            if (hasMoreProducts && pageNum < maxPages) {
              skip += take;
              pageNum++;
              await new Promise(resolve => setTimeout(resolve, config.pageDelay || 2000));
            } else {
              logger.info(`[Scraper:${runId}] No more products for category: ${category.name} or reached max pages limit`);
              hasMoreProducts = false;
            }
            
            const pageEndTime = Date.now();
            const pageTime = pageEndTime - pageStartTime;
            logger.info(`[Scraper:${runId}] API page ${pageNum} processed in ${pageTime}ms`);
            
          } catch (error) {
            logger.error(`[Scraper:${runId}] Error processing API page ${pageNum} for ${category.name}: ${error.message}`);
            logger.error(`[Scraper:${runId}] Error stack: ${error.stack}`);
            stats.pages.errors++;
            
            skip += take;
            pageNum++;
            
            if (pageNum > maxPages) {
              hasMoreProducts = false;
            }
          }
        }
        
        const categoryEndTime = Date.now();
        const categoryTime = categoryEndTime - categoryStartTime;
        logger.info(`[Scraper:${runId}] Category ${category.name} processed in ${categoryTime}ms`);
        stats.timings[category.name] = categoryTime;
        
        stats.categories.processed++;
        
      } catch (categoryError) {
        logger.error(`[Scraper:${runId}] Error processing category ${category.name}: ${categoryError.message}`);
        logger.error(`[Scraper:${runId}] Error stack: ${categoryError.stack}`);
        stats.categories.errors = (stats.categories.errors || 0) + 1;
      }
    }
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    
    logger.info(`[Scraper:${runId}] Scrape completed in ${totalTime}ms`);
    logger.info(`[Scraper:${runId}] Stats: ${JSON.stringify(stats)}`);
    
    runStatus.status = 'completed';
    runStatus.endTime = new Date().toISOString();
    runStatus.message = `Scrape completed successfully. Scraped ${stats.products.scraped} products, saved ${stats.products.saved}.`;
    logger.info(`[Scraper:${runId}] ${runStatus.message}`);
    runStatus.stats = {
      ...stats,
      endTime: new Date().toISOString(),
      totalTime
    };
    
    await updateRunStatus(runStatus);
    
    return {
      status: 'success',
      runId,
      stats: runStatus.stats
    };
    
  } catch (error) {
    logger.error(`[Scraper:${runId}] Fatal error during scrape: ${error.message}`);
    logger.error(`[Scraper:${runId}] Error stack: ${error.stack}`);
    
    runStatus.status = 'error';
    runStatus.endTime = new Date().toISOString();
    runStatus.message = `Scrape failed: ${error.message}`;
    logger.error(`[Scraper:${runId}] ${runStatus.message}`);
    runStatus.stats = {
      ...stats,
      endTime: new Date().toISOString(),
      totalTime: Date.now() - startTime,
      error: {
        message: error.message,
        stack: error.stack
      }
    };
    
    await updateRunStatus(runStatus);
    
    return {
      status: 'error',
      runId,
      error: error.message,
      stats: runStatus.stats
    };
  }
};

/**
 * Make an API request with proxy support
 * @param {string} url - URL to request
 * @param {object} securityTokens - Security tokens to include in headers
 * @param {string} runId - The scraper run ID for logging
 * @returns {Promise<Object>} - API response
 */
async function makeApiRequest(url, securityTokens = null, runId) {
  try {
    const proxyAgent = oxylabsProxyManager.getNextProxy();
    
    const response = await axios({
      method: 'GET',
      url: url,
      httpsAgent: proxyAgent,
      headers: LKQ_HEADERS,
      timeout: 30000 // 30 second timeout
    });

    // Log the response status and data for debugging
    logger.info(`[Scraper:${runId}] API response status: ${response.status}`);
    
    // Check if the response is successful
    if (response.status === 200) {
      return response.data;
    } else {
      logger.error(`[Scraper:${runId}] API returned non-200 status: ${response.status}`);
      throw new Error(`API returned status ${response.status}`);
    }
  } catch (error) {
    logger.error(`[Scraper:${runId}] API request failed: ${error.message}`);
    
    // Handle specific error cases
    if (error.response) {
      const status = error.response.status;
      
      // Handle 400 Bad Request errors
      if (status === 400) {
        logger.error(`[Scraper:${runId}] Bad Request (400) error: ${JSON.stringify(error.response.data)}`);
        throw new Error(`Bad Request (400): ${error.response.data?.message || 'Unknown error'}`);
      }
      
      // If we get a rate limit or authentication error, try a different proxy
      if (status === 429 || status === 407) {
        logger.warn(`[Scraper:${runId}] Rate limit or authentication error, retrying with different proxy`);
        return makeApiRequest(url, securityTokens, runId);
      }
      
      // For other server errors, wait before retrying
      if (status >= 500) {
        logger.warn(`[Scraper:${runId}] Server error ${status}, waiting before retry`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return makeApiRequest(url, securityTokens, runId);
      }
    }
    
    // For network errors, wait before retrying
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      logger.warn(`[Scraper:${runId}] Network error ${error.code}, waiting before retry`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return makeApiRequest(url, securityTokens, runId);
    }
    
    throw error;
  }
}

/**
 * Extract products from API response
 * @param {Object} data - API response data
 * @param {Object} category - Category information
 * @param {string} runId - The scraper run ID for logging
 * @returns {Array} - Array of products from the API response
 */
const extractProductsFromApi = (data, category, runId) => {
  logger.info(`[Scraper:${runId}] Extracting products from API response`);
  
  try {
    const productList = data.data || [];
    
    if (!productList || !Array.isArray(productList)) {
      logger.error(`[Scraper:${runId}] API response does not contain product array`);
      return [];
    }
    
    const products = productList.map(item => {
      let sourceVehicleData = null;
      if (item._salvageSourceVehicle && typeof item._salvageSourceVehicle === 'string') {
        try {
          sourceVehicleData = JSON.parse(item._salvageSourceVehicle);
        } catch (e) {
          logger.warn(`[Scraper:${runId}] Failed to parse source vehicle data for product ${item.id}: ${e.message}`);
        }
      }
      
      let fitments = null;
      if (item.fitments && typeof item.fitments === 'string') {
        try {
          fitments = JSON.parse(item.fitments);
        } catch (e) {
          logger.warn(`[Scraper:${runId}] Failed to parse fitments for product ${item.id}: ${e.message}`);
        }
      }
      
      let fitmentJson = null;
      if (item.fitmentJson && typeof item.fitmentJson === 'string') {
        try {
          fitmentJson = JSON.parse(item.fitmentJson);
        } catch (e) {
          logger.warn(`[Scraper:${runId}] Failed to parse fitmentJson for product ${item.id}: ${e.message}`);
        }
      }

      // Fix imageUrl handling - ensure it's a string or null
      let imageUrl = null;
      if (item.images && Array.isArray(item.images) && item.images.length > 0) {
        imageUrl = typeof item.images[0] === 'string' ? item.images[0] : null;
      }
      
      return {
        sku: item.number || item.id,
        title: item.descriptionRetail || item.description,
        description: item.description,
        descriptionRetail: item.descriptionRetail,
        price: item.price ? parseFloat(item.price) : null,
        listPrice: item.listPrice ? parseFloat(item.listPrice) : null,
        corePrice: item.corePrice ? parseFloat(item.corePrice) : null,
        imageUrl: imageUrl, // Use the fixed imageUrl
        productUrl: `https://www.lkqonline.com/products/${item.number || item.id}`,
        categoryUrl: category.name,
        category: item.category,
        mileage: item.mileage ? parseInt(item.mileage) : null,
        location: item.location,
        yardCity: item.yardCity,
        yardState: item.yardState,
        sourceVehicleYear: item.sourceVehicleYear,
        sourceVehicleMake: item.sourceVehicleMake,
        sourceVehicleModel: item.sourceVehicleModel,
        sourceVehicleData: sourceVehicleData,
        fitments: fitments,
        fitmentJson: fitmentJson,
        interchange: item.interchange,
        type: item.type,
        code: item.code,
        unitOfMeasureCode: item.unitOfMeasureCode,
        unitOfMeasure: item.unitOfMeasure,
        companyCode: item.companyCode,
        ftcDisplay: item.ftcDisplay,
        freeShippingEligible: item.freeShippingEligible,
        isReman: item.isReman,
        requireVin: item.requireVin,
        displayFinancing: item.displayFinancing,
        remanFinanceIneligible: item.remanFinanceIneligible,
        availability: item.availability,
        images: item.images,
        categories: item.categories,
        pricing: item.pricing,
        catalog: item.catalog
      };
    });
    
    logger.info(`[Scraper:${runId}] Extracted ${products.length} products from API response`);
    
    if (products.length > 0) {
      const sampleProduct = products[0];
      logger.debug(`[Scraper:${runId}] Sample product from API: SKU=${sampleProduct.sku}, Title=${sampleProduct.title}, Price=${sampleProduct.price}`);
    }
    
    return products;
  } catch (error) {
    logger.error(`[Scraper:${runId}] Error extracting products from API: ${error.message}`);
    return [];
  }
};

/**
 * Save products to the database
 * @param {Array} products - Products to save
 * @param {string} categoryName - Category name
 * @param {string} runId - ID of the current run 
 * @returns {Promise<Object>} - Results of the save operation
 */
const saveProducts = async (products, categoryName, runId = 'unknown') => {
  logger.info(`[Scraper:${runId}] Saving ${products.length} products for category: ${categoryName}`);
  
  const results = {
    saved: 0,
    duplicates: 0,
    errors: 0
  };
  
  if (products.length === 0) {
    logger.info(`[Scraper:${runId}] No products to save for category: ${categoryName}`);
    return results;
  }
  
  try {
    // Process products in batches of 50
    const batchSize = 50;
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      logger.info(`[Scraper:${runId}] Processing batch of ${batch.length} products`);
      
      // Use transaction for batch processing
      await prisma.$transaction(async (tx) => {
        for (const product of batch) {
          try {
            // Convert all data to appropriate types and handle nulls
            const productData = {
              sku: String(product.sku || ''),
              title: String(product.title || ''),
              description: String(product.description || ''),
              descriptionRetail: String(product.descriptionRetail || ''),
              // Handle numeric fields as Float
              price: product.price ? parseFloat(product.price) : null,
              listPrice: product.listPrice ? parseFloat(product.listPrice) : null,
              corePrice: product.corePrice ? parseFloat(product.corePrice) : null,
              imageUrl: product.imageUrl ? String(product.imageUrl) : null,
              productUrl: String(product.productUrl || ''),
              categoryUrl: String(categoryName || ''),
              category: String(product.category || ''),
              // Handle numeric fields as Float
              mileage: product.mileage ? parseFloat(product.mileage) : null,
              location: String(product.location || ''),
              yardCity: String(product.yardCity || ''),
              yardState: String(product.yardState || ''),
              sourceVehicleYear: String(product.sourceVehicleYear || ''),
              sourceVehicleMake: String(product.sourceVehicleMake || ''),
              sourceVehicleModel: String(product.sourceVehicleModel || ''),
              sourceVehicleData: product.sourceVehicleData ? JSON.stringify(product.sourceVehicleData) : null,
              fitments: product.fitments ? JSON.stringify(product.fitments) : null,
              fitmentJson: product.fitmentJson ? JSON.stringify(product.fitmentJson) : null,
              interchange: String(product.interchange || ''),
              type: String(product.type || ''),
              code: String(product.code || ''),
              unitOfMeasureCode: String(product.unitOfMeasureCode || ''),
              unitOfMeasure: String(product.unitOfMeasure || ''),
              companyCode: String(product.companyCode || ''),
              ftcDisplay: String(product.ftcDisplay || ''),
              // Handle boolean fields
              freeShippingEligible: product.freeShippingEligible === true || product.freeShippingEligible === 'true',
              isReman: product.isReman === true || product.isReman === 'true',
              requireVin: product.requireVin === true || product.requireVin === 'true',
              displayFinancing: product.displayFinancing === true || product.displayFinancing === 'true',
              remanFinanceIneligible: product.remanFinanceIneligible === true || product.remanFinanceIneligible === 'true',
              availability: String(product.availability || ''),
              images: product.images ? JSON.stringify(product.images) : null,
              categories: product.categories ? JSON.stringify(product.categories) : null,
              pricing: product.pricing ? JSON.stringify(product.pricing) : null,
              catalog: product.catalog ? JSON.stringify(product.catalog) : null,
              scraperRunId: runId
            };

            // Use upsert to handle both new and existing products
            const result = await tx.lkqProduct.upsert({
              where: { sku: productData.sku },
              update: {
                ...productData,
                updatedAt: new Date()
              },
              create: productData
            });

            if (result) {
              results.saved++;
            }
          } catch (error) {
            logger.error(`[Scraper:${runId}] Error saving product ${product.sku}: ${error.message}`);
            results.errors++;
          }
        }
      });
      
      logger.info(`[Scraper:${runId}] Processed batch. Saved: ${results.saved}, Errors: ${results.errors}`);
    }
    
    logger.info(`[Scraper:${runId}] Completed saving products. Total saved: ${results.saved}, Errors: ${results.errors}`);
    return results;
  } catch (error) {
    logger.error(`[Scraper:${runId}] Error in bulk save operation: ${error.message}`);
    logger.error(`[Scraper:${runId}] Error stack: ${error.stack}`);
    results.errors += products.length;
    return results;
  }
};

/**
 * Update the run status in the database
 * @param {Object} status - Run status object
 * @returns {Promise<void>}
 */
const updateRunStatus = async (status) => {
  try {
    if (!status.id) {
      logger.error(`[Scraper:unknown] Cannot update run status - missing run ID`);
      return;
    }
    
    if (!status.scraperId) {
      logger.warn(`[Scraper:${status.id}] No scraperId provided in status update. Attempting to find scraper ID.`);
      
      try {
        // Try to find a scraper with name 'lkq'
        const scraper = await prisma.scraper.findFirst({
          where: { name: 'lkq' }
        });
        
        if (scraper) {
          logger.info(`[Scraper:${status.id}] Found scraper with id: ${scraper.id}`);
          status.scraperId = scraper.id;
        } else {
          logger.error(`[Scraper:${status.id}] Could not find a scraper with name 'lkq'. Cannot create scraper run.`);
          logger.info(`[Scraper:${status.id}] Creating dummy scraper record for this run`);
          
          // Create a dummy scraper record
          const newScraper = await prisma.scraper.create({
            data: {
              name: 'lkq' + Date.now(), // Unique name to avoid conflicts
              description: 'LKQ Auto Parts Scraper (Automatically Created)',
              enabled: true
            }
          });
          
          logger.info(`[Scraper:${status.id}] Created dummy scraper with id: ${newScraper.id}`);
          status.scraperId = newScraper.id;
        }
      } catch (findError) {
        logger.error(`[Scraper:${status.id}] Error finding/creating scraper: ${findError.message}`);
        return; // Cannot proceed without scraperId
      }
    }
    
    logger.debug(`[Scraper:${status.id}] Updating run status to: ${status.status}`);
    
    try {
      // Check if the run record exists
      const existingRun = await prisma.scraperRun.findUnique({
        where: { id: status.id }
      });
      
      if (existingRun) {
        // Update existing run
        await prisma.scraperRun.update({
          where: { id: status.id },
          data: {
            status: status.status,
            updatedAt: new Date(),
            completedAt: status.endTime ? new Date(status.endTime) : null,
            statistics: status.stats
          }
        });
      } else {
        // Create new run record with proper scraper connection
        await prisma.scraperRun.create({
          data: {
            id: status.id,
            status: status.status,
            startedAt: new Date(status.startTime),
            updatedAt: new Date(),
            completedAt: status.endTime ? new Date(status.endTime) : null,
            statistics: status.stats,
            scraper: {
              connect: { id: status.scraperId }
            }
          }
        });
      }
      
      logger.debug(`[Scraper:${status.id}] Run status updated successfully`);
    } catch (dbError) {
      // Handle specific database errors
      logger.error(`[Scraper:${status.id}] Database error updating run status: ${dbError.message}`);
      
      if (dbError.code === 'P2023') {
        logger.error(`[Scraper:${status.id}] Invalid UUID format. Run ID must be a valid UUID.`);
      }
    }
  } catch (error) {
    logger.error(`[Scraper:unknown] Error in updateRunStatus: ${error.message}`);
    logger.error(`[Scraper:unknown] Error stack: ${error.stack}`);
  }
};

// Export the LKQ scraper
export const lkqScraper = {
  name: 'lkq',
  description: 'LKQ Online Auto Parts Scraper',
  scrape,
  extractProductsFromApi,
  saveProducts,
  updateRunStatus,
  config: LKQ_CONFIG
}; 