const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { getAccountBalance, prisma } = require('../services/database');

/**
 * @swagger
 * /api/load-money:
 *   post:
 *     summary: Load money into customer account
 *     description: |
 *       Adds money to the authenticated customer's account.
 *       The amount will be credited to the customer's first account.
 *       A credit transaction record will be created.
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
 *               - amount
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *               amount:
 *                 type: number
 *                 description: Amount to load into account (in NGN)
 *                 minimum: 1
 *                 example: 10000
 *     responses:
 *       200:
 *         description: Money loaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                   description: Success message
 *                 data:
 *                   type: object
 *                   properties:
 *                     accountNumber:
 *                       type: string
 *                     balanceBefore:
 *                       type: number
 *                     balanceAfter:
 *                       type: number
 *                     amount:
 *                       type: number
 *                     reference:
 *                       type: string
 *       400:
 *         description: Bad request - invalid amount or no account found
 *       401:
 *         description: Authentication failed
 */
router.post('/', authenticateByPhone, async (req, res) => {
  try {
    const { amount } = req.body;
    const customerId = req.customerId;

    // Validate amount
    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount',
        message: 'Please provide a valid amount greater than 0',
      });
    }

    // Get customer accounts
    const accounts = await getAccountBalance(customerId);
    if (!accounts || accounts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No account found',
        message: 'No account found. Please create an account first.',
      });
    }

    // Use first account for loading money
    const account = accounts[0];

    // Generate reference
    const reference = `LOAD${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const now = new Date();

    // Load money into account and create transaction record
    const result = await prisma.$transaction(async (tx) => {
      // Get current account balance
      const currentAccount = await tx.account.findFirst({
        where: {
          id: BigInt(account.id),
          deletedAt: null,
        },
      });

      if (!currentAccount) {
        throw new Error('Account not found');
      }

      // Convert Decimal balance to number for calculation
      const balanceBeforeNum = currentAccount.balance?.toNumber ? currentAccount.balance.toNumber() : Number(currentAccount.balance);
      const amountNum = parseFloat(amount);
      const balanceAfterNum = balanceBeforeNum + amountNum;

      // Update account balance (Prisma will convert number to Decimal)
      await tx.account.update({
        where: { id: BigInt(account.id) },
        data: { balance: balanceAfterNum },
      });

      // Create credit transaction record
      const transaction = await tx.transaction.create({
        data: {
          customerId: BigInt(customerId),
          accountId: BigInt(account.id),
          receiverName: 'Account Top-up',
          bankName: account.bankName || null,
          bankAccount: account.accountNumber,
          accountNumber: account.accountNumber,
          amount: amountNum,
          balanceBefore: balanceBeforeNum,
          balanceAfter: balanceAfterNum,
          transactionDate: now,
          createdAt: now,
          status: 'success',
          transactionType: 'credit',
          reference: reference,
        },
      });

      return {
        transaction,
        balanceBefore: balanceBeforeNum,
        balanceAfter: balanceAfterNum,
      };
    });

    // Response data (already converted to numbers in transaction)
    const responseData = {
      accountNumber: account.accountNumber,
      balanceBefore: Number(result.balanceBefore),
      balanceAfter: Number(result.balanceAfter),
      amount: parseFloat(amount),
      reference: reference,
    };

    res.json({
      success: true,
      response: `Successfully loaded ₦${amount.toLocaleString()} into your account. New balance: ₦${responseData.balanceAfter.toLocaleString()}`,
      data: responseData,
    });

  } catch (error) {
    console.error('Load money route error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load money',
      message: error.message,
    });
  }
});

module.exports = router;

