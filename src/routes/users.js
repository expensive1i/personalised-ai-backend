const express = require('express');
const router = express.Router();
const { prisma } = require('../services/database');

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Get all users with their complete details
 *     description: |
 *       Returns all users with their accounts, transactions, bill payments, and other related data.
 *       This endpoint provides a complete overview of all users in the system.
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: List of all users with complete details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalUsers:
 *                       type: integer
 *                     users:
 *                       type: array
 *                       items:
 *                         type: object
 *       500:
 *         description: Internal server error
 */
router.get('/', async (req, res) => {
  try {
    const users = await prisma.customer.findMany({
      where: {
        deletedAt: null,
      },
      include: {
        accounts: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        transactions: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            transactionDate: 'desc',
          },
          take: 100, // Limit to last 100 transactions per user
        },
        bill_payments: {
          where: {
            deleted_at: null,
          },
          orderBy: {
            payment_date: 'desc',
          },
          take: 100, // Limit to last 100 bill payments per user
        },
        beneficiaries: {
          where: {
            deletedAt: null,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Convert BigInt IDs and Decimal values to numbers
    const formattedUsers = users.map(user => ({
      id: Number(user.id),
      customerName: user.customerName,
      phoneNumber: user.phoneNumber,
      accountNumber: user.accountNumber,
      bankName: user.bankName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      accounts: user.accounts.map(acc => ({
        id: Number(acc.id),
        accountNumber: acc.accountNumber,
        balance: acc.balance?.toNumber ? acc.balance.toNumber() : Number(acc.balance),
        currency: acc.currency || 'NGN',
        bankName: acc.bankName,
        createdAt: acc.createdAt,
      })),
      transactions: user.transactions.map(txn => ({
        id: Number(txn.id),
        receiverName: txn.receiverName,
        bankName: txn.bankName,
        bankAccount: txn.bankAccount,
        accountNumber: txn.accountNumber,
        amount: txn.amount?.toNumber ? txn.amount.toNumber() : Number(txn.amount),
        balanceBefore: txn.balanceBefore?.toNumber ? txn.balanceBefore.toNumber() : Number(txn.balanceBefore),
        balanceAfter: txn.balanceAfter?.toNumber ? txn.balanceAfter.toNumber() : Number(txn.balanceAfter),
        transactionDate: txn.transactionDate,
        status: txn.status,
        transactionType: txn.transactionType,
        reference: txn.reference,
        createdAt: txn.createdAt,
      })),
      billPayments: user.bill_payments.map(bp => ({
        id: Number(bp.id),
        paymentType: bp.payment_type,
        provider: bp.provider,
        phoneNumber: bp.phone_number,
        meterNumber: bp.meter_number,
        accountNumber: bp.account_number,
        amount: bp.amount?.toNumber ? bp.amount.toNumber() : Number(bp.amount),
        balanceBefore: bp.balance_before?.toNumber ? bp.balance_before.toNumber() : Number(bp.balance_before),
        balanceAfter: bp.balance_after?.toNumber ? bp.balance_after.toNumber() : Number(bp.balance_after),
        paymentDate: bp.payment_date,
        status: bp.status,
        reference: bp.reference,
        description: bp.description,
        createdAt: bp.created_at,
      })),
      beneficiaries: user.beneficiaries.map(ben => ({
        id: Number(ben.id),
        name: ben.recipientName,
        recipientPhone: ben.recipientPhone,
        accountNumber: ben.accountNumber,
        bankName: ben.bankName,
        bankAccount: ben.bankAccount,
        nickname: ben.nickname,
        transferCount: ben.transferCount ? Number(ben.transferCount) : 0,
        lastTransferredAt: ben.lastTransferredAt,
        createdAt: ben.createdAt,
      })),
    }));

    res.json({
      success: true,
      response: `Found ${users.length} user(s)`,
      data: {
        totalUsers: users.length,
        users: formattedUsers,
      },
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get users',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID with complete details
 *     description: |
 *       Returns complete details of a specific user including all accounts, transactions, 
 *       bill payments, beneficiaries, and other related data.
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *         example: 1
 *     responses:
 *       200:
 *         description: User details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                 data:
 *                   type: object
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID',
        message: 'User ID must be a valid number',
      });
    }

    const user = await prisma.customer.findFirst({
      where: {
        id: BigInt(userId),
        deletedAt: null,
      },
      include: {
        accounts: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        transactions: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            transactionDate: 'desc',
          },
        },
        bill_payments: {
          where: {
            deleted_at: null,
          },
          orderBy: {
            payment_date: 'desc',
          },
        },
        beneficiaries: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            lastTransferredAt: 'desc',
          },
        },
        documents: {
          where: {
            deletedAt: null,
          },
        },
        accountHistories: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        message: `User with ID ${userId} not found`,
      });
    }

    // Calculate total balance across all accounts
    const totalBalance = user.accounts.reduce((sum, acc) => {
      const balance = acc.balance?.toNumber ? acc.balance.toNumber() : Number(acc.balance);
      return sum + balance;
    }, 0);

    // Convert BigInt IDs and Decimal values to numbers
    const formattedUser = {
      id: Number(user.id),
      customerName: user.customerName,
      phoneNumber: user.phoneNumber,
      accountNumber: user.accountNumber,
      bankName: user.bankName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      totalBalance: totalBalance,
      totalAccounts: user.accounts.length,
      totalTransactions: user.transactions.length,
      totalBillPayments: user.bill_payments.length,
      accounts: user.accounts.map(acc => ({
        id: Number(acc.id),
        accountNumber: acc.accountNumber,
        balance: acc.balance?.toNumber ? acc.balance.toNumber() : Number(acc.balance),
        currency: acc.currency || 'NGN',
        bankName: acc.bankName,
        createdAt: acc.createdAt,
      })),
      transactions: user.transactions.map(txn => ({
        id: Number(txn.id),
        receiverName: txn.receiverName,
        bankName: txn.bankName,
        bankAccount: txn.bankAccount,
        accountNumber: txn.accountNumber,
        amount: txn.amount?.toNumber ? txn.amount.toNumber() : Number(txn.amount),
        balanceBefore: txn.balanceBefore?.toNumber ? txn.balanceBefore.toNumber() : Number(txn.balanceBefore),
        balanceAfter: txn.balanceAfter?.toNumber ? txn.balanceAfter.toNumber() : Number(txn.balanceAfter),
        transactionDate: txn.transactionDate,
        status: txn.status,
        transactionType: txn.transactionType,
        reference: txn.reference,
        createdAt: txn.createdAt,
      })),
      billPayments: user.bill_payments.map(bp => ({
        id: Number(bp.id),
        paymentType: bp.payment_type,
        provider: bp.provider,
        phoneNumber: bp.phone_number,
        meterNumber: bp.meter_number,
        accountNumber: bp.account_number,
        amount: bp.amount?.toNumber ? bp.amount.toNumber() : Number(bp.amount),
        balanceBefore: bp.balance_before?.toNumber ? bp.balance_before.toNumber() : Number(bp.balance_before),
        balanceAfter: bp.balance_after?.toNumber ? bp.balance_after.toNumber() : Number(bp.balance_after),
        paymentDate: bp.payment_date,
        status: bp.status,
        reference: bp.reference,
        description: bp.description,
        createdAt: bp.created_at,
      })),
      beneficiaries: user.beneficiaries.map(ben => ({
        id: Number(ben.id),
        name: ben.recipientName,
        recipientPhone: ben.recipientPhone,
        accountNumber: ben.accountNumber,
        bankName: ben.bankName,
        bankAccount: ben.bankAccount,
        nickname: ben.nickname,
        transferCount: ben.transferCount ? Number(ben.transferCount) : 0,
        lastTransferredAt: ben.lastTransferredAt,
        createdAt: ben.createdAt,
      })),
      documents: user.documents.map(doc => ({
        id: Number(doc.id),
        documentType: doc.documentType,
        documentNumber: doc.documentNumber,
        issueDate: doc.issueDate,
        expiryDate: doc.expiryDate,
        createdAt: doc.createdAt,
      })),
      accountHistories: user.accountHistories.map(ah => ({
        id: Number(ah.id),
        customerPhoneNumber: ah.customerPhoneNumber,
        failedAmount: ah.failedAmount?.toNumber ? ah.failedAmount.toNumber() : Number(ah.failedAmount),
        failedDate: ah.failedDate,
        failureReason: ah.failureReason,
        status: ah.status,
        resolvedAt: ah.resolvedAt,
        escalatedAt: ah.escalatedAt,
        notes: ah.notes,
        createdAt: ah.createdAt,
      })),
    };

    res.json({
      success: true,
      response: `User details retrieved successfully`,
      data: formattedUser,
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user',
      message: error.message,
    });
  }
});

/**
 * @swagger
 * /api/validate-phone-number:
 *   post:
 *     summary: Validate phone number and get customer details
 *     description: |
 *       Validates if a phone number exists in the system.
 *       If the phone number exists, returns complete customer details.
 *       If not found, returns "User not found".
 *     tags:
 *       - Users
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phoneNumber
 *             properties:
 *               phoneNumber:
 *                 type: string
 *                 description: Phone number to validate
 *                 example: "+2348012345678"
 *     responses:
 *       200:
 *         description: Phone number validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 response:
 *                   type: string
 *                 data:
 *                   type: object
 *                   nullable: true
 *       400:
 *         description: Bad request - phone number not provided
 */
const validatePhoneRouter = express.Router();
validatePhoneRouter.post('/', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber || typeof phoneNumber !== 'string' || phoneNumber.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required',
        message: 'Please provide a phone number to validate',
      });
    }

    // Use enhanced phone normalization to handle voice-to-text errors and symbols
    const { normalizePhone } = require('../utils/networkDetector');
    const normalizedPhone = normalizePhone(phoneNumber) || phoneNumber.trim().replace(/\s+/g, '');

    const user = await prisma.customer.findFirst({
      where: {
        phoneNumber: normalizedPhone,
        deletedAt: null,
      },
      include: {
        accounts: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        transactions: {
          where: {
            deletedAt: null,
          },
          orderBy: {
            transactionDate: 'desc',
          },
          take: 50, // Limit to last 50 transactions
        },
        bill_payments: {
          where: {
            deleted_at: null,
          },
          orderBy: {
            payment_date: 'desc',
          },
          take: 50, // Limit to last 50 bill payments
        },
        beneficiaries: {
          where: {
            deletedAt: null,
          },
        },
      },
    });

    if (!user) {
      return res.json({
        success: true,
        response: 'User not found',
        data: null,
      });
    }

    // Calculate total balance across all accounts
    const totalBalance = user.accounts.reduce((sum, acc) => {
      const balance = acc.balance?.toNumber ? acc.balance.toNumber() : Number(acc.balance);
      return sum + balance;
    }, 0);

    // Convert BigInt IDs and Decimal values to numbers
    const formattedUser = {
      id: Number(user.id),
      customerName: user.customerName,
      phoneNumber: user.phoneNumber,
      accountNumber: user.accountNumber,
      bankName: user.bankName,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      totalBalance: totalBalance,
      totalAccounts: user.accounts.length,
      totalTransactions: user.transactions.length,
      totalBillPayments: user.bill_payments.length,
      accounts: user.accounts.map(acc => ({
        id: Number(acc.id),
        accountNumber: acc.accountNumber,
        balance: acc.balance?.toNumber ? acc.balance.toNumber() : Number(acc.balance),
        currency: acc.currency || 'NGN',
        bankName: acc.bankName,
        createdAt: acc.createdAt,
      })),
      transactions: user.transactions.map(txn => ({
        id: Number(txn.id),
        receiverName: txn.receiverName,
        bankName: txn.bankName,
        bankAccount: txn.bankAccount,
        accountNumber: txn.accountNumber,
        amount: txn.amount?.toNumber ? txn.amount.toNumber() : Number(txn.amount),
        balanceBefore: txn.balanceBefore?.toNumber ? txn.balanceBefore.toNumber() : Number(txn.balanceBefore),
        balanceAfter: txn.balanceAfter?.toNumber ? txn.balanceAfter.toNumber() : Number(txn.balanceAfter),
        transactionDate: txn.transactionDate,
        status: txn.status,
        transactionType: txn.transactionType,
        reference: txn.reference,
        createdAt: txn.createdAt,
      })),
      billPayments: user.bill_payments.map(bp => ({
        id: Number(bp.id),
        paymentType: bp.payment_type,
        provider: bp.provider,
        phoneNumber: bp.phone_number,
        meterNumber: bp.meter_number,
        accountNumber: bp.account_number,
        amount: bp.amount?.toNumber ? bp.amount.toNumber() : Number(bp.amount),
        balanceBefore: bp.balance_before?.toNumber ? bp.balance_before.toNumber() : Number(bp.balance_before),
        balanceAfter: bp.balance_after?.toNumber ? bp.balance_after.toNumber() : Number(bp.balance_after),
        paymentDate: bp.payment_date,
        status: bp.status,
        reference: bp.reference,
        description: bp.description,
        createdAt: bp.created_at,
      })),
      beneficiaries: user.beneficiaries.map(ben => ({
        id: Number(ben.id),
        name: ben.recipientName,
        recipientPhone: ben.recipientPhone,
        accountNumber: ben.accountNumber,
        bankName: ben.bankName,
        bankAccount: ben.bankAccount,
        nickname: ben.nickname,
        transferCount: ben.transferCount ? Number(ben.transferCount) : 0,
        lastTransferredAt: ben.lastTransferredAt,
        createdAt: ben.createdAt,
      })),
    };

    res.json({
      success: true,
      response: 'User found',
      data: formattedUser,
    });
  } catch (error) {
    console.error('Validate phone number error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate phone number',
      message: error.message,
    });
  }
});

module.exports = router;
module.exports.validatePhoneRouter = validatePhoneRouter;

