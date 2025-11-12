const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { generateAccountNumber, createCustomer, getCustomerByPhone } = require('../services/database');

/**
 * @swagger
 * /api/register-account:
 *   post:
 *     summary: Register a new customer account
 *     description: |
 *       Register a new customer account with phone number and name.
 *       The system will automatically generate a unique 10-digit account number.
 *       After registration, use the /api/set-pin endpoint to set your PIN.
 *     tags:
 *       - Registration
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *               - customerName
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Customer phone number (must be unique)
 *                 example: "+2348012345678"
 *               customerName:
 *                 type: string
 *                 description: Customer full name
 *                 example: "John Adebayo"
 *               bankName:
 *                 type: string
 *                 description: Optional bank name
 *                 example: "Guaranty Trust Bank"
 *     responses:
 *       201:
 *         description: Account registered successfully
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
 *                   example: "Account registered successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 1
 *                     customerName:
 *                       type: string
 *                       example: "John Adebayo"
 *                     phoneNumber:
 *                       type: string
 *                       example: "+2348012345678"
 *                     accountNumber:
 *                       type: string
 *                       example: "1234567890"
 *                     bankName:
 *                       type: string
 *                       nullable: true
 *                       example: "Guaranty Trust Bank"
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     account:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *                         accountNumber:
 *                           type: string
 *                         balance:
 *                           type: number
 *                           example: 0
 *                         currency:
 *                           type: string
 *                           example: "NGN"
 *                         bankName:
 *                           type: string
 *                           nullable: true
 *       400:
 *         description: Bad request - invalid input or missing required fields
 *       409:
 *         description: Conflict - phone number already exists
 *       500:
 *         description: Internal server error
 */
router.post('/register-account', async (req, res) => {
  try {
    const { phoneNumber, customerName, bankName } = req.body;

    // Validate required fields
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
        message: 'Please provide a valid phone number',
      });
    }

    if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Customer name is required',
        message: 'Please provide your full name',
      });
    }

    // Normalize phone number
    const normalizedPhone = phoneNumber.trim().replace(/\s+/g, '');

    // Check if phone number already exists
    const existingCustomer = await getCustomerByPhone(normalizedPhone);
    if (existingCustomer) {
      return res.status(409).json({
        success: false,
        error: 'Phone number already registered',
        message: `An account with phone number ${normalizedPhone} already exists`,
      });
    }

    // Generate unique 10-digit account number
    const accountNumber = await generateAccountNumber();

    // Set default PIN (user must change it using /api/set-pin endpoint)
    const defaultPIN = '0000';
    const saltRounds = 10;
    const hashedPIN = await bcrypt.hash(defaultPIN, saltRounds);

    // Create customer account
    const customer = await createCustomer(
      customerName.trim(),
      normalizedPhone,
      accountNumber,
      hashedPIN,
      bankName ? bankName.trim() : null
    );

    res.status(201).json({
      success: true,
      message: 'Account registered successfully',
      data: {
        id: customer.id,
        customerName: customer.customerName,
        phoneNumber: customer.phoneNumber,
        accountNumber: customer.accountNumber,
        bankName: customer.bankName,
        createdAt: customer.createdAt,
        account: customer.account,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle unique constraint violations
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: 'Registration failed',
        message: 'Phone number or account number already exists',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to register account',
      message: error.message,
    });
  }
});

module.exports = router;

