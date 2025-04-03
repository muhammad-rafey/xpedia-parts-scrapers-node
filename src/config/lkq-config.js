export const LKQ_CONFIG = {
  // General settings
  maxRetries: 3,
  parallelRequests: 2,
  rateLimitDelay: 1000, // 1 second between requests
  timeout: 30000,
  pageDelay: 2000,
  
  // Maximum number of pages to fetch per category
  maxPages: 10,
  
  // API Configuration
  baseApiUrl: "https://www.lkqonline.com/api/catalog/0/product",
  
  // Categories to scrape with API URLs
  categories: [
    {
      name: "Transmission or Transaxle Assembly",
      url: "https://www.lkqonline.com/api/catalog/0/product?catalogId=0&category=Engine%20Compartment%7CTransmission%20or%20Transaxle%20Assembly&skip=0&take=50" 
    },
    {
      name: "Engine Assembly",
      url: "https://www.lkqonline.com/api/catalog/0/product?catalogId=0&category=Engine%20Compartment%7CEngine%20Assembly&skip=0&take=50"
    }
  ]
}; 