const express = require('express');
const router = express.Router();
const { authenticateByPhone } = require('../middleware/auth');
const { verifyAccount } = require('../services/bankVerification');

/**
 * @swagger
 * /api/account-verification:
 *   post:
 *     summary: Verify bank account number
 *     description: |
 *       Verify a Nigerian bank account number using Paystack API.
 *       The system will automatically detect possible banks using NUBAN validation
 *       and try each one until verification succeeds.
 *       
 *       For account numbers starting with 90, 80, 81, or 70, it will also try OPay and PalmPay
 *       after trying NUBAN-validated banks.
 *     tags:
 *       - Account Verification
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - accountNumber
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *               accountNumber:
 *                 type: string
 *                 description: Bank account number to verify (10 digits). Bank will be auto-detected.
 *                 example: "0123456789"
 *     responses:
 *       200:
 *         description: Account verification successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 ai_message:
 *                   type: string
 *                   description: Structured AI message confirming account verification
 *                   example: "This account number 0123456789 belongs to JOHN DOE at Guaranty Trust Bank."
 *                 data:
 *                   type: object
 *                   properties:
 *                     account_number:
 *                       type: string
 *                       example: "0123456789"
 *                     account_name:
 *                       type: string
 *                       example: "JOHN DOE"
 *                     bank_name:
 *                       type: string
 *                       example: "Guaranty Trust Bank"
 *                     bank_code:
 *                       type: string
 *                       example: "058"
 *       400:
 *         description: Bad request - invalid account number format
 *       401:
 *         description: Authentication failed - phone number required
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Internal server error or Paystack API error
 */
router.post('/', authenticateByPhone, async (req, res) => {
  try {
    const { accountNumber, bankCode } = req.body;

    if (!accountNumber || typeof accountNumber !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Account number is required',
        message: 'Please provide a valid account number',
      });
    }

    // Validate account number format (should be 10 digits)
    const cleanedAccountNumber = accountNumber.trim().replace(/\s+/g, '');
    if (!/^\d{10}$/.test(cleanedAccountNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid account number format',
        message: 'Account number must be exactly 10 digits',
      });
    }

    // Verify account
    const accountDetails = await verifyAccount(cleanedAccountNumber, bankCode || null);

    // Generate structured AI message
    const aiMessage = `This account number ${accountDetails.account_number} belongs to ${accountDetails.account_name} at ${accountDetails.bank_name}.`;

    res.json({
      success: true,
      ai_message: aiMessage,
      data: accountDetails,
    });
  } catch (error) {
    console.error('Account verification error:', error);
    
    // Check if it's a Paystack API error
    if (error.message.includes('Paystack') || error.message.includes('verification failed')) {
      return res.status(400).json({
        success: false,
        error: 'Account verification failed',
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to verify account',
      message: error.message,
    });
  }
});

module.exports = router;

