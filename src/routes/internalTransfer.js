const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { getAccountBalance } = require('../services/database');
const { createPendingTransaction, pendingTransactions } = require('../services/pendingTransactions');

/**
 * @swagger
 * /api/internal-transfer:
 *   post:
 *     summary: Transfer money between customer's own accounts
 *     description: |
 *       Transfer money between accounts belonging to the same customer.
 *       Examples: 
 *       - "Move 10000 to my account"
 *       - "Transfer 10000 to my second account ending with 5685"
 *       - "Send 5000 to account ending 1234"
 *       
 *       The system will:
 *       1. Extract amount and target account (by last 4 digits or position)
 *       2. Check account balance
 *       3. Generate transactionId
 *       4. Request PIN verification via /api/verify-transaction
 *     tags:
 *       - Internal Transfer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - message
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *               message:
 *                 type: string
 *                 description: Natural language transfer request
 *                 example: "Move 10000 to my account ending with 5685"
 *     responses:
 *       200:
 *         description: Transfer request processed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                 transactionId:
 *                   type: string
 *                   nullable: true
 *       400:
 *         description: Bad request - insufficient balance or invalid input
 */
router.post('/', authenticateByPhone, async (req, res) => {
  try {
    const { message } = req.body;
    const customerId = req.customerId;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
        message: 'Please provide a transfer request in natural language',
      });
    }

    // Check if there's a pending internal transfer selection
    const pendingTransaction = Array.from(pendingTransactions.values()).find(
      t => t.customerId === customerId && t.type === 'internal_transfer' && t.status === 'account_selection'
    );

    // If there's a pending account selection, handle selection
    if (pendingTransaction) {
      const selectionResult = await handleAccountSelection(message.trim(), pendingTransaction);
      if (selectionResult) {
        return res.json({
          success: true,
          response: selectionResult.response,
          transactionId: selectionResult.transactionId,
        });
      }
    }

    // Process new internal transfer request
    const result = await processInternalTransferRequest(message.trim(), customerId);

    // Return only success and response
    res.json({
      success: true,
      response: result.response,
      transactionId: result.transactionId || null,
    });
  } catch (error) {
    console.error('Internal transfer route error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process internal transfer request',
      message: error.message,
    });
  }
});

/**
 * Process internal transfer request - extract amount and target account
 */
async function processInternalTransferRequest(message, customerId) {
  // Extract amount from message
  const amountMatch = message.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

  if (!amount) {
    return {
      response: "I need the amount to transfer. For example: 'Move 10000 to my account' or 'Transfer 10000 to my account ending with 5685'",
      transactionId: null,
    };
  }

  // Get all customer accounts
  const accounts = await getAccountBalance(customerId);
  
  if (accounts.length === 0) {
    return {
      response: "You don't have any accounts. Please create an account first.",
      transactionId: null,
    };
  }

  if (accounts.length === 1) {
    return {
      response: "You only have one account. You need at least two accounts to transfer between them.",
      transactionId: null,
    };
  }

  // Extract target account from message
  const accountEndingMatch = message.match(/(?:ending|ending with|ends with)\s+(\d{4})/i);
  const accountEnding = accountEndingMatch ? accountEndingMatch[1] : null;

  // Check account balance (use first account as source)
  const sourceAccount = accounts[0];
  if (sourceAccount.balance < amount) {
    return {
      response: 'You do not have sufficient balance to make transfer. Please top up.',
      transactionId: null,
    };
  }

  // If account ending is specified, find it
  if (accountEnding) {
    const targetAccount = accounts.find(acc => acc.accountNumber.slice(-4) === accountEnding);
    
    if (!targetAccount) {
      const accountEndings = accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
      return {
        response: `I couldn't find an account ending with ${accountEnding}. Your accounts end with: ${accountEndings}`,
        transactionId: null,
      };
    }

    if (targetAccount.id === sourceAccount.id) {
      return {
        response: 'You cannot transfer to the same account. Please select a different account.',
        transactionId: null,
      };
    }

    // Create pending transaction
    const transactionId = createPendingTransaction({
      type: 'internal_transfer',
      customerId: customerId,
      data: {
        sourceAccount: sourceAccount,
        targetAccount: targetAccount,
        amount: amount,
        status: 'pending_pin',
      },
    });

    return {
      response: `I'll transfer ₦${amount.toLocaleString()} from account ending ${sourceAccount.accountNumber.slice(-4)} to account ending ${targetAccount.accountNumber.slice(-4)}. Please verify your PIN to complete the transfer.`,
      transactionId: transactionId,
      action: 'verify_pin',
    };
  }

  // No specific account mentioned - ask user to select
  const accountEndings = accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
  const transactionId = createPendingTransaction({
    type: 'internal_transfer',
    customerId: customerId,
    data: {
      sourceAccount: sourceAccount,
      accounts: accounts,
      amount: amount,
      status: 'account_selection',
    },
  });

  return {
    response: `I found ${accounts.length} accounts ending with: ${accountEndings}. Which account should I transfer ₦${amount.toLocaleString()} to? Please specify by account ending digits (e.g., "5685").`,
    transactionId: transactionId,
    action: 'select_account',
  };
}

/**
 * Handle account selection for internal transfer
 */
async function handleAccountSelection(message, pendingTransaction) {
  const accountEndingMatch = message.match(/(\d{4})/);
  const accountEnding = accountEndingMatch ? accountEndingMatch[1] : null;

  if (!accountEnding) {
    const accountEndings = pendingTransaction.accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
    return {
      response: `I didn't understand. Please specify which account ending: ${accountEndings}?`,
      transactionId: pendingTransaction.id,
      action: 'select_account',
    };
  }

  const targetAccount = pendingTransaction.accounts.find(
    acc => acc.accountNumber.slice(-4) === accountEnding
  );

  if (!targetAccount) {
    const accountEndings = pendingTransaction.accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
    return {
      response: `I couldn't find an account ending with ${accountEnding}. Your accounts end with: ${accountEndings}`,
      transactionId: pendingTransaction.id,
      action: 'select_account',
    };
  }

  if (targetAccount.id === pendingTransaction.sourceAccount.id) {
    return {
      response: 'You cannot transfer to the same account. Please select a different account.',
      transactionId: pendingTransaction.id,
      action: 'select_account',
    };
  }

  // Update pending transaction to PIN verification stage
  pendingTransaction.targetAccount = targetAccount;
  pendingTransaction.status = 'pending_pin';
  delete pendingTransaction.accounts;

  return {
    response: `I'll transfer ₦${pendingTransaction.amount.toLocaleString()} from account ending ${pendingTransaction.sourceAccount.accountNumber.slice(-4)} to account ending ${targetAccount.accountNumber.slice(-4)}. Please verify your PIN to complete the transfer.`,
    transactionId: pendingTransaction.id,
    action: 'verify_pin',
  };
}

module.exports = router;
module.exports.processInternalTransferRequest = processInternalTransferRequest;
module.exports.handleAccountSelection = handleAccountSelection;

