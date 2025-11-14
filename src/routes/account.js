const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { generateAccountNumber, getAccountBalance, prisma } = require('../services/database');
const { normalizeAccountNumber } = require('../utils/networkDetector');

/**
 * @swagger
 * /api/create-account:
 *   post:
 *     summary: Create an additional account for authenticated customer
 *     description: |
 *       Creates a new account for the authenticated customer.
 *       Customers can have multiple accounts. The account number is auto-generated.
 *       Bank name is set to "Zenith" by default.
 *     tags:
 *       - Account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *     responses:
 *       201:
 *         description: Account created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     accountNumber:
 *                       type: string
 *                     balance:
 *                       type: number
 *                     currency:
 *                       type: string
 *                     bankName:
 *                       type: string
 *       400:
 *         description: Bad request
 *       401:
 *         description: Authentication failed
 */
router.post('/create-account', authenticateByPhone, async (req, res) => {
  try {
    const customerId = req.customerId;

    // Generate unique account number
    const accountNumber = await generateAccountNumber();

    // Create account with Zenith as bank name
    const account = await prisma.account.create({
      data: {
        customerId: BigInt(customerId),
        accountNumber: accountNumber,
        balance: 0.00, // Explicitly set to 0.00
        currency: 'NGN',
        bankName: 'Zenith',
      },
      select: {
        id: true,
        accountNumber: true,
        balance: true,
        currency: true,
        bankName: true,
        createdAt: true,
      },
    });

    // Convert BigInt IDs and Decimal values to numbers
    const accountData = {
      id: Number(account.id),
      accountNumber: account.accountNumber,
      balance: account.balance?.toNumber ? account.balance.toNumber() : Number(account.balance),
      currency: account.currency,
      bankName: account.bankName,
      createdAt: account.createdAt,
    };

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: accountData,
    });
  } catch (error) {
    console.error('Create account error:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: 'Account creation failed',
        message: 'Account number already exists. Please try again.',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to create account',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/list-accounts:
 *   get:
 *     summary: Get all account details and balances for authenticated customer
 *     description: |
 *       Returns all accounts belonging to the authenticated customer with their details and balances.
 *       If the customer has multiple accounts, all accounts will be returned with their individual balances.
 *     tags:
 *       - Account
 *     parameters:
 *       - in: query
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer phone number for authentication
 *         example: "+2348012345678"
 *     responses:
 *       200:
 *         description: List of customer accounts with balances
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                   description: Success message with account count
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalAccounts:
 *                       type: integer
 *                       description: Total number of accounts
 *                     totalBalance:
 *                       type: number
 *                       description: Sum of all account balances
 *                     accounts:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                           accountNumber:
 *                             type: string
 *                           balance:
 *                             type: number
 *                           currency:
 *                             type: string
 *                           bankName:
 *                             type: string
 *                             nullable: true
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *       400:
 *         description: No accounts found
 *       401:
 *         description: Authentication failed
 */
router.get('/list-accounts', authenticateByPhone, async (req, res) => {
  try {
    const customerId = req.customerId;

    const accounts = await getAccountBalance(customerId);

    if (!accounts || accounts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No accounts found',
        message: 'No accounts found. Please create an account first.',
      });
    }

    // Calculate total balance across all accounts
    const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

    // Format response with account details
    const response = {
      success: true,
      response: `You have ${accounts.length} account(s) with a total balance of ₦${totalBalance.toLocaleString()}`,
      data: {
        totalAccounts: accounts.length,
        totalBalance: totalBalance,
        accounts: accounts.map(acc => ({
          id: acc.id,
          accountNumber: normalizeAccountNumber(acc.accountNumber) || acc.accountNumber,
          balance: acc.balance,
          currency: acc.currency || 'NGN',
          bankName: acc.bankName,
          createdAt: acc.createdAt,
        })),
      },
    };

    res.json(response);
  } catch (error) {
    console.error('List accounts error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list accounts',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/balance:
 *   get:
 *     summary: Get account balance for authenticated customer
 *     description: |
 *       Returns the balance for the authenticated customer's first account.
 *       If the customer has multiple accounts, returns the balance of the first account.
 *     tags:
 *       - Account
 *     parameters:
 *       - in: query
 *         name: phoneNumber
 *         required: true
 *         schema:
 *           type: string
 *         description: Customer phone number for authentication
 *         example: "+2348012345678"
 *     responses:
 *       200:
 *         description: Account balance retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                   description: Success message with balance
 *                 data:
 *                   type: object
 *                   properties:
 *                     accountNumber:
 *                       type: string
 *                     balance:
 *                       type: number
 *                     currency:
 *                       type: string
 *                     bankName:
 *                       type: string
 *       400:
 *         description: No account found
 *       401:
 *         description: Authentication failed
 */
router.get('/balance', authenticateByPhone, async (req, res) => {
  try {
    const customerId = req.customerId;

    const accounts = await getAccountBalance(customerId);

    if (!accounts || accounts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No account found',
        message: 'No account found. Please create an account first.',
      });
    }

    // Get first account balance
    const account = accounts[0];

    // Normalize account number to remove spaces
    const normalizedAccountNumber = normalizeAccountNumber(account.accountNumber) || account.accountNumber;
    
    res.json({
      success: true,
      response: `Your account balance is ₦${account.balance.toLocaleString()}`,
      data: {
        accountNumber: normalizedAccountNumber,
        balance: account.balance,
        currency: account.currency,
        bankName: account.bankName,
      },
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get balance',
      message: error.message,
    });
  }
});

module.exports = router;

