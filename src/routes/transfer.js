const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { getAccountBalance, searchBeneficiaries } = require('../services/database');
const { extractIntentWithGemini } = require('../services/llm');
const { createPendingTransaction, pendingTransactions } = require('../services/pendingTransactions');
const { verifyAccount } = require('../services/bankVerification');

/**
 * @swagger
 * /api/transfer:
 *   post:
 *     summary: Initiate money transfer using natural language
 *     description: |
 *       Transfer money to a beneficiary using natural language.
 *       Examples: 
 *       - "Send 10000 to Sarah Mohammed" (by name)
 *       - "Send 10000 to 0782435755" (by account number)
 *       - "Transfer ₦5000 to Mohammed Sani"
 *       
 *       The system will:
 *       1. If account number is provided, verify it using Paystack API
 *       2. If name is provided, search in Beneficiaries, Customer, and Transaction tables
 *       3. If multiple matches found, ask for confirmation
 *       4. Check account balance
 *       5. Request PIN verification
 *       6. Execute transfer once confirmed
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
 *               - message
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *               message:
 *                 type: string
 *                 description: Natural language transfer request (can include name or account number)
 *                 example: "Send 10000 to Sarah Mohammed"
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
 *                   description: AI response message
 *                 transactionId:
 *                   type: string
 *                   nullable: true
 *                   description: Transaction ID for PIN verification (when action is verify_pin or select_beneficiary)
 *                   example: "TXN-1703123456789-ABC123"
 *                 action:
 *                   type: string
 *                   nullable: true
 *                   description: Action type (select_beneficiary, verify_pin)
 *       400:
 *         description: Bad request - insufficient balance or invalid input
 *       401:
 *         description: Authentication failed or invalid PIN
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

    const trimmedMessage = message.trim();

    // Validate message contains transfer-related keywords or valid patterns
    if (!isValidTransferMessage(trimmedMessage)) {
      return res.json({
        success: true,
        response: "Your message is not clear. Please provide a transfer request like 'Send 10000 to Sarah Mohammed' or 'Send 10000 to 0782435755'",
      });
    }

    // Check if there's a pending transaction for this customer
    const pendingTransaction = Array.from(pendingTransactions.values()).find(
      t => t.customerId === customerId && t.type === 'transfer' && (t.status === 'beneficiary_selection' || t.status === 'account_selection')
    );

    // If there's a pending account selection, handle it first
    if (pendingTransaction && pendingTransaction.status === 'account_selection') {
      const selectionResult = await handleAccountSelection(trimmedMessage, pendingTransaction);
      if (selectionResult) {
        return res.json({
          success: true,
          response: selectionResult.response,
          transactionId: selectionResult.transactionId,
        });
      }
      return res.json({
        success: true,
        response: "Your message is not clear. Please provide the account ending digits (e.g., '2725' or '0833') or say 'first' or 'second'.",
      });
    }

    // If there's a pending beneficiary selection, handle selection
    if (pendingTransaction && pendingTransaction.status === 'beneficiary_selection') {
      // Validate that the selection message makes sense
      if (!isValidSelectionMessage(trimmedMessage, pendingTransaction)) {
        return res.json({
          success: true,
          response: "Your message is not clear. Please provide the account ending digits (e.g., '2725' or '0833') or say 'first' or 'second'.",
        });
      }

      const selectionResult = await handleBeneficiarySelection(trimmedMessage, pendingTransaction);
      if (selectionResult) {
        return res.json({
          success: true,
          response: selectionResult.response,
          transactionId: selectionResult.transactionId,
        });
      }
      
      // If selection couldn't be processed, return simple error without transactionId
      return res.json({
        success: true,
        response: "Your message is not clear. Please provide the account ending digits or say 'first' or 'second'.",
      });
    }

    // Process new transfer request
    const result = await processTransferRequest(trimmedMessage, customerId);

    // Return only success and response
    res.json({
      success: true,
      response: result.response,
      transactionId: result.transactionId || null,
    });
  } catch (error) {
    console.error('Transfer route error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process transfer request',
      message: error.message,
    });
  }
});

/**
 * Process transfer request - extract amount and recipient name
 */
async function processTransferRequest(message, customerId) {
  // Use Gemini to extract transfer intent
  const intent = await extractIntentWithGemini(message, []);

  // Extract amount from message
  const amountMatch = message.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

  if (!amount) {
    return {
      response: "I need the amount to transfer. For example: 'Send 10000 to Sarah Mohammed' or 'Send 10000 to 0782435755'",
      action: null,
    };
  }

  // Check if message contains an account number (10 digits)
  const accountNumberMatch = message.match(/\b(\d{10})\b/);
  let accountNumber = null;
  let recipientName = null;

  if (accountNumberMatch) {
    // Account number found - verify it
    accountNumber = accountNumberMatch[1];
  } else {
    // Try to extract recipient name (simple extraction - can be improved)
    const namePatterns = [
      /to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /send.*?to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
      /transfer.*?to\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    ];

    for (const pattern of namePatterns) {
      const match = message.match(pattern);
      if (match) {
        recipientName = match[1].trim();
        break;
      }
    }
  }

  if (!accountNumber && !recipientName) {
    return {
      response: "I need either a recipient name or account number. For example: 'Send 10000 to Sarah Mohammed' or 'Send 10000 to 0782435755'",
      action: null,
    };
  }

  // Check account balance first
  const accounts = await getAccountBalance(customerId);
  if (accounts.length === 0) {
    return {
      response: "You don't have an active account. Please contact support.",
      action: null,
    };
  }

  // If customer has multiple accounts, ask them to select which account to use
  if (accounts.length > 1) {
    // Check if any account has sufficient balance
    const accountsWithBalance = accounts.filter(acc => acc.balance >= amount);
    if (accountsWithBalance.length === 0) {
      return {
        response: 'You do not have sufficient balance in any account to make this transfer. Please top up.',
        action: null,
      };
    }

    // Create pending transaction for account selection
    const accountEndings = accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
    const transactionId = createPendingTransaction({
      type: 'transfer',
      customerId: customerId,
      data: {
        accounts: accounts,
        amount: amount,
        recipientName: recipientName,
        accountNumber: accountNumber,
        status: 'account_selection',
      },
    });

    return {
      response: `You have ${accounts.length} accounts. Which account should I deduct from? Accounts ending: ${accountEndings}?`,
      transactionId: transactionId,
      action: 'select_account',
    };
  }

  // Single account - proceed with that account
  const account = accounts[0];
  if (account.balance < amount) {
    // Generate AI response (10-12 words exactly)
    return {
      response: 'You do not have sufficient balance to make transfer. Please top up.',
      action: null,
    };
  }

  // If account number is provided, verify it first
  if (accountNumber) {
    try {
      const accountDetails = await verifyAccount(accountNumber);
      
      // Create pending transaction with verified account details
      const transactionId = createPendingTransaction({
        type: 'transfer',
        customerId: customerId,
        data: {
          beneficiary: {
            id: null,
            name: accountDetails.account_name,
            accountNumber: accountDetails.account_number,
            bankName: accountDetails.bank_name,
            bankAccount: accountDetails.account_number,
            last4Digits: accountDetails.account_number.slice(-4),
            source: 'account_verification',
          },
          amount: amount,
          accountId: account.id,
          status: 'pending_pin',
        },
      });

      return {
        response: `I verified account ${accountDetails.account_number} belongs to ${accountDetails.account_name} at ${accountDetails.bank_name}. Please verify your PIN to complete the transfer of ₦${amount.toLocaleString()}.`,
        transactionId: transactionId,
        action: 'verify_pin',
      };
    } catch (error) {
      console.error('Account verification error:', error);
      return {
        response: `I couldn't verify account number ${accountNumber}. Please check the account number and try again.`,
        action: null,
      };
    }
  }

  // Search for beneficiaries by name
  const beneficiaries = await searchBeneficiaries(customerId, recipientName);

  if (beneficiaries.length === 0) {
    return {
      response: `We did not find that user "${recipientName}". Please verify the name or try using an account number instead.`,
      action: null,
    };
  }

  if (beneficiaries.length === 1) {
    // Single match - create pending transaction and ask for PIN verification
    const transactionId = createPendingTransaction({
      type: 'transfer',
      customerId: customerId,
      data: {
        beneficiary: beneficiaries[0],
        amount: amount,
        accountId: account.id,
        status: 'pending_pin',
      },
    });

    return {
      response: `I found ${beneficiaries[0].name} with account ending in ${beneficiaries[0].last4Digits}. Please verify your PIN to complete the transfer of ₦${amount.toLocaleString()}.`,
      transactionId: transactionId,
      action: 'verify_pin',
    };
  }

  // Multiple matches - ask for confirmation
  const accountEndings = beneficiaries.map(b => b.last4Digits).join(', ');
  const transactionId = createPendingTransaction({
    type: 'transfer',
    customerId: customerId,
    data: {
      beneficiaries: beneficiaries,
      amount: amount,
      accountId: account.id,
      recipientName: recipientName,
      status: 'beneficiary_selection',
    },
  });

  return {
    response: `I found ${beneficiaries.length} people named "${recipientName}". Please confirm which account ending: ${accountEndings}?`,
    transactionId: transactionId,
    action: 'select_beneficiary',
  };
}

/**
 * Handle account selection for transfer (which account to deduct from)
 */
async function handleAccountSelection(message, pendingTransaction) {
  const accountEndingMatch = message.match(/(\d{4})/);
  const accountEnding = accountEndingMatch ? accountEndingMatch[1] : null;

  if (!accountEnding) {
    // Try to extract by position (first, second, etc.)
    const lowerMessage = message.toLowerCase().trim();
    const numberMatch = lowerMessage.match(/(\d+)|(first|second|third|fourth|fifth|one|two|three|four|five)/i);
    
    if (numberMatch) {
      let index = 0;
      if (numberMatch[1]) {
        index = parseInt(numberMatch[1]) - 1;
      } else {
        const words = ['first', 'second', 'third', 'fourth', 'fifth', 'one', 'two', 'three', 'four', 'five'];
        const wordIndex = words.findIndex(w => lowerMessage.includes(w));
        if (wordIndex >= 0 && wordIndex < 5) {
          index = wordIndex % 5; // Map 'one' to 0, 'two' to 1, etc.
        }
      }
      
      if (index >= 0 && index < pendingTransaction.accounts.length) {
        const selectedAccount = pendingTransaction.accounts[index];
        
        // Check balance
        if (selectedAccount.balance < pendingTransaction.amount) {
          const accountEndings = pendingTransaction.accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
          return {
            response: `Insufficient balance in account ending ${selectedAccount.accountNumber.slice(-4)}. Your accounts end with: ${accountEndings}`,
            transactionId: pendingTransaction.id,
            action: 'select_account',
          };
        }

        // Update pending transaction with selected account
        pendingTransaction.sourceAccount = selectedAccount;
        pendingTransaction.accountId = selectedAccount.id;
        pendingTransaction.amount = pendingTransaction.amount || pendingTransaction.data?.amount;
        pendingTransaction.recipientName = pendingTransaction.recipientName || pendingTransaction.data?.recipientName;
        pendingTransaction.accountNumber = pendingTransaction.accountNumber || pendingTransaction.data?.accountNumber;
        pendingTransaction.status = 'processing';
        delete pendingTransaction.accounts;
        
        // Update in Map
        pendingTransactions.set(pendingTransaction.id, pendingTransaction);

        // Continue with transfer processing
        return await continueTransferAfterAccountSelection(pendingTransaction);
      }
    }

    const accountEndings = pendingTransaction.accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
    return {
      response: `I didn't understand. Please specify which account ending: ${accountEndings}?`,
      transactionId: pendingTransaction.id,
      action: 'select_account',
    };
  }

  const selectedAccount = pendingTransaction.accounts.find(
    acc => acc.accountNumber.slice(-4) === accountEnding
  );

  if (!selectedAccount) {
    const accountEndings = pendingTransaction.accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
    return {
      response: `I couldn't find an account ending with ${accountEnding}. Your accounts end with: ${accountEndings}`,
      transactionId: pendingTransaction.id,
      action: 'select_account',
    };
  }

  // Check balance
  if (selectedAccount.balance < pendingTransaction.amount) {
    const accountEndings = pendingTransaction.accounts.map(acc => acc.accountNumber.slice(-4)).join(', ');
    return {
      response: `Insufficient balance in account ending ${accountEnding}. Your accounts end with: ${accountEndings}`,
      transactionId: pendingTransaction.id,
      action: 'select_account',
    };
  }

  // Update pending transaction with selected account
  pendingTransaction.sourceAccount = selectedAccount;
  pendingTransaction.accountId = selectedAccount.id;
  pendingTransaction.amount = pendingTransaction.amount || pendingTransaction.data?.amount;
  pendingTransaction.recipientName = pendingTransaction.recipientName || pendingTransaction.data?.recipientName;
  pendingTransaction.accountNumber = pendingTransaction.accountNumber || pendingTransaction.data?.accountNumber;
  pendingTransaction.status = 'processing';
  delete pendingTransaction.accounts;
  
  // Update in Map
  pendingTransactions.set(pendingTransaction.id, pendingTransaction);

  // Continue with transfer processing
  return await continueTransferAfterAccountSelection(pendingTransaction);
}

/**
 * Continue transfer processing after account selection
 */
async function continueTransferAfterAccountSelection(pendingTransaction) {
  const amount = pendingTransaction.amount || pendingTransaction.data?.amount;
  const accountId = pendingTransaction.accountId;
  const accountNumber = pendingTransaction.accountNumber || pendingTransaction.data?.accountNumber;
  const recipientName = pendingTransaction.recipientName || pendingTransaction.data?.recipientName;

  // If account number is provided, verify it first
  if (accountNumber) {
    try {
      const { verifyAccount } = require('../services/bankVerification');
      const accountDetails = await verifyAccount(accountNumber);
      
      // Update pending transaction with verified account details
      pendingTransaction.beneficiary = {
        id: null,
        name: accountDetails.account_name,
        accountNumber: accountDetails.account_number,
        bankName: accountDetails.bank_name,
        bankAccount: accountDetails.account_number,
        last4Digits: accountDetails.account_number.slice(-4),
        source: 'account_verification',
      };
      pendingTransaction.status = 'pending_pin';
      
      // Update in Map
      pendingTransactions.set(pendingTransaction.id, pendingTransaction);

      return {
        response: `I verified account ${accountDetails.account_number} belongs to ${accountDetails.account_name} at ${accountDetails.bank_name}. Please verify your PIN to complete the transfer of ₦${amount.toLocaleString()}.`,
        transactionId: pendingTransaction.id,
        action: 'verify_pin',
      };
    } catch (error) {
      console.error('Account verification error:', error);
      return {
        response: `I couldn't verify account number ${accountNumber}. Please check the account number and try again.`,
        action: null,
      };
    }
  }

  // Search for beneficiaries by name
  const { searchBeneficiaries } = require('../services/database');
  const beneficiaries = await searchBeneficiaries(pendingTransaction.customerId, recipientName);

  if (beneficiaries.length === 0) {
    return {
      response: `We did not find that user "${recipientName}". Please verify the name or try using an account number instead.`,
      action: null,
    };
  }

  if (beneficiaries.length === 1) {
    // Single match - update pending transaction and ask for PIN verification
    pendingTransaction.beneficiary = beneficiaries[0];
    pendingTransaction.status = 'pending_pin';
    
    // Update in Map
    pendingTransactions.set(pendingTransaction.id, pendingTransaction);

    return {
      response: `I found ${beneficiaries[0].name} with account ending in ${beneficiaries[0].last4Digits}. Please verify your PIN to complete the transfer of ₦${amount.toLocaleString()}.`,
      transactionId: pendingTransaction.id,
      action: 'verify_pin',
    };
  }

  // Multiple matches - ask for confirmation
  const accountEndings = beneficiaries.map(b => b.last4Digits).join(', ');
  pendingTransaction.beneficiaries = beneficiaries;
  pendingTransaction.status = 'beneficiary_selection';
  
  // Update in Map
  pendingTransactions.set(pendingTransaction.id, pendingTransaction);

  return {
    response: `I found ${beneficiaries.length} people named "${recipientName}". Please confirm which account ending: ${accountEndings}?`,
    transactionId: pendingTransaction.id,
    action: 'select_beneficiary',
  };
}

/**
 * Handle beneficiary selection - can be done in the same endpoint
 * User can respond with account ending digits in the message
 */
async function handleBeneficiarySelection(message, pendingTransaction) {
  // Extract selection from message
  const selected = extractBeneficiarySelection(message, pendingTransaction.beneficiaries);

  if (!selected) {
    // Don't return transactionId if we can't understand the selection
    // The caller will handle the error response
    return null;
  }

  // Update pending transaction to PIN verification stage
  pendingTransaction.beneficiary = selected;
  pendingTransaction.status = 'pending_pin';
  delete pendingTransaction.beneficiaries;
  delete pendingTransaction.recipientName;

  return {
    response: `You selected ${selected.name} with account ending in ${selected.last4Digits}. Please verify your PIN to complete the transfer of ₦${pendingTransaction.amount.toLocaleString()}.`,
    transactionId: pendingTransaction.id,
    action: 'verify_pin',
  };
}

/**
 * Validate if message contains transfer-related keywords or patterns
 */
function isValidTransferMessage(message) {
  if (!message || message.length < 5) {
    return false;
  }

  const lowerMessage = message.toLowerCase();

  // Check for transfer-related keywords
  const transferKeywords = ['send', 'transfer', 'pay', 'give', 'move', 'to'];
  const hasTransferKeyword = transferKeywords.some(keyword => lowerMessage.includes(keyword));

  // Check for meaningful amount pattern (at least 2 consecutive digits, or amount with commas/decimals)
  const meaningfulAmountPattern = /\d{2,}(?:[,\d]{3})*(?:\.\d{2})?/;
  const hasMeaningfulAmount = meaningfulAmountPattern.test(message);

  // Check for account number (10 digits)
  const hasAccountNumber = /\b\d{10}\b/.test(message);
  
  // Check for name pattern (at least 2 words with capital letters, or common name patterns)
  const hasNamePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/.test(message) || 
                         /\b(to|for)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/i.test(message);

  // Check if message is mostly nonsensical (too many random characters)
  const nonsensicalPattern = /[^a-z0-9\s]/gi;
  const nonsensicalChars = (message.match(nonsensicalPattern) || []).length;
  const totalChars = message.length;
  const nonsensicalRatio = nonsensicalChars / totalChars;
  
  // If more than 25% of characters are nonsensical, it's likely invalid
  if (nonsensicalRatio > 0.25) {
    // Even with transfer keywords, if it's too nonsensical and lacks valid patterns, reject it
    if (!hasMeaningfulAmount && !hasAccountNumber && !hasNamePattern) {
      return false;
    }
  }

  // Message is valid if it has transfer keywords AND meaningful amount AND (account number OR name pattern)
  if (hasTransferKeyword && hasMeaningfulAmount && (hasAccountNumber || hasNamePattern)) {
    return true;
  }

  // Also valid if it has meaningful amount and account number (even without explicit keywords)
  if (hasMeaningfulAmount && hasAccountNumber) {
    return true;
  }

  // If it has transfer keywords and meaningful amount, it might be valid even without clear recipient
  // But only if it's not too nonsensical
  if (hasTransferKeyword && hasMeaningfulAmount && nonsensicalRatio < 0.2) {
    return true;
  }

  return false;
}

/**
 * Validate if selection message is valid for beneficiary selection
 */
function isValidSelectionMessage(message, pendingTransaction) {
  if (!message || message.length < 1) {
    return false;
  }

  const lowerMessage = message.toLowerCase().trim();

  // Check for account ending digits
  const accountEndings = pendingTransaction.beneficiaries.map(b => b.last4Digits);
  const hasAccountEnding = accountEndings.some(ending => lowerMessage.includes(ending));

  // Check for number selection (1, 2, first, second, etc.)
  const numberPattern = /(\d+)|(first|second|third|fourth|fifth|one|two|three|four|five)/i;
  const hasNumberSelection = numberPattern.test(lowerMessage);

  // Check if message is mostly nonsensical
  const nonsensicalPattern = /[^a-z0-9\s]/gi;
  const nonsensicalChars = (message.match(nonsensicalPattern) || []).length;
  const totalChars = message.length;
  
  // If more than 40% of characters are nonsensical, it's invalid
  if (nonsensicalChars / totalChars > 0.4) {
    return false;
  }

  return hasAccountEnding || hasNumberSelection;
}

/**
 * Extract beneficiary selection from user input
 */
function extractBeneficiarySelection(selection, beneficiaries) {
  if (!selection) return null;

  const selectionStr = selection.toString().toLowerCase().trim();

  // Check for account number ending (last 4 digits)
  for (const beneficiary of beneficiaries) {
    if (selectionStr.includes(beneficiary.last4Digits)) {
      return beneficiary;
    }
  }

  // Check for number selection (1, 2, first, second, etc.)
  const numberMatch = selectionStr.match(/(\d+)|(first|second|third|fourth|fifth)/i);
  if (numberMatch) {
    let index = 0;
    if (numberMatch[1]) {
      index = parseInt(numberMatch[1]) - 1;
    } else {
      const words = ['first', 'second', 'third', 'fourth', 'fifth'];
      index = words.findIndex(w => selectionStr.includes(w));
    }
    if (index >= 0 && index < beneficiaries.length) {
      return beneficiaries[index];
    }
  }

  return null;
}

module.exports = router;
module.exports.processTransferRequest = processTransferRequest;
module.exports.handleAccountSelection = handleAccountSelection;
module.exports.handleBeneficiarySelection = handleBeneficiarySelection;
module.exports.isValidSelectionMessage = isValidSelectionMessage;
module.exports.extractBeneficiarySelection = extractBeneficiarySelection;

