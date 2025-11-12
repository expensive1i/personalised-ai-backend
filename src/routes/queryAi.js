const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const ConversationManager = require('../services/conversationManager');

// Store active conversations (in production, use Redis or similar)
const conversations = new Map();

/**
 * @swagger
 * /api/query-ai:
 *   post:
 *     summary: Query AI assistant with natural language (Transaction-focused)
 *     description: |
 *       Ask any question about your transactions, balances, transfers, or beneficiaries.
 *       All queries are automatically scoped to your account based on your phone number.
 *       
 *       Examples:
 *       - "What's my last transaction?"
 *       - "How much airtime did I buy from 15-18 June 2025?"
 *       - "Transfer ₦5000 to Mohammed Sani"
 *       - "What's my account balance?"
 *     tags:
 *       - AI Query
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
 *                 description: Natural language question or request
 *                 example: "What's my last transaction?"
 *     responses:
 *       200:
 *         description: Successful response from AI assistant
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 response:
 *                   type: string
 *                   description: AI assistant's response
 *                   example: "Your last transaction was a debit of ₦5,000 to John Doe on 12/25/2024. Status: success"
 *                 action:
 *                   type: string
 *                   nullable: true
 *                   description: Action type if applicable (e.g., 'confirm_transfer', 'select_beneficiary')
 *                   example: null
 *                 data:
 *                   type: object
 *                   nullable: true
 *                   description: Additional data if applicable
 *       401:
 *         description: Authentication failed - phone number required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Phone number is required for authentication"
 *       404:
 *         description: Customer not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Customer not found"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Failed to process message"
 */
router.post('/', authenticateByPhone, async (req, res) => {
  try {
    const { message } = req.body;
    const customerId = req.customerId;
    const customer = req.customer;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
        message: 'Please provide a question or message in the request body',
      });
    }

    // Get or create conversation manager for this customer
    let conversationManager = conversations.get(customerId);
    if (!conversationManager) {
      conversationManager = new ConversationManager(customerId);
      conversations.set(customerId, conversationManager);
    }

    // Process the message (automatically scoped to authenticated customer)
    const result = await conversationManager.processMessage(message.trim());

    // Return only success and response
    res.json({
      success: true,
      response: result.response,
    });
  } catch (error) {
    console.error('Query AI route error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process query',
      message: error.message,
    });
  }
});

module.exports = router;

