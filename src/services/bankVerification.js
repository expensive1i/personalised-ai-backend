const axios = require('axios');
const path = require('path');

// Load Nigerian Banks from JSON file
const NigerianBanks = require(path.join(__dirname, '../../data/nigerian-banks.json'));

/**
 * Validate NUBAN (Nigerian Uniform Bank Account Number)
 */
function validateNUBAN(accountNumber, bankCode) {
  if (accountNumber.length !== 10) {
    return false;
  }

  // NUBAN algorithm weights (repeating pattern)
  const weights = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];

  // Combine bank code and first 9 digits of account number
  const serialNumber = bankCode + accountNumber.substring(0, 9);

  let sum = 0;
  for (let i = 0; i < serialNumber.length; i++) {
    const digit = parseInt(serialNumber[i]);
    if (isNaN(digit)) {
      return false;
    }
    // Use modulo to cycle through weights array for variable-length bank codes
    const weightIndex = i % weights.length;
    sum += digit * weights[weightIndex];
  }

  // Calculate check digit
  const checkDigit = (10 - (sum % 10)) % 10;

  // Get the last digit of account number
  const lastDigit = parseInt(accountNumber[9]);
  if (isNaN(lastDigit)) {
    return false;
  }

  return checkDigit === lastDigit;
}

/**
 * Detect possible banks for an account number using NUBAN validation
 */
function detectPossibleBanks(accountNumber) {
  const possibleBanks = [];

  if (accountNumber.length !== 10) {
    return possibleBanks;
  }

  for (const bank of NigerianBanks) {
    if (validateNUBAN(accountNumber, bank.code)) {
      possibleBanks.push(bank);
    }
  }

  return possibleBanks;
}

/**
 * Verify account with Paystack API
 */
async function verifyWithPaystack(accountNumber, bankCode) {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  const paystackApiUrl = process.env.PAYSTACK_API_URL || 'https://api.paystack.co';

  if (!paystackSecretKey) {
    throw new Error('Paystack API key not configured');
  }

  const url = `${paystackApiUrl}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    if (!response.data.status) {
      throw new Error(`Verification failed: ${response.data.message}`);
    }

    // Find bank name from code
    const bank = NigerianBanks.find(b => b.code === bankCode);
    const bankName = bank ? bank.name : '';

    return {
      account_number: response.data.data.account_number,
      account_name: response.data.data.account_name,
      bank_name: bankName,
      bank_code: bankCode,
    };
  } catch (error) {
    if (error.response) {
      throw new Error(`Paystack API error: ${error.response.data.message || error.message}`);
    }
    throw error;
  }
}

/**
 * Verify account number
 * If bankCode is not provided, auto-detects possible banks using NUBAN validation
 */
async function verifyAccount(accountNumber, bankCode = null) {
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!paystackSecretKey) {
    throw new Error('Paystack API key not configured');
  }

  // If bank code is provided, verify directly
  if (bankCode) {
    return await verifyWithPaystack(accountNumber, bankCode);
  }

  // If no bank code, detect possible banks using NUBAN validation
  const possibleBanks = detectPossibleBanks(accountNumber);

  // Try each possible bank from NUBAN validation until one succeeds
  let lastError = null;
  for (const bank of possibleBanks) {
    try {
      const details = await verifyWithPaystack(accountNumber, bank.code);
      return details;
    } catch (error) {
      lastError = error;
    }
  }

  // If NUBAN validation banks failed and account number starts with 90, 80, 81, or 70,
  // also try OPay and PalmPay (fintech companies that use phone-number-like accounts)
  if (accountNumber.length >= 2) {
    const firstTwoDigits = accountNumber.substring(0, 2);
    if (['90', '80', '81', '70'].includes(firstTwoDigits)) {
      // Try OPay (code: 999992)
      try {
        const opayDetails = await verifyWithPaystack(accountNumber, '999992');
        return opayDetails;
      } catch (error) {
        lastError = error;
      }

      // Try PalmPay (code: 999991)
      try {
        const palmpayDetails = await verifyWithPaystack(accountNumber, '999991');
        return palmpayDetails;
      } catch (error) {
        lastError = error;
      }
    }
  }

  // If we had NUBAN banks, return error with those attempts
  if (possibleBanks.length > 0) {
    throw new Error(`Verification failed for all possible banks: ${lastError?.message || 'Unknown error'}`);
  }

  // If no NUBAN banks found and fintech check also failed
  throw new Error(`Invalid account number format or no matching bank found: ${lastError?.message || 'Unknown error'}`);
}

module.exports = {
  verifyAccount,
  verifyWithPaystack,
  validateNUBAN,
  detectPossibleBanks,
  NigerianBanks,
};

