/**
 * Pending Transactions Service
 * 
 * Manages pending transactions that require PIN verification.
 * In production, this should use Redis or a database for persistence.
 */

// Store pending transactions with unique IDs
const pendingTransactions = new Map();

/**
 * Generate a unique transaction ID
 */
function generateTransactionId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9).toUpperCase();
  return `TXN-${timestamp}-${random}`;
}

/**
 * Create a pending transaction
 * @param {Object} transactionData - Transaction data
 * @param {string} transactionData.type - Transaction type (transfer, airtime, data, etc.)
 * @param {number} transactionData.customerId - Customer ID
 * @param {Object} transactionData.data - Transaction-specific data
 * @returns {string} Transaction ID
 */
function createPendingTransaction(transactionData) {
  const transactionId = generateTransactionId();
  
  pendingTransactions.set(transactionId, {
    id: transactionId,
    type: transactionData.type,
    customerId: transactionData.customerId,
    createdAt: new Date(),
    ...transactionData.data,
  });

  // Auto-expire transactions after 15 minutes
  setTimeout(() => {
    if (pendingTransactions.has(transactionId)) {
      pendingTransactions.delete(transactionId);
    }
  }, 15 * 60 * 1000);

  return transactionId;
}

/**
 * Get a pending transaction by ID
 * @param {string} transactionId - Transaction ID
 * @returns {Object|null} Pending transaction or null
 */
function getPendingTransaction(transactionId) {
  return pendingTransactions.get(transactionId) || null;
}

/**
 * Delete a pending transaction
 * @param {string} transactionId - Transaction ID
 */
function deletePendingTransaction(transactionId) {
  pendingTransactions.delete(transactionId);
}

module.exports = {
  pendingTransactions,
  createPendingTransaction,
  getPendingTransaction,
  deletePendingTransaction,
};

