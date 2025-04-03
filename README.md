# Xpedia Parts Scrapers

A Node.js application for scraping auto parts data from various online sources.

## Features

- Scrapes auto parts data from LKQ Online
- Supports multiple categories
- Implements pagination
- Uses proxies to avoid rate limiting
- Stores data in PostgreSQL database
- Provides REST API for controlling scrapers
- Queue system for background processing

## Prerequisites

- Node.js 16+
- PostgreSQL 12+
- Redis (for job queue)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/xpedia-parts-scrapers-node.git
   cd xpedia-parts-scrapers-node
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit the `.env` file with your database and proxy credentials.

4. Set up the database:
   ```bash
   npx prisma migrate dev
   ```

## Environment Variables

Create a `.env` file with the following variables:

```
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/xpedia_parts_db?schema=public"

# Server
PORT=8080
NODE_ENV=development

# Redis
SKIP_REDIS=true  # Set to true to disable Redis and run in standalone mode
# If you need Redis queue functionality, set SKIP_REDIS=false and configure:
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=
# REDIS_DB=1  # Use a specific Redis DB number to avoid conflicts with other projects

# Oxylabs Proxy
OXYLABS_USERNAME=your_username
OXYLABS_PASSWORD=your_password
PROXY_COUNT=5
```

### Project Isolation

To ensure this project doesn't conflict with other services running on your system:

1. **Port Configuration**: 
   - The application runs on port 8080 by default (change using the PORT environment variable).
   - Make sure no other services use this port.

2. **Database Isolation**:
   - Uses a dedicated database named `xpedia_parts_db`.
   - You can change the database name, port and credentials in the `DATABASE_URL` variable.

3. **Redis Configuration**:
   - Set `SKIP_REDIS=true` to run without Redis (queue functionality will be disabled).
   - If you need queue functionality and have Redis installed:
     - Set `SKIP_REDIS=false`
     - Configure a dedicated Redis database using `REDIS_DB=N` (where N is 0-15)
     - Optional: Configure custom Redis host/port if needed

4. **File Storage**:
   - Log files are stored in the `logs/` directory and won't conflict with other applications.
   - Screenshots and error images are stored in the project root.

## Usage

### Start the server

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

### API Endpoints

#### LKQ Scraper

- **Start a scraper job**
  ```
  POST /api/scrapers/lkq/run
  ```
  Body:
  ```json
  {
    "maxProducts": 500
  }
  ```

- **Get scraper status**
  ```
  GET /api/scrapers/lkq/status
  ```

## Scrapers

### LKQ Online Scraper

The LKQ scraper extracts product data from the following categories:
- Interior Trim
- Doors

For each product, it extracts:
- Title
- SKU
- Price
- Image URL
- Product URL
- Category

## Development

### Project Structure

```
├── prisma/              # Database schema and migrations
├── src/
│   ├── api/             # API routes and controllers
│   ├── config/          # Configuration files
│   ├── queues/          # Job queue implementation
│   ├── scrapers/        # Scraper implementations
│   ├── services/        # Shared services
│   ├── utils/           # Utility functions
│   └── server.js        # Main application entry point
├── logs/                # Application logs
├── .env                 # Environment variables
└── package.json         # Project dependencies
```

### Adding a New Scraper

1. Create a new scraper file in `src/scrapers/`
2. Implement the scraper interface (see `lkq-scraper.js` for an example)
3. Register the scraper in `src/scrapers/index.js`
4. Create API routes for the scraper in `src/api/routes/`

## License

MIT 