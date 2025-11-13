const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { getAccountBalance, prisma } = require('../services/database');
const { createPendingTransaction } = require('../services/pendingTransactions');

/**
 * @swagger
 * /api/manual-transfer:
 *   post:
 *     summary: Initiate manual transfer by account numbers
 *     description: |
 *       Transfer money from a source account to a receiver account using account numbers.
 *       This endpoint creates a pending transaction that requires PIN verification via /api/verify-transaction.
 *       
     *       The system will:
     *       1. Verify the source account belongs to the authenticated customer
     *       2. Check account balance
     *       3. Create a pending transaction
     *       4. Return transactionId for PIN verification
     *       
     *       Note: Receiver account verification will be handled in the verify-transaction endpoint.
 *     tags:
 *       - Transfer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - sourceAccountNumber
 *               - receiverAccountNumber
 *               - amount
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *               sourceAccountNumber:
 *                 type: string
 *                 description: Source account number (must belong to authenticated customer)
 *                 example: "1234567890"
 *               receiverAccountNumber:
 *                 type: string
 *                 description: Receiver account number (will be verified via Paystack)
 *                 example: "0987654321"
 *               amount:
 *                 type: number
 *                 description: Transfer amount
 *                 example: 10000
 *     responses:
 *       200:
 *         description: Transfer request created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                   description: Success message with transaction details
 *                 transactionId:
 *                   type: string
 *                   description: Transaction ID for PIN verification
 *                   example: "TXN-1703123456789-ABC123"
 *       400:
 *         description: Bad request - invalid account or insufficient balance
 *       401:
 *         description: Authentication failed
 *       404:
 *         description: Account not found
 */
router.post('/', authenticateByPhone, async (req, res) => {
  try {
    const { sourceAccountNumber, receiverAccountNumber, amount } = req.body;
    const customerId = req.customerId;

    // Validate required fields
    if (!sourceAccountNumber || typeof sourceAccountNumber !== 'string' || sourceAccountNumber.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Source account number is required',
        message: 'Please provide a valid source account number',
      });
    }

    if (!receiverAccountNumber || typeof receiverAccountNumber !== 'string' || receiverAccountNumber.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Receiver account number is required',
        message: 'Please provide a valid receiver account number',
      });
    }

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid amount is required',
        message: 'Please provide a valid transfer amount greater than 0',
      });
    }

    const transferAmount = parseFloat(amount);

    // Validate account number format (10 digits)
    if (sourceAccountNumber.length !== 10 || !/^\d+$/.test(sourceAccountNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid source account number format',
        message: 'Source account number must be exactly 10 digits',
      });
    }

    if (receiverAccountNumber.length !== 10 || !/^\d+$/.test(receiverAccountNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid receiver account number format',
        message: 'Receiver account number must be exactly 10 digits',
      });
    }

    // Check if source and receiver are the same
    if (sourceAccountNumber === receiverAccountNumber) {
      return res.status(400).json({
        success: false,
        error: 'Invalid transfer',
        message: 'Source and receiver account numbers cannot be the same',
      });
    }

    // Find source account and verify it belongs to the customer
    const sourceAccount = await prisma.account.findFirst({
      where: {
        accountNumber: sourceAccountNumber.trim(),
        customerId: BigInt(customerId),
        deletedAt: null,
      },
    });

    if (!sourceAccount) {
      return res.status(404).json({
        success: false,
        error: 'Source account not found',
        message: `Account number ${sourceAccountNumber} not found or does not belong to you`,
      });
    }

    // Check balance
    const balance = sourceAccount.balance?.toNumber ? sourceAccount.balance.toNumber() : Number(sourceAccount.balance);
    if (balance < transferAmount) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient balance',
        message: `Insufficient balance. Your current balance is ₦${balance.toLocaleString()}.`,
      });
    }

    // Check if receiver account is in our system
    const receiverAccount = await prisma.account.findFirst({
      where: {
        accountNumber: receiverAccountNumber.trim(),
        deletedAt: null,
      },
      include: {
        customer: {
          select: {
            id: true,
            customerName: true,
          },
        },
      },
    });

    // Create pending transaction (receiver account verification will be done in verify-transaction)
    const transactionId = createPendingTransaction({
      type: 'transfer',
      customerId: customerId,
      data: {
        accountId: Number(sourceAccount.id),
        sourceAccountNumber: sourceAccountNumber.trim(),
        receiverAccountNumber: receiverAccountNumber.trim(),
        beneficiary: {
          id: receiverAccount?.customer?.id ? Number(receiverAccount.customer.id) : null,
          name: receiverAccount?.customer?.customerName || null,
          accountNumber: receiverAccountNumber.trim(),
          bankName: receiverAccount?.bankName || null,
          bankAccount: receiverAccountNumber.trim(),
          last4Digits: receiverAccountNumber.trim().slice(-4),
          source: 'manual_transfer',
        },
        amount: transferAmount,
        status: 'pending_pin',
      },
    });

    return res.json({
      success: true,
      response: `Transfer of ₦${transferAmount.toLocaleString()} from account ${sourceAccountNumber} to account ${receiverAccountNumber} is ready. Please verify your PIN to complete the transfer.`,
      transactionId: transactionId,
    });
  } catch (error) {
    console.error('Manual transfer error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process manual transfer',
      message: error.message,
    });
  }
});

module.exports = router;

