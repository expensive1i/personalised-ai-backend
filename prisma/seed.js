const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Nigerian first names
const nigerianFirstNames = [
  'Adebayo', 'Chinedu', 'Emeka', 'Fatima', 'Hassan', 'Ijeoma', 'Kemi', 'Musa',
  'Ngozi', 'Oluwaseun', 'Amina', 'Babatunde', 'Chiamaka', 'David', 'Ebere',
  'Folake', 'Gbemi', 'Ibrahim', 'Jumoke', 'Kemi', 'Lola', 'Mohammed', 'Nkechi',
  'Obinna', 'Priscilla', 'Quadri', 'Rashida', 'Sani', 'Temi', 'Uche', 'Victoria',
  'Wale', 'Yemi', 'Zainab', 'Adeola', 'Bukola', 'Chika', 'Damilola', 'Emmanuel',
  'Funmi', 'Grace', 'Hauwa', 'Ifeoma', 'Joy', 'Kemi', 'Lilian', 'Maryam',
  'Nkem', 'Oluwatosin', 'Peace'
];

// Nigerian last names
const nigerianLastNames = [
  'Adebayo', 'Adekunle', 'Adeniyi', 'Adewale', 'Adeyemi', 'Afolabi', 'Agboola',
  'Akinwale', 'Alade', 'Bello', 'Chukwu', 'Eze', 'Ibrahim', 'Mohammed', 'Musa',
  'Okafor', 'Okoro', 'Olawale', 'Oluwaseun', 'Onyeka', 'Sani', 'Umar', 'Yusuf',
  'Adeyinka', 'Akinola', 'Babatunde', 'Chinedu', 'Emeka', 'Gbemi', 'Ijeoma',
  'Ngozi', 'Obinna', 'Quadri', 'Rashida', 'Temi', 'Uche', 'Adeola', 'Bukola',
  'Chika', 'Damilola', 'Emmanuel', 'Funmi', 'Grace', 'Hauwa', 'Ifeoma', 'Joy',
  'Kemi', 'Lilian', 'Maryam', 'Nkem', 'Oluwatosin'
];

// Nigerian banks
const nigerianBanks = [
  'Access Bank', 'First Bank', 'Guaranty Trust Bank', 'United Bank for Africa',
  'Zenith Bank', 'Fidelity Bank', 'Union Bank', 'Stanbic IBTC', 'Sterling Bank',
  'Wema Bank', 'Polaris Bank', 'First City Monument Bank', 'Keystone Bank',
  'Providus Bank', 'Jaiz Bank'
];

// Nigerian phone number prefixes
const phonePrefixes = ['080', '081', '070', '090', '091'];

// Payment types for bill_payments
const paymentTypes = ['airtime', 'data', 'cable', 'internet', 'electricity'];
const providers = ['MTN', 'Airtel', 'Glo', '9mobile', 'DSTV', 'GOTV', 'Startimes', 'IKEDC', 'EKEDC'];

// Transaction types
const transactionTypes = ['debit', 'credit'];
const transactionStatuses = ['success', 'pending', 'failed'];

/**
 * Generate a random Nigerian phone number
 */
function generatePhoneNumber() {
  const prefix = phonePrefixes[Math.floor(Math.random() * phonePrefixes.length)];
  const suffix = Math.floor(10000000 + Math.random() * 90000000);
  return `+234${prefix.substring(1)}${suffix}`;
}

/**
 * Generate a random 10-digit account number
 */
function generateAccountNumber() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

/**
 * Generate a random date within the last year
 */
function randomDate(start = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), end = new Date()) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

/**
 * Generate a random amount
 */
function randomAmount(min = 100, max = 100000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Main seed function
 */
async function main() {
  console.log('🌱 Starting database seed...');

  // Clear existing data (optional - comment out if you want to keep existing data)
  console.log('🧹 Cleaning existing data...');
  await prisma.transaction.deleteMany({});
  await prisma.bill_payments.deleteMany({});
  await prisma.beneficiary.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.customer.deleteMany({});

  // Generate customers
  console.log('👥 Creating 50 customers...');
  const customers = [];
  const defaultPIN = await bcrypt.hash('0000', 10);

  for (let i = 0; i < 50; i++) {
    const firstName = nigerianFirstNames[Math.floor(Math.random() * nigerianFirstNames.length)];
    const lastName = nigerianLastNames[Math.floor(Math.random() * nigerianLastNames.length)];
    const customerName = `${firstName} ${lastName}`;
    const phoneNumber = generatePhoneNumber();
    const accountNumber = generateAccountNumber();
    const bankName = nigerianBanks[Math.floor(Math.random() * nigerianBanks.length)];

    // Check if phone number or account number already exists
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        OR: [
          { phoneNumber },
          { accountNumber },
        ],
      },
    });

    if (existingCustomer) {
      i--; // Retry this iteration
      continue;
    }

    const customer = await prisma.customer.create({
      data: {
        customerName,
        phoneNumber,
        accountNumber,
        pin: defaultPIN,
        bankName,
        createdAt: randomDate(new Date(Date.now() - 730 * 24 * 60 * 60 * 1000)), // Last 2 years
      },
    });

    // Create account for customer
    const initialBalance = randomAmount(1000, 500000);
    const account = await prisma.account.create({
      data: {
        customerId: customer.id,
        accountNumber: accountNumber,
        balance: initialBalance,
        currency: 'NGN',
        bankName: bankName,
        createdAt: customer.createdAt,
      },
    });

    customers.push({ customer, account });
  }

  console.log(`✅ Created ${customers.length} customers with accounts`);

  // Generate transactions
  console.log('💸 Creating transactions...');
  let transactionCount = 0;
  for (const { customer, account } of customers) {
    // Each customer gets 5-15 transactions
    const numTransactions = Math.floor(Math.random() * 11) + 5;

    for (let i = 0; i < numTransactions; i++) {
      const amount = randomAmount(500, 50000);
      const transactionDate = randomDate();
      const status = transactionStatuses[Math.floor(Math.random() * transactionStatuses.length)];
      const transactionType = transactionTypes[Math.floor(Math.random() * transactionTypes.length)];

      // Get current balance (simplified - in real scenario, calculate from previous transactions)
      const currentBalance = parseFloat(account.balance);
      const balanceBefore = currentBalance;
      const balanceAfter = transactionType === 'debit' 
        ? currentBalance - amount 
        : currentBalance + amount;

      const receiverName = `${nigerianFirstNames[Math.floor(Math.random() * nigerianFirstNames.length)]} ${nigerianLastNames[Math.floor(Math.random() * nigerianLastNames.length)]}`;
      const receiverBank = nigerianBanks[Math.floor(Math.random() * nigerianBanks.length)];
      const receiverAccount = generateAccountNumber();

      const reference = `TXN${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      await prisma.transaction.create({
        data: {
          customerId: customer.id,
          accountId: account.id,
          receiverName,
          bankName: receiverBank,
          bankAccount: receiverAccount,
          accountNumber: receiverAccount,
          amount: amount,
          balanceBefore: balanceBefore,
          balanceAfter: balanceAfter,
          transactionDate: transactionDate,
          createdAt: transactionDate,
          status: status,
          transactionType: transactionType,
          reference: reference,
        },
      });

      transactionCount++;
    }

    // Update account balance based on transactions
    const transactions = await prisma.transaction.findMany({
      where: {
        accountId: account.id,
        deletedAt: null,
      },
      orderBy: {
        transactionDate: 'asc',
      },
    });

    let runningBalance = parseFloat(account.balance);
    for (const txn of transactions) {
      if (txn.transactionType === 'debit') {
        runningBalance -= parseFloat(txn.amount);
      } else {
        runningBalance += parseFloat(txn.amount);
      }
    }

    await prisma.account.update({
      where: { id: account.id },
      data: { balance: Math.max(0, runningBalance) },
    });
  }

  console.log(`✅ Created ${transactionCount} transactions`);

  // Generate beneficiaries
  console.log('👤 Creating beneficiaries...');
  let beneficiaryCount = 0;
  for (const { customer } of customers) {
    // Each customer gets 2-5 beneficiaries
    const numBeneficiaries = Math.floor(Math.random() * 4) + 2;

    for (let i = 0; i < numBeneficiaries; i++) {
      const recipientName = `${nigerianFirstNames[Math.floor(Math.random() * nigerianFirstNames.length)]} ${nigerianLastNames[Math.floor(Math.random() * nigerianLastNames.length)]}`;
      const recipientPhone = generatePhoneNumber();
      const beneficiaryAccount = generateAccountNumber();
      const beneficiaryBank = nigerianBanks[Math.floor(Math.random() * nigerianBanks.length)];

      await prisma.beneficiary.create({
        data: {
          customerId: customer.id,
          recipientName,
          recipientPhone,
          accountNumber: beneficiaryAccount,
          bankName: beneficiaryBank,
          bankAccount: beneficiaryAccount,
          transferCount: BigInt(Math.floor(Math.random() * 10)),
          lastTransferredAt: randomDate(),
          createdAt: randomDate(),
        },
      });

      beneficiaryCount++;
    }
  }

  console.log(`✅ Created ${beneficiaryCount} beneficiaries`);

  // Generate bill payments
  console.log('📱 Creating bill payments...');
  let billPaymentCount = 0;
  for (const { customer, account } of customers) {
    // Each customer gets 3-8 bill payments
    const numBillPayments = Math.floor(Math.random() * 6) + 3;

    for (let i = 0; i < numBillPayments; i++) {
      const paymentType = paymentTypes[Math.floor(Math.random() * paymentTypes.length)];
      const provider = providers[Math.floor(Math.random() * providers.length)];
      const phoneNumber = generatePhoneNumber();
      const amount = randomAmount(100, 10000);
      const paymentDate = randomDate();
      const status = transactionStatuses[Math.floor(Math.random() * transactionStatuses.length)];

      // Get current balance
      const currentAccount = await prisma.account.findUnique({
        where: { id: account.id },
      });
      const balanceBefore = parseFloat(currentAccount.balance);
      const balanceAfter = balanceBefore - amount;

      const reference = `BILL${Date.now()}${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

      await prisma.bill_payments.create({
        data: {
          customer_id: customer.id,
          account_id: account.id,
          payment_type: paymentType,
          provider: provider,
          phone_number: phoneNumber,
          meter_number: paymentType === 'electricity' ? generateAccountNumber() : null,
          account_number: account.accountNumber,
          amount: amount,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
          payment_date: paymentDate,
          status: status,
          reference: reference,
          description: `${paymentType} purchase for ${phoneNumber}`,
          created_at: paymentDate,
        },
      });

      billPaymentCount++;
    }
  }

  console.log(`✅ Created ${billPaymentCount} bill payments`);

  console.log('\n🎉 Seed completed successfully!');
  console.log(`📊 Summary:`);
  console.log(`   - Customers: ${customers.length}`);
  console.log(`   - Transactions: ${transactionCount}`);
  console.log(`   - Beneficiaries: ${beneficiaryCount}`);
  console.log(`   - Bill Payments: ${billPaymentCount}`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

