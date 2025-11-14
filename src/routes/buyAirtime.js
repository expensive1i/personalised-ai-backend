const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { getAccountBalance, getCustomerById, prisma } = require('../services/database');
const { createPendingTransaction } = require('../services/pendingTransactions');
const { detectNetwork, normalizePhone } = require('../utils/networkDetector');
const { purchaseAirtime } = require('../services/ebills');

/**
 * Process airtime purchase request
 * @param {string} message - Natural language message
 * @param {number} customerId - Customer ID
 * @returns {Promise<Object>} Result object with response, transactionId, action
 */
async function processBuyAirtimeRequest(message, customerId) {
  // Extract amount from message
  const amountMatch = message.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

  if (!amount || amount <= 0) {
    return {
      success: false,
      response: "I need the amount to purchase. For example: 'buy airtime 1000 to 07016409616'",
    };
  }

  // Check if customer wants to buy for themselves (e.g., "for me", "for myself", "to my number")
  const selfPurchasePatterns = [
    /\b(for\s+me|for\s+myself|to\s+my\s+number|to\s+my\s+phone|to\s+me)\b/i,
  ];

  let isSelfPurchase = false;
  for (const pattern of selfPurchasePatterns) {
    if (pattern.test(message)) {
      isSelfPurchase = true;
      break;
    }
  }

  let phoneNumber = null;
  let normalizedPhone = null;

  if (isSelfPurchase) {
    // Get customer's phone number from database
    const customer = await getCustomerById(customerId);
    if (!customer || !customer.phoneNumber) {
      return {
        success: false,
        response: 'Unable to retrieve your phone number. Please specify the phone number explicitly.',
      };
    }
    phoneNumber = customer.phoneNumber;
    normalizedPhone = normalizePhone(phoneNumber);
  } else {
    // Extract phone number from message - handle various formats including spaces
    // Try to find phone numbers in various formats: "to 080 1234 5678", "for +234 801 234 5678", etc.
    const phonePatterns = [
      // Pattern for phone numbers with spaces/dashes after "to", "for", "send", "buy"
      /(?:to|for|send|buy)\s+([\+]?234?\s?[0-7]\d{2}[\s\-]?\d{3}[\s\-]?\d{4})/i,
      // Pattern for phone numbers with +234 prefix and spaces
      /(\+234\s?[0-7]\d{2}[\s\-]?\d{3}[\s\-]?\d{4})/i,
      // Pattern for phone numbers starting with 234 and spaces
      /(234\s?[0-7]\d{2}[\s\-]?\d{3}[\s\-]?\d{4})/i,
      // Pattern for phone numbers starting with 0 and spaces
      /(0[0-7]\d{2}[\s\-]?\d{3}[\s\-]?\d{4})/i,
      // Pattern for phone numbers without spaces (fallback)
      /(\+?234?\d{10,11})/i,
      /(\d{11})/,
    ];

    for (const pattern of phonePatterns) {
      const match = message.match(pattern);
      if (match) {
        phoneNumber = match[1];
        break;
      }
    }

    if (!phoneNumber) {
      return {
        success: false,
        response: "I need the phone number to send airtime to. For example: 'buy airtime 1000 to 07016409616' or 'buy airtime 1000 to 070 1234 5678'",
      };
    }

    // Normalize the phone number (removes spaces, dashes, converts +234 to 0, etc.)
    normalizedPhone = normalizePhone(phoneNumber);
  }

  if (!normalizedPhone || normalizedPhone.length !== 11) {
    return {
      success: false,
      response: 'Invalid phone number format. Please provide a valid Nigerian phone number.',
    };
  }

  // Detect network
  const networkInfo = detectNetwork(normalizedPhone);
  if (!networkInfo) {
    return {
      success: false,
      response: 'Unable to detect network provider from phone number. Please ensure the phone number is valid.',
    };
  }

  // Validate amount based on network
  const minAmount = networkInfo.service_id === 'mtn' ? 10 : 50;
  const maxAmount = 50000;

  if (amount < minAmount) {
    return {
      success: false,
      response: `Minimum airtime purchase is ₦${minAmount} for ${networkInfo.name}.`,
    };
  }

  if (amount > maxAmount) {
    return {
      success: false,
      response: `Maximum airtime purchase is ₦${maxAmount}.`,
    };
  }

  // Get customer accounts to check balance
  const accounts = await getAccountBalance(customerId);
  if (!accounts || accounts.length === 0) {
    return {
      success: false,
      response: 'No account found. Please create an account first.',
    };
  }

  // Use first account for airtime purchase
  const account = accounts[0];

  // Check balance
  if (account.balance < amount) {
    return {
      success: false,
      response: 'Insufficient balance. Please top up your account to purchase airtime.',
    };
  }

  // If self-purchase, process immediately without PIN verification
  if (isSelfPurchase) {
    try {
      // Generate unique request_id for eBills API (max 50 chars)
      const request_id = `AIR-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

      // Purchase airtime from eBills API
      const ebillsResponse = await purchaseAirtime({
        request_id,
        phone: normalizedPhone,
        service_id: networkInfo.service_id,
        amount: parseInt(amount),
      });

      // Check if order is successful
      const orderStatus = ebillsResponse.data?.status;
      const isSuccessful = orderStatus === 'completed-api' || orderStatus === 'processing-api';

      if (isSuccessful) {
        const reference = `AIR${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        const now = new Date();

        // Deduct from account and create transaction record
        await prisma.$transaction(async (tx) => {
          // Update account balance
          await tx.account.update({
            where: { id: BigInt(account.id) },
            data: { balance: account.balance - parseFloat(amount) },
          });

          // Create transaction record
          await tx.transaction.create({
            data: {
              customerId: BigInt(customerId),
              accountId: BigInt(account.id),
              receiverName: `Airtime Purchase - ${networkInfo.name}`,
              bankName: networkInfo.name,
              bankAccount: normalizedPhone,
              accountNumber: normalizedPhone,
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

        // Generate success response
        const successMessage = orderStatus === 'completed-api'
          ? `Airtime purchase of ₦${amount.toLocaleString()} for ${normalizedPhone} (${networkInfo.name}) completed successfully!`
          : `Airtime purchase of ₦${amount.toLocaleString()} for ${normalizedPhone} (${networkInfo.name}) is being processed.`;

        return {
          success: true,
          response: successMessage,
          transactionId: null,
          action: null,
        };
      } else {
        throw new Error(`Airtime purchase failed. Status: ${orderStatus}`);
      }
    } catch (error) {
      console.error('Self-purchase airtime error:', error);
      return {
        success: false,
        response: `Failed to purchase airtime: ${error.message}`,
      };
    }
  }

  // For purchases to other numbers, require PIN verification
  const transactionId = createPendingTransaction({
    type: 'airtime',
    customerId: customerId,
    data: {
      accountId: account.id,
      phone: normalizedPhone,
      service_id: networkInfo.service_id,
      networkName: networkInfo.name,
      amount: amount,
      status: 'pending_pin',
    },
  });

  // Generate AI response message
  const response = `Great! I'll purchase ₦${amount.toLocaleString()} airtime for ${normalizedPhone} (${networkInfo.name}). Please verify your PIN to complete this transaction.`;

  return {
    success: true,
    response: response,
    transactionId: transactionId,
    action: 'verify_pin',
  };
}

/**
 * @swagger
 * /api/buy-airtime:
 *   post:
 *     summary: Purchase airtime using natural language
 *     description: |
 *       Purchase airtime for a phone number using natural language.
 *       Examples: 
 *       - "buy airtime 1000 airtime to 07016409616" (requires PIN verification)
 *       - "send 1000 airtime to 07016409616" (requires PIN verification)
 *       - "buy ₦500 airtime for 08012345678" (requires PIN verification)
 *       - "buy 1000 naira airtime for me" (processed immediately, no PIN required)
 *       - "buy airtime 500 for myself" (processed immediately, no PIN required)
 *       
 *       The system will:
 *       1. Extract amount and phone number from the message
 *       2. If "for me" or "for myself" is detected, use customer's phone number automatically
 *       3. Auto-detect network provider from phone number prefix
 *       4. Check account balance
 *       5. For self-purchases: Process immediately via eBills API
 *       6. For other purchases: Generate transactionId and request PIN verification
 *     tags:
 *       - Airtime
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
 *                 description: Natural language airtime purchase request
 *                 example: "buy airtime 1000 airtime to 07016409616"
 *     responses:
 *       200:
 *         description: Airtime purchase request processed
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
 *                   description: Transaction ID for PIN verification
 *                   example: "TXN-1703123456789-ABC123"
 *                 action:
 *                   type: string
 *                   nullable: true
 *                   description: Action type (verify_pin)
 *       400:
 *         description: Bad request - insufficient balance or invalid input
 *       401:
 *         description: Authentication failed
 */
router.post('/', authenticateByPhone, async (req, res) => {
  try {
    const { message } = req.body;
    const customerId = req.customerId;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
        message: 'Please provide an airtime purchase request in natural language',
      });
    }

    const result = await processBuyAirtimeRequest(message, customerId);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);

  } catch (error) {
    console.error('Buy airtime route error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process airtime purchase request',
      message: error.message,
    });
  }
});

module.exports = router;
module.exports.processBuyAirtimeRequest = processBuyAirtimeRequest;

