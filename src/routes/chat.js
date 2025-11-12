const express = require('express');
const router = express.Router();
const ConversationManager = require('../services/conversationManager');

// Store active conversations (in production, use Redis or similar)
const conversations = new Map();

/**
 * POST /api/chat
 * Process natural language banking queries
 */
router.post('/', async (req, res) => {
  try {
    const { message, customerId } = req.body;

    if (!message || !customerId) {
      return res.status(400).json({
        error: 'Message and customerId are required',
      });
    }

    // Get or create conversation manager for this customer
    let conversationManager = conversations.get(customerId);
    if (!conversationManager) {
      conversationManager = new ConversationManager(customerId);
      conversations.set(customerId, conversationManager);
    }

    // Process the message
    const result = await conversationManager.processMessage(message);

    res.json({
      success: true,
      response: result.response,
      action: result.action,
      data: result.data || null,
    });
  } catch (error) {
    console.error('Chat route error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      message: error.message,
    });
  }
});

/**
 * GET /api/chat/history/:customerId
 * Get conversation history for a customer
 */
router.get('/history/:customerId', (req, res) => {
  try {
    const { customerId } = req.params;
    const conversationManager = conversations.get(customerId);

    if (!conversationManager) {
      return res.json({
        success: true,
        history: [],
      });
    }

    res.json({
      success: true,
      history: conversationManager.getHistory(),
    });
  } catch (error) {
    console.error('History route error:', error);
    res.status(500).json({
      error: 'Failed to get history',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/chat/history/:customerId
 * Clear conversation history for a customer
 */
router.delete('/history/:customerId', (req, res) => {
  try {
    const { customerId } = req.params;
    const conversationManager = conversations.get(customerId);

    if (conversationManager) {
      conversationManager.clearHistory();
      conversations.delete(customerId);
    }

    res.json({
      success: true,
      message: 'Conversation history cleared',
    });
  } catch (error) {
    console.error('Clear history error:', error);
    res.status(500).json({
      error: 'Failed to clear history',
      message: error.message,
    });
  }
});

module.exports = router;

