const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { extractIntentWithGemini } = require('../services/llm');
const { 
  processTransferRequest, 
  handleAccountSelection: handleTransferAccountSelection,
  handleBeneficiarySelection,
  isValidSelectionMessage 
} = require('../routes/transfer');
const { 
  processInternalTransferRequest,
  handleAccountSelection: handleInternalAccountSelection 
} = require('../routes/internalTransfer');
const ConversationManager = require('../services/conversationManager');
const { pendingTransactions } = require('../services/pendingTransactions');

// Store active conversations (in production, use Redis or similar)
const conversations = new Map();

/**
 * @swagger
 * /api/message:
 *   post:
 *     summary: Unified message endpoint for voice assistant
 *     description: |
 *       Single unified endpoint for voice assistant that handles all types of banking messages using natural language.
 *       The system automatically detects the intent and routes to the appropriate handler.
 *       
 *       This endpoint also handles follow-up responses for pending transactions:
 *       - Account selection: When multiple accounts exist, user can respond with "2725" or "first"
 *       - Beneficiary selection: When multiple beneficiaries found, user can respond with account ending or position
 *       - All responses maintain conversation context automatically
 *       
 *       Supported intents:
 *       - Transfer money: "Send 10000 to Sarah Mohammed" or "Send 10000 to 0782435755"
 *       - Internal transfer: "Move 5000 to my second account"
 *       - Buy airtime: "Buy 1000 airtime to 07016409616" or "Buy airtime for me"
 *       - Query transactions: "Show me my transactions from last week"
 *       - Check balance: "What's my balance?"
 *       - General questions: "How do I open an account?"
 *       
 *       Example conversation flow:
 *       1. User: "Send 10000 to Sarah Mohammed"
 *       2. System: "I found 2 people named 'Sarah Mohammed'. Please confirm which account ending: 2725, 0833?"
 *       3. User: "2725"
 *       4. System: "I found Sarah Mohammed with account ending in 2725. Please verify your PIN to complete the transfer..."
 *     tags:
 *       - Message
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
 *                 description: Natural language message/command
 *                 example: "Send 10000 to Sarah Mohammed"
 *     responses:
 *       200:
 *         description: Message processed successfully
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
 *                   description: Transaction ID for PIN verification (if applicable)
 *                 action:
 *                   type: string
 *                   nullable: true
 *                   description: Action type (verify_pin, select_beneficiary, etc.)
 */
router.post('/', authenticateByPhone, async (req, res) => {
  try {
    const { message } = req.body;
    const customerId = req.customerId;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
        message: 'Please provide a message',
      });
    }

    const trimmedMessage = message.trim();

    // FIRST: Check for pending transactions that need follow-up responses
    // This handles cases like beneficiary selection, account selection, etc.
    const allPendingTransactions = Array.from(pendingTransactions.values());
    
    // Check for pending transfer transactions (account selection, beneficiary selection)
    const pendingTransfer = allPendingTransactions.find(
      t => t.customerId === customerId && t.type === 'transfer' && 
      (t.status === 'beneficiary_selection' || t.status === 'account_selection')
    );

    if (pendingTransfer) {
      // Handle account selection for transfers
      if (pendingTransfer.status === 'account_selection') {
        try {
          const selectionResult = await handleTransferAccountSelection(trimmedMessage, pendingTransfer);
          if (selectionResult) {
            return res.json({
              success: true,
              response: selectionResult.response,
              transactionId: selectionResult.transactionId || null,
              action: selectionResult.action || null,
            });
          }
          return res.json({
            success: true,
            response: "Your message is not clear. Please provide the account ending digits (e.g., '2725' or '0833') or say 'first' or 'second'.",
          });
        } catch (error) {
          console.error('Error handling pending transfer account selection:', error);
        }
      }

      // Handle beneficiary selection for transfers
      if (pendingTransfer.status === 'beneficiary_selection') {
        try {
          // Validate selection message
          if (!isValidSelectionMessage(trimmedMessage, pendingTransfer)) {
            return res.json({
              success: true,
              response: "Your message is not clear. Please provide the account ending digits (e.g., '2725' or '0833') or say 'first' or 'second'.",
            });
          }

          const selectionResult = await handleBeneficiarySelection(trimmedMessage, pendingTransfer);
          if (selectionResult) {
            return res.json({
              success: true,
              response: selectionResult.response,
              transactionId: selectionResult.transactionId || null,
              action: selectionResult.action || null,
            });
          }
          
          return res.json({
            success: true,
            response: "Your message is not clear. Please provide the account ending digits or say 'first' or 'second'.",
          });
        } catch (error) {
          console.error('Error handling pending transfer beneficiary selection:', error);
        }
      }
    }

    // Check for pending internal transfer transactions
    const pendingInternalTransfer = allPendingTransactions.find(
      t => t.customerId === customerId && t.type === 'internal_transfer' && t.status === 'account_selection'
    );

    if (pendingInternalTransfer) {
      try {
        const selectionResult = await handleInternalAccountSelection(trimmedMessage, pendingInternalTransfer);
        if (selectionResult) {
          return res.json({
            success: true,
            response: selectionResult.response,
            transactionId: selectionResult.transactionId || null,
            action: selectionResult.action || null,
          });
        }
        // If selection failed, let it fall through to intent detection
      } catch (error) {
        console.error('Error handling pending internal transfer:', error);
      }
    }

    // If no pending transactions, proceed with intent detection
    // Extract intent using LLM
    const intent = await extractIntentWithGemini(trimmedMessage, []);

    console.log('Detected intent:', intent.intent, 'Confidence:', intent.confidence);

    // Route to appropriate handler based on intent
    let result;

    switch (intent.intent) {
      case 'make_transfer':
        // Route to transfer handler
        result = await processTransferRequest(trimmedMessage, customerId);
        break;

      case 'internal_transfer':
      case 'move_money':
        // Route to internal transfer handler
        result = await processInternalTransferRequest(trimmedMessage, customerId);
        break;

      case 'buy_airtime':
        // Route to airtime purchase - need to handle inline
        // For now, use ConversationManager which handles airtime
        {
          let conversationManager = conversations.get(customerId);
          if (!conversationManager) {
            conversationManager = new ConversationManager(customerId);
            conversations.set(customerId, conversationManager);
          }
          result = await conversationManager.processMessage(trimmedMessage);
        }
        break;

      case 'query_transaction':
      case 'query_bill_payment':
      case 'check_balance':
      case 'get_last_transaction':
      case 'general_question':
        // Route to query AI handler using ConversationManager
        {
          let conversationManager = conversations.get(customerId);
          if (!conversationManager) {
            conversationManager = new ConversationManager(customerId);
            conversations.set(customerId, conversationManager);
          }
          result = await conversationManager.processMessage(trimmedMessage);
        }
        break;

      case 'unclear':
      default:
        // If unclear or low confidence, try ConversationManager for better understanding
        if (intent.confidence < 0.5) {
          let conversationManager = conversations.get(customerId);
          if (!conversationManager) {
            conversationManager = new ConversationManager(customerId);
            conversations.set(customerId, conversationManager);
          }
          result = await conversationManager.processMessage(trimmedMessage);
        } else {
          result = {
            response: "I didn't quite understand that. Could you please rephrase? I can help you with transfers, airtime purchases, checking your balance, or viewing your transaction history.",
            action: null,
          };
        }
        break;
    }

    // Return consistent response format
    res.json({
      success: true,
      response: result.response || result.message || 'Request processed',
      transactionId: result.transactionId || null,
      action: result.action || null,
      data: result.data || null,
    });
  } catch (error) {
    console.error('Message route error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process message',
      message: error.message,
    });
  }
});

module.exports = router;

