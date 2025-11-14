let PrismaClient;
let prisma;

try {
  PrismaClient = require('@prisma/client').PrismaClient;
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
} catch (error) {
  console.error('❌ Failed to initialize Prisma Client:', error.message);
  console.error('⚠️ Make sure to run "prisma generate" before starting the server');
  // Create a mock prisma object to prevent crashes
  prisma = {
    $connect: () => Promise.reject(new Error('Prisma Client not generated')),
    $disconnect: () => Promise.resolve(),
  };
}

// Test database connection on startup (non-blocking)
// Don't await this - let the server start even if DB is temporarily unavailable
setTimeout(() => {
  if (prisma && typeof prisma.$connect === 'function') {
    prisma.$connect()
      .then(() => {
        console.log('✅ Database connected successfully');
      })
      .catch((error) => {
        console.error('⚠️ Database connection check failed (server will continue):', error.message);
        // Don't exit - let the server start and handle errors gracefully
      });
  }
}, 1000); // Wait 1 second before checking connection

/**
 * Get the last transaction for a customer
 */
async function getLastTransaction(customerId) {
  try {
    const transaction = await prisma.transaction.findFirst({
      where: {
        customerId: parseInt(customerId),
        deletedAt: null,
      },
      orderBy: {
        transactionDate: 'desc',
      },
      include: {
        account: {
          select: {
            accountNumber: true,
            bankName: true,
          },
        },
      },
    });

    // Convert BigInt IDs and Decimal values to numbers for JSON serialization
    if (transaction) {
      transaction.id = Number(transaction.id);
      transaction.customerId = Number(transaction.customerId);
      transaction.accountId = Number(transaction.accountId);
      
      // Convert Decimal fields to numbers (Prisma Decimal has toNumber method)
      transaction.amount = transaction.amount?.toNumber ? transaction.amount.toNumber() : Number(transaction.amount);
      transaction.balanceBefore = transaction.balanceBefore?.toNumber ? transaction.balanceBefore.toNumber() : Number(transaction.balanceBefore);
      transaction.balanceAfter = transaction.balanceAfter?.toNumber ? transaction.balanceAfter.toNumber() : Number(transaction.balanceAfter);
      
      if (transaction.account) {
        transaction.account.id = Number(transaction.account.id);
      }
    }

    return transaction;
  } catch (error) {
    console.error('Error getting last transaction:', error);
    throw error;
  }
}

/**
 * Get transactions within a time range (precise DateTime), optionally filtered by type
 */
async function getTransactionsByTimeRange(customerId, startTime, endTime, transactionType = null) {
  try {
    const where = {
      customerId: parseInt(customerId),
      deletedAt: null,
      transactionDate: {
        gte: startTime,
        lte: endTime,
      },
    };

    // Filter by transaction type if provided (e.g., "airtime", "transfer")
    if (transactionType && transactionType !== 'all') {
      // For airtime, check if receiverName or bankName contains "airtime" related keywords
      if (transactionType.toLowerCase() === 'airtime') {
        where.OR = [
          { receiverName: { contains: 'airtime', mode: 'insensitive' } },
          { bankName: { contains: 'airtime', mode: 'insensitive' } },
          { transactionType: 'debit' }, // Airtime is usually a debit
        ];
      } else {
        where.transactionType = transactionType.toLowerCase();
      }
    }

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: {
        transactionDate: 'desc',
      },
      include: {
        account: {
          select: {
            id: true,
            accountNumber: true,
            bankName: true,
          },
        },
      },
    });

    // Convert BigInt IDs and Decimal values to numbers for JSON serialization
    return transactions.map(t => ({
      ...t,
      id: Number(t.id),
      customerId: Number(t.customerId),
      accountId: Number(t.accountId),
      amount: t.amount?.toNumber ? t.amount.toNumber() : Number(t.amount),
      balanceBefore: t.balanceBefore?.toNumber ? t.balanceBefore.toNumber() : Number(t.balanceBefore),
      balanceAfter: t.balanceAfter?.toNumber ? t.balanceAfter.toNumber() : Number(t.balanceAfter),
      account: t.account ? {
        ...t.account,
        id: Number(t.account.id),
      } : null,
    }));
  } catch (error) {
    console.error('Error getting transactions by time range:', error);
    throw error;
  }
}

/**
 * Get all transactions for a customer, optionally filtered by type (no date range)
 */
async function getAllTransactions(customerId, transactionType = null, limit = null) {
  try {
    const where = {
      customerId: parseInt(customerId),
      deletedAt: null,
    };

    // Filter by transaction type if provided
    if (transactionType && transactionType !== 'all') {
      if (transactionType.toLowerCase() === 'airtime') {
        where.OR = [
          { receiverName: { contains: 'airtime', mode: 'insensitive' } },
          { bankName: { contains: 'airtime', mode: 'insensitive' } },
          { transactionType: 'debit' },
        ];
      } else {
        where.transactionType = transactionType.toLowerCase();
      }
    }

    const queryOptions = {
      where,
      orderBy: {
        transactionDate: 'desc',
      },
      include: {
        account: {
          select: {
            id: true,
            accountNumber: true,
            bankName: true,
          },
        },
      },
    };

    // Add limit if specified
    if (limit && limit > 0) {
      queryOptions.take = limit;
    }

    const transactions = await prisma.transaction.findMany(queryOptions);

    // Convert BigInt IDs and Decimal values to numbers for JSON serialization
    return transactions.map(t => ({
      ...t,
      id: Number(t.id),
      customerId: Number(t.customerId),
      accountId: Number(t.accountId),
      amount: t.amount?.toNumber ? t.amount.toNumber() : Number(t.amount),
      balanceBefore: t.balanceBefore?.toNumber ? t.balanceBefore.toNumber() : Number(t.balanceBefore),
      balanceAfter: t.balanceAfter?.toNumber ? t.balanceAfter.toNumber() : Number(t.balanceAfter),
      account: t.account ? {
        ...t.account,
        id: Number(t.account.id),
      } : null,
    }));
  } catch (error) {
    console.error('Error getting all transactions:', error);
    throw error;
  }
}

/**
 * Get transactions within a date range, optionally filtered by type
 */
async function getTransactionsByDateRange(customerId, startDate, endDate, transactionType = null) {
  try {
    // Parse dates and set to start/end of day to include all transactions for that day
    // Use UTC to ensure consistency across timezones
    // startDate should be at 00:00:00.000 UTC
    let startDateObj;
    if (typeof startDate === 'string' && startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      startDateObj = new Date(startDate + 'T00:00:00.000Z');
    } else {
      startDateObj = new Date(startDate);
      startDateObj.setUTCHours(0, 0, 0, 0);
    }
    
    // endDate should be at 23:59:59.999 UTC
    let endDateObj;
    if (typeof endDate === 'string' && endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      endDateObj = new Date(endDate + 'T23:59:59.999Z');
    } else {
      endDateObj = new Date(endDate);
      endDateObj.setUTCHours(23, 59, 59, 999);
    }
    
    const where = {
      customerId: parseInt(customerId),
      deletedAt: null,
      transactionDate: {
        gte: startDateObj,
        lte: endDateObj,
      },
    };

    // Filter by transaction type if provided (e.g., "airtime", "transfer")
    if (transactionType && transactionType !== 'all') {
      // For airtime, check if receiverName or bankName contains "airtime" related keywords
      if (transactionType.toLowerCase() === 'airtime') {
        where.OR = [
          { receiverName: { contains: 'airtime', mode: 'insensitive' } },
          { bankName: { contains: 'airtime', mode: 'insensitive' } },
          { transactionType: 'debit' }, // Airtime is usually a debit
        ];
      } else {
        where.transactionType = transactionType.toLowerCase();
      }
    }

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: {
        transactionDate: 'desc',
      },
      include: {
        account: {
          select: {
            id: true,
            accountNumber: true,
            bankName: true,
          },
        },
      },
    });

    // Convert BigInt IDs and Decimal values to numbers for JSON serialization
    return transactions.map(t => ({
      ...t,
      id: Number(t.id),
      customerId: Number(t.customerId),
      accountId: Number(t.accountId),
      amount: t.amount?.toNumber ? t.amount.toNumber() : Number(t.amount),
      balanceBefore: t.balanceBefore?.toNumber ? t.balanceBefore.toNumber() : Number(t.balanceBefore),
      balanceAfter: t.balanceAfter?.toNumber ? t.balanceAfter.toNumber() : Number(t.balanceAfter),
      account: t.account ? {
        ...t.account,
        id: Number(t.account.id),
      } : null,
    }));
  } catch (error) {
    console.error('Error getting transactions by date range:', error);
    throw error;
  }
}

/**
 * Search for recipients by name across Beneficiaries, Customer, and Transaction tables
 */
async function searchBeneficiaries(customerId, name) {
  try {
    const results = [];
    const seenAccounts = new Set(); // Track unique account numbers to avoid duplicates

    // 1. Search in Beneficiaries table (saved beneficiaries)
    const beneficiaries = await prisma.beneficiary.findMany({
      where: {
        customerId: parseInt(customerId),
        deletedAt: null,
        recipientName: {
          contains: name,
          mode: 'insensitive',
        },
      },
      orderBy: {
        transferCount: 'desc',
      },
    });

    beneficiaries.forEach(b => {
      const key = `${b.accountNumber}-${b.bankName || ''}`;
      if (!seenAccounts.has(key)) {
        seenAccounts.add(key);
        results.push({
          id: Number(b.id),
          name: b.recipientName,
          accountNumber: b.accountNumber,
          bankName: b.bankName,
          bankAccount: b.bankAccount,
          nickname: b.nickname,
          last4Digits: b.accountNumber.slice(-4),
          transferCount: b.transferCount,
          source: 'beneficiary',
        });
      }
    });

    // 2. Search in Customer table (all customers)
    const customers = await prisma.customer.findMany({
      where: {
        customerName: {
          contains: name,
          mode: 'insensitive',
        },
        deletedAt: null,
        id: {
          not: parseInt(customerId), // Exclude the sender
        },
      },
      include: {
        accounts: {
          where: {
            deletedAt: null,
          },
          take: 1, // Get first active account
        },
      },
    });

    customers.forEach(c => {
      if (c.accounts && c.accounts.length > 0) {
        const account = c.accounts[0];
        const key = `${account.accountNumber}-${account.bankName || ''}`;
        if (!seenAccounts.has(key)) {
          seenAccounts.add(key);
          results.push({
            id: null, // No beneficiary ID since it's from Customer table
            customerId: Number(c.id),
            name: c.customerName,
            accountNumber: account.accountNumber,
            bankName: account.bankName || c.bankName,
            bankAccount: account.accountNumber,
            nickname: null,
            last4Digits: account.accountNumber.slice(-4),
            transferCount: 0,
            source: 'customer',
          });
        }
      }
    });

    // 3. Search in Transaction table (previous transactions)
    // Get all transactions first, then deduplicate by accountNumber+bankName
    const allTransactions = await prisma.transaction.findMany({
      where: {
        customerId: parseInt(customerId),
        deletedAt: null,
        receiverName: {
          contains: name,
          mode: 'insensitive',
        },
      },
      orderBy: {
        transactionDate: 'desc',
      },
      take: 50, // Get more to ensure we have enough after deduplication
    });

    // Deduplicate transactions by accountNumber+bankName combination
    allTransactions.forEach(t => {
      const key = `${t.accountNumber}-${t.bankName || ''}`;
      if (!seenAccounts.has(key)) {
        seenAccounts.add(key);
        results.push({
          id: null, // No beneficiary ID since it's from Transaction table
          name: t.receiverName,
          accountNumber: t.accountNumber,
          bankName: t.bankName,
          bankAccount: t.bankAccount || t.accountNumber,
          nickname: null,
          last4Digits: t.accountNumber.slice(-4),
          transferCount: 0,
          source: 'transaction',
        });
      }
    });

    return results;
  } catch (error) {
    console.error('Error searching beneficiaries:', error);
    throw error;
  }
}

/**
 * Get account balance for a customer
 */
async function getAccountBalance(customerId, accountId = null) {
  try {
    const where = {
      customerId: parseInt(customerId),
      deletedAt: null,
    };

    if (accountId) {
      where.id = parseInt(accountId);
    }

    const accounts = await prisma.account.findMany({
      where,
      select: {
        id: true,
        accountNumber: true,
        balance: true,
        currency: true,
        bankName: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'asc', // Order by creation date (oldest first)
      },
    });

    // Convert BigInt IDs and Decimal values to numbers for JSON serialization
    return accounts.map(acc => ({
      id: Number(acc.id),
      accountNumber: acc.accountNumber,
      balance: acc.balance?.toNumber ? acc.balance.toNumber() : Number(acc.balance),
      currency: acc.currency || 'NGN',
      bankName: acc.bankName,
      createdAt: acc.createdAt,
    }));
  } catch (error) {
    console.error('Error getting account balance:', error);
    throw error;
  }
}

/**
 * Initiate a transfer (creates transaction record)
 * Verifies both Customer and Transaction tables
 * @param {number} customerId - Sender customer ID
 * @param {number} accountId - Sender account ID
 * @param {Object} recipientData - Recipient data (name, accountNumber, bankName, bankAccount)
 * @param {number} amount - Transfer amount
 */
async function initiateTransfer(customerId, accountId, recipientData, amount) {
  try {
    // Verify customer exists in Customer table
    const customer = await prisma.customer.findFirst({
      where: {
        id: BigInt(customerId),
        deletedAt: null,
      },
      select: {
        id: true,
        customerName: true,
        phoneNumber: true,
        accountNumber: true,
      },
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    // Get account and verify it belongs to the customer
    const account = await prisma.account.findFirst({
      where: {
        id: BigInt(accountId),
        customerId: BigInt(customerId),
        deletedAt: null,
      },
    });

    if (!account) {
      throw new Error('Account not found');
    }

    // Verify balance is sufficient
    // Convert account.balance to number if it's a Decimal type
    const accountBalance = account.balance?.toNumber ? account.balance.toNumber() : Number(account.balance);
    if (accountBalance < amount) {
      throw new Error('Insufficient balance');
    }

    // Validate recipient data
    if (!recipientData || !recipientData.name || !recipientData.accountNumber) {
      throw new Error('Invalid recipient data');
    }

    // Find recipient's account by accountNumber (if exists in our system)
    const recipientAccount = await prisma.account.findFirst({
      where: {
        accountNumber: recipientData.accountNumber,
        deletedAt: null,
      },
      include: {
        customer: {
          select: {
            id: true,
            customerName: true,
          },
        },
      },
    });

    // Find recipient customer by accountNumber (if exists in our system)
    const recipientCustomer = await prisma.customer.findFirst({
      where: {
        accountNumber: recipientData.accountNumber,
        deletedAt: null,
      },
      select: {
        id: true,
        customerName: true,
      },
    });

    // Generate reference for sender transaction
    const senderReference = `TXN${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    // Generate reference for recipient transaction
    const recipientReference = `TXN${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const now = new Date();

    // Use transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // Create debit transaction record for sender
      const senderTransaction = await tx.transaction.create({
        data: {
          customerId: BigInt(customerId),
          accountId: BigInt(accountId),
          receiverName: recipientData.name,
          bankName: recipientData.bankName || null,
          bankAccount: recipientData.bankAccount || recipientData.accountNumber,
          accountNumber: recipientData.accountNumber,
          amount: parseFloat(amount),
          balanceBefore: accountBalance,
          balanceAfter: accountBalance - parseFloat(amount),
          transactionDate: now,
          createdAt: now,
          status: 'success',
          transactionType: 'debit',
          reference: senderReference,
        },
      });

      // Update sender account balance (debit)
      // Convert account.balance to number if it's a Decimal type
      const currentBalance = account.balance?.toNumber ? account.balance.toNumber() : Number(account.balance);
      const newBalance = currentBalance - parseFloat(amount);
      
      await tx.account.update({
        where: { id: BigInt(accountId) },
        data: { balance: newBalance },
      });

      // Handle recipient transaction - create record even if recipient doesn't have account in our system
      let recipientBalanceBefore = 0;
      let recipientBalanceAfter = 0;
      let recipientAccountId = null;
      let recipientCustomerId = null;

      if (recipientAccount) {
        // Recipient has account in our system - update balance
        // Convert balance to number if it's a Decimal type
        recipientBalanceBefore = recipientAccount.balance?.toNumber ? recipientAccount.balance.toNumber() : Number(recipientAccount.balance);
        recipientBalanceAfter = recipientBalanceBefore + parseFloat(amount);
        recipientAccountId = BigInt(recipientAccount.id);
        recipientCustomerId = BigInt(recipientAccount.customerId);
        
        await tx.account.update({
          where: { id: BigInt(recipientAccount.id) },
          data: { balance: recipientBalanceAfter },
        });
      } else if (recipientCustomer) {
        // Recipient is a customer but has no account record - use customer ID
        recipientCustomerId = BigInt(recipientCustomer.id);
        // Find or create a placeholder account for this customer
        const placeholderAccount = await tx.account.findFirst({
          where: {
            customerId: recipientCustomerId,
            deletedAt: null,
          },
        });
        
        if (placeholderAccount) {
          recipientAccountId = BigInt(placeholderAccount.id);
        } else {
          // Create a placeholder account for transaction history
          const newAccount = await tx.account.create({
            data: {
              customerId: recipientCustomerId,
              accountNumber: recipientData.accountNumber,
              balance: 0.00, // Explicitly set to 0.00
              currency: 'NGN',
              bankName: recipientData.bankName || null,
            },
          });
          recipientAccountId = BigInt(newAccount.id);
        }
      } else {
        // Recipient is not in our system - create system customer and account for transaction history
        // First, check if system customer exists (using a special identifier)
        let systemCustomer = await tx.customer.findFirst({
          where: {
            phoneNumber: 'SYSTEM_EXTERNAL',
            deletedAt: null,
          },
        });

        if (!systemCustomer) {
          // Create system customer for external recipients
          systemCustomer = await tx.customer.create({
            data: {
              customerName: 'External Recipient',
              phoneNumber: 'SYSTEM_EXTERNAL',
              accountNumber: '0000000000',
              pin: 'SYSTEM', // Placeholder PIN
              bankName: null,
            },
          });
        }

        recipientCustomerId = BigInt(systemCustomer.id);

        // Create or find account for this external recipient
        let externalAccount = await tx.account.findFirst({
          where: {
            accountNumber: recipientData.accountNumber,
            customerId: recipientCustomerId,
            deletedAt: null,
          },
        });

        if (!externalAccount) {
          externalAccount = await tx.account.create({
            data: {
              customerId: recipientCustomerId,
              accountNumber: recipientData.accountNumber,
              balance: 0.00, // Explicitly set to 0.00
              currency: 'NGN',
              bankName: recipientData.bankName || null,
            },
          });
        }

        recipientAccountId = BigInt(externalAccount.id);
      }

      // Create credit transaction record for recipient (always create, even for external recipients)
      await tx.transaction.create({
        data: {
          customerId: recipientCustomerId,
          accountId: recipientAccountId,
          receiverName: customer.customerName,
          bankName: account.bankName || null,
          bankAccount: account.accountNumber,
          accountNumber: account.accountNumber,
          amount: parseFloat(amount),
          balanceBefore: recipientBalanceBefore,
          balanceAfter: recipientBalanceAfter,
          transactionDate: now,
          createdAt: now,
          status: 'success',
          transactionType: 'credit',
          reference: recipientReference,
        },
      });

      // Update beneficiary transfer count if it's a saved beneficiary
      if (recipientData.beneficiaryId) {
        await tx.beneficiary.update({
          where: { id: parseInt(recipientData.beneficiaryId) },
          data: {
            transferCount: { increment: 1 },
            lastTransferredAt: now,
          },
        });
      }

      return senderTransaction;
    });

    // Convert BigInt IDs and Decimal values to numbers for JSON serialization
    return {
      ...result,
      id: Number(result.id),
      customerId: Number(result.customerId),
      accountId: Number(result.accountId),
      amount: result.amount?.toNumber ? result.amount.toNumber() : Number(result.amount),
      balanceBefore: result.balanceBefore?.toNumber ? result.balanceBefore.toNumber() : Number(result.balanceBefore),
      balanceAfter: result.balanceAfter?.toNumber ? result.balanceAfter.toNumber() : Number(result.balanceAfter),
    };
  } catch (error) {
    console.error('Error initiating transfer:', error);
    throw error;
  }
}

/**
 * Get customer by ID
 */
async function getCustomerById(customerId) {
  try {
    const customer = await prisma.customer.findFirst({
      where: {
        id: parseInt(customerId),
        deletedAt: null,
      },
      select: {
        id: true,
        customerName: true,
        phoneNumber: true,
        accountNumber: true,
        bankName: true,
      },
    });

    // Convert BigInt ID to number for JSON serialization
    if (customer) {
      customer.id = Number(customer.id);
    }

    return customer;
  } catch (error) {
    console.error('Error getting customer:', error);
    throw error;
  }
}

/**
 * Get customer by phone number
 */
async function getCustomerByPhone(phoneNumber) {
  try {
    // Normalize phone number to handle both +234 and 0 formats
    const { normalizePhone } = require('../utils/networkDetector');
    const normalizedPhone = normalizePhone(phoneNumber.toString()) || phoneNumber.toString().trim();
    
    // Try to find customer with normalized phone number first
    let customer = await prisma.customer.findFirst({
      where: {
        phoneNumber: normalizedPhone,
        deletedAt: null,
      },
      select: {
        id: true,
        customerName: true,
        phoneNumber: true,
        accountNumber: true,
        bankName: true,
      },
    });

    // If not found with normalized format, try the original format (in case it's stored differently)
    if (!customer) {
      const originalPhone = phoneNumber.toString().trim();
      // Also try with +234 format if normalized doesn't have it
      const plus234Format = originalPhone.startsWith('+234') ? originalPhone : 
                           originalPhone.startsWith('234') ? '+' + originalPhone :
                           originalPhone.startsWith('0') ? '+234' + originalPhone.substring(1) : null;
      
      if (plus234Format) {
        customer = await prisma.customer.findFirst({
          where: {
            phoneNumber: plus234Format,
            deletedAt: null,
          },
          select: {
            id: true,
            customerName: true,
            phoneNumber: true,
            accountNumber: true,
            bankName: true,
          },
        });
      }
      
      // Also try the original format as-is
      if (!customer && originalPhone !== normalizedPhone) {
        customer = await prisma.customer.findFirst({
          where: {
            phoneNumber: originalPhone,
            deletedAt: null,
          },
          select: {
            id: true,
            customerName: true,
            phoneNumber: true,
            accountNumber: true,
            bankName: true,
          },
        });
      }
    }

    // Convert BigInt ID to number for JSON serialization
    if (customer) {
      customer.id = Number(customer.id);
    }

    return customer;
  } catch (error) {
    console.error('Error getting customer by phone:', error);
    throw error;
  }
}

/**
 * Get bill payments within a date range, optionally filtered by payment type
 */
async function getBillPaymentsByDateRange(customerId, startDate, endDate, paymentType = null) {
  try {
    // Parse dates and set to start/end of day to include all payments for that day
    // Use UTC to ensure consistency across timezones
    // startDate should be at 00:00:00.000 UTC
    let startDateObj;
    if (typeof startDate === 'string' && startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      startDateObj = new Date(startDate + 'T00:00:00.000Z');
    } else {
      startDateObj = new Date(startDate);
      startDateObj.setUTCHours(0, 0, 0, 0);
    }
    
    // endDate should be at 23:59:59.999 UTC
    let endDateObj;
    if (typeof endDate === 'string' && endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      endDateObj = new Date(endDate + 'T23:59:59.999Z');
    } else {
      endDateObj = new Date(endDate);
      endDateObj.setUTCHours(23, 59, 59, 999);
    }
    
    const where = {
      customer_id: BigInt(customerId),
      deleted_at: null,
      payment_date: {
        gte: startDateObj,
        lte: endDateObj,
      },
    };

    // Filter by payment type if provided (e.g., "airtime", "data", "cable", "internet", "electricity")
    if (paymentType && paymentType !== 'all') {
      where.payment_type = {
        contains: paymentType.toLowerCase(),
        mode: 'insensitive',
      };
    }

    const billPayments = await prisma.bill_payments.findMany({
      where,
      orderBy: {
        payment_date: 'desc',
      },
      include: {
        accounts: {
          select: {
            id: true,
            accountNumber: true,
            bankName: true,
          },
        },
      },
    });

    // Convert BigInt IDs and Decimal values to numbers for JSON serialization
    return billPayments.map(bp => ({
      id: Number(bp.id),
      createdAt: bp.created_at,
      updatedAt: bp.updated_at,
      deletedAt: bp.deleted_at,
      customerId: Number(bp.customer_id),
      accountId: Number(bp.account_id),
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
      account: bp.accounts ? {
        id: Number(bp.accounts.id),
        accountNumber: bp.accounts.accountNumber,
        bankName: bp.accounts.bankName,
      } : null,
    }));
  } catch (error) {
    console.error('Error getting bill payments by date range:', error);
    throw error;
  }
}

/**
 * Get the most recent bill payment for a customer
 */
async function getLastBillPayment(customerId, paymentType = null) {
  try {
    const where = {
      customer_id: BigInt(customerId),
      deleted_at: null,
    };

    // Filter by payment type if provided (e.g., "airtime", "data", "cable", "internet", "electricity")
    if (paymentType && paymentType !== 'all') {
      where.payment_type = {
        contains: paymentType.toLowerCase(),
        mode: 'insensitive',
      };
    }

    const billPayment = await prisma.bill_payments.findFirst({
      where,
      orderBy: {
        payment_date: 'desc',
      },
      include: {
        accounts: {
          select: {
            id: true,
            accountNumber: true,
            bankName: true,
          },
        },
      },
    });

    if (!billPayment) {
      return null;
    }

    // Convert BigInt IDs and Decimal values to numbers for JSON serialization
    billPayment.id = Number(billPayment.id);
    billPayment.customer_id = Number(billPayment.customer_id);
    billPayment.account_id = Number(billPayment.account_id);
    
    // Convert Decimal fields to numbers
    billPayment.amount = billPayment.amount?.toNumber ? billPayment.amount.toNumber() : Number(billPayment.amount);
    billPayment.balance_before = billPayment.balance_before?.toNumber ? billPayment.balance_before.toNumber() : Number(billPayment.balance_before);
    billPayment.balance_after = billPayment.balance_after?.toNumber ? billPayment.balance_after.toNumber() : Number(billPayment.balance_after);
    
    if (billPayment.accounts) {
      billPayment.accounts.id = Number(billPayment.accounts.id);
    }

    return billPayment;
  } catch (error) {
    console.error('Error getting last bill payment:', error);
    throw error;
  }
}

/**
 * Update customer PIN (hashed)
 */
async function updateCustomerPIN(customerId, hashedPIN) {
  try {
    const customer = await prisma.customer.update({
      where: {
        id: BigInt(customerId),
      },
      data: {
        pin: hashedPIN,
      },
      select: {
        id: true,
        customerName: true,
        phoneNumber: true,
        accountNumber: true,
        bankName: true,
      },
    });

    // Convert BigInt ID to number
    customer.id = Number(customer.id);

    return customer;
  } catch (error) {
    console.error('Error updating customer PIN:', error);
    throw error;
  }
}

/**
 * Get customer PIN hash for verification
 */
async function getCustomerPINHash(customerId) {
  try {
    const customer = await prisma.customer.findFirst({
      where: {
        id: BigInt(customerId),
        deletedAt: null,
      },
      select: {
        id: true,
        pin: true,
      },
    });

    return customer ? customer.pin : null;
  } catch (error) {
    console.error('Error getting customer PIN hash:', error);
    throw error;
  }
}

/**
 * Generate a unique 10-digit account number
 */
async function generateAccountNumber() {
  let accountNumber;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    // Generate random 10-digit account number
    accountNumber = Math.floor(1000000000 + Math.random() * 9000000000).toString();

    // Check if account number already exists
    const existing = await prisma.customer.findFirst({
      where: {
        accountNumber: accountNumber,
        deletedAt: null,
      },
    });

    if (!existing) {
      isUnique = true;
    }

    attempts++;
  }

  if (!isUnique) {
    throw new Error('Failed to generate unique account number after multiple attempts');
  }

  return accountNumber;
}

/**
 * Create a new customer account
 */
async function createCustomer(customerName, phoneNumber, accountNumber, pin, bankName = null) {
  try {
    // Create customer and account in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create customer
      const customer = await tx.customer.create({
        data: {
          customerName,
          phoneNumber,
          accountNumber,
          pin, // PIN should already be hashed
          bankName,
        },
        select: {
          id: true,
          customerName: true,
          phoneNumber: true,
          accountNumber: true,
          bankName: true,
          createdAt: true,
        },
      });

      // Create account for the customer
      const account = await tx.account.create({
        data: {
          customerId: customer.id,
          accountNumber: accountNumber, // Use the same account number
          balance: 0.00, // Explicitly set to 0.00
          currency: 'NGN',
          bankName: bankName,
        },
        select: {
          id: true,
          accountNumber: true,
          balance: true,
          currency: true,
          bankName: true,
        },
      });

      // Convert BigInt IDs to numbers
      customer.id = Number(customer.id);
      account.id = Number(account.id);
      account.balance = account.balance?.toNumber ? account.balance.toNumber() : Number(account.balance);

      return {
        ...customer,
        account: account,
      };
    });

    return result;
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
}

module.exports = {
  getLastTransaction,
  getAllTransactions,
  getTransactionsByDateRange,
  getTransactionsByTimeRange,
  getBillPaymentsByDateRange,
  getLastBillPayment,
  searchBeneficiaries,
  getAccountBalance,
  initiateTransfer,
  getCustomerById,
  getCustomerByPhone,
  updateCustomerPIN,
  getCustomerPINHash,
  generateAccountNumber,
  createCustomer,
  prisma,
};

