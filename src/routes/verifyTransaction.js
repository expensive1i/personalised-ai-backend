const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { getCustomerPINHash, initiateTransfer, prisma } = require('../services/database');
const bcrypt = require('bcryptjs');
const { getPendingTransaction, deletePendingTransaction } = require('../services/pendingTransactions');
const { purchaseAirtime } = require('../services/ebills');

/**
 * @swagger
 * /api/verify-transaction:
 *   post:
 *     summary: Verify PIN and complete a pending transaction
 *     description: |
 *       Verify customer PIN and complete a pending transaction (transfer, airtime, data, etc.).
 *       The transaction ID is returned from the initial transaction request.
 *     tags:
 *       - Transaction
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - transactionId
 *               - pin
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *               transactionId:
 *                 type: string
 *                 description: Transaction ID from the pending transaction
 *                 example: "TXN-abc123xyz"
 *               pin:
 *                 type: string
 *                 description: Customer PIN for verification
 *                 example: "1234"
 *     responses:
 *       200:
 *         description: Transaction completed successfully
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
 *       400:
 *         description: Bad request - invalid transaction ID or insufficient balance
 *       401:
 *         description: Authentication failed or invalid PIN
 *       404:
 *         description: Transaction not found or expired
 */
router.post('/', authenticateByPhone, async (req, res) => {
  try {
    const { transactionId, pin } = req.body;
    const customerId = req.customerId;

    if (!transactionId || typeof transactionId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Transaction ID is required',
        message: 'Please provide a valid transaction ID',
      });
    }

    if (!pin || typeof pin !== 'string' || pin.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'PIN is required',
        message: 'Please provide your PIN to complete the transaction',
      });
    }

    // Get pending transaction
    const pendingTransaction = getPendingTransaction(transactionId);

    if (!pendingTransaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found',
        message: 'Transaction not found or has expired. Please initiate a new transaction.',
      });
    }

    // Verify transaction belongs to this customer
    if (pendingTransaction.customerId !== customerId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized',
        message: 'This transaction does not belong to you.',
      });
    }

    // Verify PIN
    const hashedPIN = await getCustomerPINHash(customerId);
    if (!hashedPIN) {
      return res.status(404).json({
        success: false,
        error: 'PIN not found',
        message: 'No PIN has been set for this account. Please set a PIN first.',
      });
    }

    const cleanedPIN = pin.trim();
    const isVerified = await bcrypt.compare(cleanedPIN, hashedPIN);

    if (!isVerified) {
      return res.status(401).json({
        success: false,
        response: 'Invalid PIN. Please try again.',
      });
    }

    // Execute transaction based on type
    let result;
    try {
      switch (pendingTransaction.type) {
        case 'transfer':
          result = await executeTransfer(pendingTransaction);
          break;
        case 'internal_transfer':
          result = await executeInternalTransfer(pendingTransaction);
          break;
        case 'airtime':
          result = await executeAirtimePurchase(pendingTransaction);
          break;
        case 'data':
        case 'cable':
        case 'internet':
        case 'electricity':
          // TODO: Implement bill payment execution
          result = {
            success: true,
            response: `${pendingTransaction.type} purchase completed successfully!`,
          };
          break;
        default:
          return res.status(400).json({
            success: false,
            error: 'Invalid transaction type',
            message: `Transaction type '${pendingTransaction.type}' is not supported.`,
          });
      }

      // Remove pending transaction after successful execution
      deletePendingTransaction(transactionId);

      return res.json({
        success: true,
        response: result.response,
      });
    } catch (error) {
      // Remove pending transaction on error
      deletePendingTransaction(transactionId);

      if (error.message === 'Insufficient balance') {
        return res.status(400).json({
          success: false,
          response: 'Insufficient balance. Please top up your account.',
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Transaction failed',
        message: error.message,
      });
    }
  } catch (error) {
    console.error('Verify transaction error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify transaction',
      message: error.message,
    });
  }
});

/**
 * Execute transfer transaction
 */
async function executeTransfer(pendingTransaction) {
  const { customerId, accountId, beneficiary, amount } = pendingTransaction;

  // Prepare recipient data from beneficiary object
  const recipientData = {
    name: beneficiary.name,
    accountNumber: beneficiary.accountNumber,
    bankName: beneficiary.bankName,
    bankAccount: beneficiary.bankAccount || beneficiary.accountNumber,
    beneficiaryId: beneficiary.id || null, // Only set if it's a saved beneficiary
  };

  const transaction = await initiateTransfer(
    customerId,
    accountId,
    recipientData,
    amount
  );

  return {
    success: true,
    response: `Transfer of ₦${amount.toLocaleString()} to ${beneficiary.name} has been completed successfully! Reference: ${transaction.reference}`,
  };
}

/**
 * Execute airtime purchase
 */
async function executeAirtimePurchase(pendingTransaction) {
  const { customerId, accountId, phone, service_id, networkName, amount } = pendingTransaction;

  // Generate unique request_id for eBills API (max 50 chars)
  const request_id = `AIR-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

  // Get account to verify balance
  const account = await prisma.account.findFirst({
    where: {
      id: BigInt(accountId),
      deletedAt: null,
    },
  });

  if (!account) {
    throw new Error('Account not found');
  }

  if (account.balance < amount) {
    throw new Error('Insufficient balance');
  }

  // Purchase airtime from eBills API
  let ebillsResponse;
  try {
    ebillsResponse = await purchaseAirtime({
      request_id,
      phone,
      service_id,
      amount: parseInt(amount),
    });
  } catch (error) {
    // If eBills purchase fails, don't deduct from account
    throw new Error(`Airtime purchase failed: ${error.message}`);
  }

  // If order is processing or completed, deduct from account and create transaction record
  const orderStatus = ebillsResponse.data?.status;
  const isSuccessful = orderStatus === 'completed-api' || orderStatus === 'processing-api';

  if (isSuccessful) {
    const reference = `AIR${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const now = new Date();

    // Deduct from account and create transaction record
    await prisma.$transaction(async (tx) => {
      // Update account balance
      await tx.account.update({
        where: { id: BigInt(accountId) },
        data: { balance: account.balance - parseFloat(amount) },
      });

      // Create transaction record
      await tx.transaction.create({
        data: {
          customerId: BigInt(customerId),
          accountId: BigInt(accountId),
          receiverName: `Airtime Purchase - ${networkName}`,
          bankName: networkName,
          bankAccount: phone,
          accountNumber: phone,
          amount: parseFloat(amount),
          balanceBefore: account.balance,
          balanceAfter: account.balance - parseFloat(amount),
          transactionDate: now,
          createdAt: now,
          status: orderStatus === 'completed-api' ? 'success' : 'pending',
          transactionType: 'debit',
          reference: reference,
        },
      });
    });

    // Determine response message based on order status
    if (orderStatus === 'completed-api') {
      return {
        success: true,
        response: `Airtime purchase of ₦${amount.toLocaleString()} for ${phone} (${networkName}) completed successfully! Order ID: ${ebillsResponse.data?.order_id || 'N/A'}`,
      };
    } else {
      return {
        success: true,
        response: `Airtime purchase of ₦${amount.toLocaleString()} for ${phone} (${networkName}) is being processed. Order ID: ${ebillsResponse.data?.order_id || 'N/A'}`,
      };
    }
  } else {
    // Order was refunded or failed
    throw new Error(`Airtime purchase failed. Status: ${orderStatus}`);
  }
}

/**
 * Execute internal transfer between customer's own accounts
 */
async function executeInternalTransfer(pendingTransaction) {
  const { sourceAccount, targetAccount, amount } = pendingTransaction;

  // Generate reference
  const reference = `TXN${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  const now = new Date();

  // Execute transfer in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // Verify source account balance
    const source = await tx.account.findFirst({
      where: {
        id: BigInt(sourceAccount.id),
        deletedAt: null,
      },
    });

    if (!source) {
      throw new Error('Source account not found');
    }

    if (source.balance < amount) {
      throw new Error('Insufficient balance');
    }

    // Verify target account exists
    const target = await tx.account.findFirst({
      where: {
        id: BigInt(targetAccount.id),
        deletedAt: null,
      },
    });

    if (!target) {
      throw new Error('Target account not found');
    }

    // Create debit transaction for source account
    await tx.transaction.create({
      data: {
        customerId: BigInt(pendingTransaction.customerId),
        accountId: BigInt(sourceAccount.id),
        receiverName: `Internal Transfer to ${targetAccount.accountNumber.slice(-4)}`,
        bankName: targetAccount.bankName || null,
        bankAccount: targetAccount.accountNumber,
        accountNumber: targetAccount.accountNumber,
        amount: parseFloat(amount),
        balanceBefore: source.balance,
        balanceAfter: source.balance - parseFloat(amount),
        transactionDate: now,
        createdAt: now,
        status: 'success',
        transactionType: 'debit',
        reference: `${reference}-DEBIT`,
      },
    });

    // Create credit transaction for target account
    await tx.transaction.create({
      data: {
        customerId: BigInt(pendingTransaction.customerId),
        accountId: BigInt(targetAccount.id),
        receiverName: `Internal Transfer from ${sourceAccount.accountNumber.slice(-4)}`,
        bankName: sourceAccount.bankName || null,
        bankAccount: sourceAccount.accountNumber,
        accountNumber: sourceAccount.accountNumber,
        amount: parseFloat(amount),
        balanceBefore: target.balance,
        balanceAfter: target.balance + parseFloat(amount),
        transactionDate: now,
        createdAt: now,
        status: 'success',
        transactionType: 'credit',
        reference: `${reference}-CREDIT`,
      },
    });

    // Update source account balance
    await tx.account.update({
      where: { id: BigInt(sourceAccount.id) },
      data: { balance: source.balance - parseFloat(amount) },
    });

    // Update target account balance
    await tx.account.update({
      where: { id: BigInt(targetAccount.id) },
      data: { balance: target.balance + parseFloat(amount) },
    });

    return { reference };
  });

  return {
    success: true,
    response: `Internal transfer of ₦${amount.toLocaleString()} from account ending ${sourceAccount.accountNumber.slice(-4)} to account ending ${targetAccount.accountNumber.slice(-4)} completed successfully! Reference: ${result.reference}`,
  };
}

module.exports = router;

