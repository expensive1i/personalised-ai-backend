const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const chatRoutes = require('./routes/chat');
const queryAiRoutes = require('./routes/queryAi');
const accountVerificationRoutes = require('./routes/accountVerification');
const pinRoutes = require('./routes/pin');
const registerRoutes = require('./routes/register');
const transferRoutes = require('./routes/transfer');
const verifyTransactionRoutes = require('./routes/verifyTransaction');
const accountRoutes = require('./routes/account');
const internalTransferRoutes = require('./routes/internalTransfer');
const buyAirtimeRoutes = require('./routes/buyAirtime');
const loadMoneyRoutes = require('./routes/loadMoney');
const usersRoutes = require('./routes/users');
const validatePhoneRoutes = require('./routes/users').validatePhoneRouter;

const app = express();

// Swagger configuration
// Determine API URL - prioritize environment variable, then production default, then localhost
let apiUrl;
if (process.env.API_URL) {
  apiUrl = process.env.API_URL.replace(/\/$/, '');
} else if (process.env.NODE_ENV === 'production') {
  apiUrl = 'https://personalize-production-8a33.up.railway.app';
} else {
  apiUrl = `http://localhost:${process.env.PORT || 3000}`;
}

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Natural Language Banking API',
      version: '1.0.0',
      description: 'AI-powered banking assistant API that allows customers to query their transaction data using natural language. All queries are automatically scoped to the authenticated customer based on phone number.',
      contact: {
        name: 'API Support',
      },
    },
    servers: [
      {
        url: apiUrl,
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
        variables: {},
      },
    ],
    components: {
      securitySchemes: {
        phoneAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-phone-number',
          description: 'Customer phone number for authentication',
        },
      },
    },
  },
  apis: ['./src/routes/*.js', './src/app.js'],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger UI configuration
const swaggerUiOptions = {
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    deepLinking: false,
    defaultModelsExpandDepth: 1,
    defaultModelExpandDepth: 1,
    withCredentials: false,
  },
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Natural Language Banking API',
  // Inject custom JavaScript to fix URL generation
  customJs: `
    (function() {
      const serverUrl = '${apiUrl}';
      
      // Override Swagger UI's URL generation
      window.addEventListener('load', function() {
        setTimeout(function() {
          // Function to fix URLs in curl commands and request URLs
          const fixUrls = function() {
            // Fix curl command URLs
            document.querySelectorAll('.curl-command, code, pre').forEach(function(el) {
              if (el.textContent) {
                // Replace malformed URLs that include /api-docs/
                el.textContent = el.textContent.replace(
                  /(https?:\\/\\/[^\\s'"]+)\\/api-docs\\/([^\\s'"]+)/g,
                  serverUrl + '/$2'
                );
                // Also fix URLs that start with /api-docs/
                el.textContent = el.textContent.replace(
                  /(https?:\\/\\/[^\\s'"]+)\\/api-docs\\//g,
                  serverUrl + '/'
                );
              }
            });
            
            // Fix request URL display
            document.querySelectorAll('.request-url, .url').forEach(function(el) {
              if (el.textContent && el.textContent.includes('/api-docs/')) {
                el.textContent = el.textContent.replace(
                  /https?:\\/\\/[^\\/]+\\/api-docs\\//g,
                  serverUrl + '/'
                );
              }
            });
          };
          
          // Run immediately
          fixUrls();
          
          // Watch for changes
          const observer = new MutationObserver(fixUrls);
          const swaggerContainer = document.querySelector('.swagger-ui') || document.body;
          if (swaggerContainer) {
            observer.observe(swaggerContainer, { 
              childList: true, 
              subtree: true,
              characterData: true
            });
          }
          
          // Also fix when "Try it out" is clicked
          document.addEventListener('click', function(e) {
            if (e.target && (e.target.classList.contains('try-out__btn') || e.target.closest('.try-out__btn'))) {
              setTimeout(fixUrls, 100);
            }
          });
        }, 1000);
      });
    })();
  `,
};

// Swagger UI with custom setup to ensure correct URL
app.use('/api-docs', swaggerUi.serve, (req, res, next) => {
  // Clone the spec to avoid mutating the original
  const spec = JSON.parse(JSON.stringify(swaggerSpec));
  
  // Ensure the server URL is absolute and correct
  if (spec.servers && spec.servers.length > 0) {
    spec.servers[0].url = apiUrl;
  }
  
  // Setup Swagger UI with the corrected spec
  const setup = swaggerUi.setup(spec, {
    ...swaggerUiOptions,
    swaggerOptions: {
      ...swaggerUiOptions.swaggerOptions,
      // Explicitly set the server URL
      url: undefined,
      urls: undefined,
      // Ensure Swagger UI doesn't use the current page URL
      deepLinking: false,
    },
  });
  
  return setup(req, res, next);
});

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/query-ai', queryAiRoutes);
app.use('/api/account-verification', accountVerificationRoutes);
app.use('/api', pinRoutes);
app.use('/api', registerRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/verify-transaction', verifyTransactionRoutes);
app.use('/api', accountRoutes);
app.use('/api/internal-transfer', internalTransferRoutes);
app.use('/api/buy-airtime', buyAirtimeRoutes);
app.use('/api/load-money', loadMoneyRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/validate-phone-number', validatePhoneRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

/**
 * @swagger
 * /:
 *   get:
 *     summary: API information
 *     description: Get API information and available endpoints
 *     tags:
 *       - General
 *     responses:
 *       200:
 *         description: API information
 */
app.get('/', (req, res) => {
  res.json({
    message: 'Natural Language Banking API',
    version: '1.0.0',
    description: 'AI-powered banking assistant for transaction queries',
    endpoints: {
      queryAi: {
        post: 'POST /api/query-ai - Query AI with natural language (requires phoneNumber)',
      },
      accountVerification: {
        post: 'POST /api/account-verification - Verify bank account number (requires phoneNumber)',
      },
      pin: {
        setPin: 'POST /api/set-pin - Set or update customer PIN (requires phoneNumber)',
        verifyPin: 'POST /api/verify-pin - Verify customer PIN (requires phoneNumber)',
      },
      register: {
        registerAccount: 'POST /api/register-account - Register new customer account',
      },
      transfer: {
        post: 'POST /api/transfer - Transfer money using natural language (requires phoneNumber)',
      },
      verifyTransaction: {
        post: 'POST /api/verify-transaction - Verify PIN and complete pending transaction (requires phoneNumber, transactionId, pin)',
      },
      account: {
        createAccount: 'POST /api/create-account - Create additional account for customer (requires phoneNumber)',
        listAccounts: 'GET /api/list-accounts - List all customer accounts (requires phoneNumber)',
        getBalance: 'GET /api/balance - Get account balance for customer (requires phoneNumber)',
      },
      internalTransfer: {
        post: 'POST /api/internal-transfer - Transfer money between customer\'s own accounts (requires phoneNumber)',
      },
      buyAirtime: {
        post: 'POST /api/buy-airtime - Purchase airtime using natural language (requires phoneNumber)',
      },
      loadMoney: {
        post: 'POST /api/load-money - Load money into customer account (requires phoneNumber, amount)',
      },
      chat: {
        post: 'POST /api/chat - Legacy chat endpoint',
        history: 'GET /api/chat/history/:customerId',
        clearHistory: 'DELETE /api/chat/history/:customerId',
      },
      docs: 'GET /api-docs - Swagger API documentation',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

module.exports = app;

