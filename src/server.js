import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import { PrismaClient } from '@prisma/client';
import { logger, stream } from './config/logger.js';
import lkqRoutes from './api/routes/lkq.routes.js';

// Initialize Express app
const app = express();
const port = process.env.PORT || 8080;

// Initialize Prisma client
const prisma = new PrismaClient();

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies
app.use(morgan('combined', { stream })); // HTTP request logging

// API routes
app.use('/api/scrapers/lkq', lkqRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start the server
const server = app.listen(port, () => {
  logger.info(`Server running on port ${port}`);
});

// Handle graceful shutdown
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  logger.info('Received shutdown signal, closing connections...');
  
  // Close the server
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // Close database connection
  await prisma.$disconnect();
  logger.info('Database connection closed');
  
  // Exit process
  process.exit(0);
}

export default app; 