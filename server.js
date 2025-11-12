require('dotenv').config();

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  console.error('Please set these in your .env file or environment variables.');
  process.exit(1);
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Give time for logs to flush before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle unhandled promise rejections (don't exit immediately - log and continue)
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
  // Log but don't exit - let the server continue running
  // This prevents premature exits from non-critical async errors
});

let app;
try {
  app = require('./src/app');
} catch (error) {
  console.error('❌ Failed to load app:', error);
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

// Start server with error handling
const server = app.listen(PORT, () => {
  const apiUrl = process.env.API_URL || `http://localhost:${PORT}`;
  console.log(`🚀 Natural Language Banking API running on port ${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 API URL: ${apiUrl}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  POST   /api/chat`);
  console.log(`  GET    /api/chat/history/:customerId`);
  console.log(`  DELETE /api/chat/history/:customerId`);
  console.log(`  POST   /api/transfer`);
  console.log(`  POST   /api/buy-airtime`);
  console.log(`  POST   /api/load-money`);
  console.log(`  POST   /api/verify-transaction`);
  console.log(`  POST   /api/query-ai`);
  console.log(`  POST   /api/account-verification`);
  console.log(`  POST   /api/register-account`);
  console.log(`  POST   /api/create-account`);
  console.log(`  GET    /api/list-accounts`);
  console.log(`  GET    /api/balance`);
  console.log(`  POST   /api/internal-transfer`);
  console.log(`  POST   /api/set-pin`);
  console.log(`  POST   /api/verify-pin`);
  console.log(`  GET    /health`);
  console.log(`  GET    /api-docs`);
  console.log(`\n✅ Server is ready to accept connections`);
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
  } else {
    console.error('❌ Server error:', error);
  }
  process.exit(1);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  server.close(() => {
    console.log('✅ HTTP server closed');
    // Close Prisma connection
    const { prisma } = require('./src/services/database');
    prisma.$disconnect()
      .then(() => {
        console.log('✅ Database connection closed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('❌ Error closing database connection:', error);
        process.exit(1);
      });
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('❌ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

