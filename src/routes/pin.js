const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { authenticateByPhone } = require('../middleware/auth');
const { updateCustomerPIN, getCustomerPINHash } = require('../services/database');

/**
 * @swagger
 * /api/set-pin:
 *   post:
 *     summary: Set or update customer PIN
 *     description: |
 *       Set or update the PIN for a customer. The PIN will be hashed using bcrypt
 *       before being stored in the database.
 *     tags:
 *       - PIN Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - pin
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *               pin:
 *                 type: string
 *                 description: PIN to set (must be exactly 4 digits, will be hashed before storage)
 *                 example: "1234"
 *     responses:
 *       200:
 *         description: PIN set successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "PIN has been set successfully"
 *       400:
 *         description: Bad request - invalid PIN format or missing fields
 *       401:
 *         description: Authentication failed - phone number required
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Internal server error
 */
router.post('/set-pin', authenticateByPhone, async (req, res) => {
  try {
    const { pin } = req.body;
    const customerId = req.customerId;

    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'PIN is required',
        message: 'Please provide a PIN',
      });
    }

    // Validate PIN format (must be exactly 4 digits)
    const cleanedPIN = pin.trim();
    if (!/^\d{4}$/.test(cleanedPIN)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid PIN format',
        message: 'PIN must be exactly 4 digits',
      });
    }

    // Hash the PIN using bcrypt
    const saltRounds = 10;
    const hashedPIN = await bcrypt.hash(cleanedPIN, saltRounds);

    // Update customer PIN in database
    await updateCustomerPIN(customerId, hashedPIN);

    res.json({
      success: true,
      message: 'PIN has been set successfully',
    });
  } catch (error) {
    console.error('Set PIN error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set PIN',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/verify-pin:
 *   post:
 *     summary: Verify customer PIN
 *     description: |
 *       Verify a customer's PIN by comparing it with the hashed PIN stored in the database.
 *     tags:
 *       - PIN Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - pin
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number for authentication
 *                 example: "+2348012345678"
 *               pin:
 *                 type: string
 *                 description: PIN to verify
 *                 example: "1234"
 *     responses:
 *       200:
 *         description: PIN verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 verified:
 *                   type: boolean
 *                   description: Whether the PIN is correct
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "PIN verified successfully"
 *       400:
 *         description: Bad request - PIN is required
 *       401:
 *         description: Authentication failed - phone number required or PIN incorrect
 *       404:
 *         description: Customer not found
 *       500:
 *         description: Internal server error
 */
router.post('/verify-pin', authenticateByPhone, async (req, res) => {
  try {
    const { pin } = req.body;
    const customerId = req.customerId;

    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'PIN is required',
        message: 'Please provide a PIN to verify',
      });
    }

    // Get hashed PIN from database
    const hashedPIN = await getCustomerPINHash(customerId);

    if (!hashedPIN) {
      return res.status(404).json({
        success: false,
        error: 'PIN not found',
        message: 'No PIN has been set for this account. Please set a PIN first.',
      });
    }

    // Verify the PIN
    const cleanedPIN = pin.trim();
    const isVerified = await bcrypt.compare(cleanedPIN, hashedPIN);

    if (!isVerified) {
      return res.status(401).json({
        success: false,
        verified: false,
        error: 'Invalid PIN',
        message: 'The PIN you entered is incorrect',
      });
    }

    res.json({
      success: true,
      verified: true,
      message: 'PIN verified successfully',
    });
  } catch (error) {
    console.error('Verify PIN error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify PIN',
      message: error.message,
    });
  }
});

module.exports = router;

