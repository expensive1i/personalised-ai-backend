const { extractIntentWithGemini, processWithClaude, parseNaturalDate } = require('./llm');
const {
  getLastTransaction,
  getTransactionsByDateRange,
  getBillPaymentsByDateRange,
  searchBeneficiaries,
  getAccountBalance,
  initiateTransfer,
  getCustomerById,
} = require('./database');

/**
 * Conversation Manager - Handles multi-turn dialogues and natural language queries
 */
class ConversationManager {
  constructor(customerId) {
    this.customerId = customerId;
    this.conversationHistory = [];
    this.pendingAction = null;
  }

  /**
   * Main entry point for processing user messages
   */
  async processMessage(userMessage) {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    try {
      // Check if there's a pending action (confirmation, selection, etc.)
      if (this.pendingAction) {
        return await this.handlePendingAction(userMessage);
      }

      // Step 1: Extract intent with Gemini (fast)
      const intent = await extractIntentWithGemini(userMessage, this.conversationHistory);

      // Step 2: If low confidence or requires clarification, use Claude
      if (intent.confidence < 0.7 || intent.requiresClarification) {
        return await this.handleWithClaude(userMessage, intent);
      }

      // Step 3: Execute query based on intent
      return await this.executeIntent(intent, userMessage);
    } catch (error) {
      console.error('Error processing message:', error);
      return {
        response: "I'm sorry, I encountered an error processing your request. Please try again.",
        action: null,
      };
    }
  }

  /**
   * Handle pending actions (confirmations, selections)
   */
  async handlePendingAction(userMessage) {
    const message = userMessage.toLowerCase().trim();

    if (this.pendingAction.type === 'beneficiary_selection') {
      // User is selecting from multiple beneficiaries
      const selected = this.extractSelection(message, this.pendingAction.beneficiaries);

      if (selected) {
        this.pendingAction = {
          type: 'transfer_confirmation',
          beneficiary: selected,
          amount: this.pendingAction.amount,
        };

        const response = `You selected ${selected.name} with account ending in ${selected.last4Digits}. Should I proceed with the transfer of ₦${this.pendingAction.amount.toLocaleString()}?`;
        
        this.conversationHistory.push({
          role: 'assistant',
          content: response,
        });

        return {
          response,
          action: 'confirm_transfer',
          data: {
            beneficiary: selected,
            amount: this.pendingAction.amount,
          },
        };
      } else {
        return {
          response: "I didn't understand your selection. Please specify which beneficiary by number or account ending digits.",
          action: null,
        };
      }
    }

    if (this.pendingAction.type === 'transfer_confirmation') {
      // User is confirming a transfer
      if (this.isPositiveResponse(message)) {
        const { beneficiary, amount, accountId } = this.pendingAction;

        try {
          const transaction = await initiateTransfer(
            this.customerId,
            accountId,
            beneficiary.id,
            amount
          );

          this.pendingAction = null;

          const response = `✅ Transfer of ₦${amount.toLocaleString()} to ${beneficiary.name} has been initiated successfully! Reference: ${transaction.reference}`;

          this.conversationHistory.push({
            role: 'assistant',
            content: response,
          });

          return {
            response,
            action: 'transfer_completed',
            data: { transaction },
          };
        } catch (error) {
          this.pendingAction = null;
          return {
            response: `❌ Transfer failed: ${error.message}. Please try again.`,
            action: null,
          };
        }
      } else {
        this.pendingAction = null;
        const response = 'Transfer cancelled. Is there anything else I can help you with?';
        
        this.conversationHistory.push({
          role: 'assistant',
          content: response,
        });

        return {
          response,
          action: null,
        };
      }
    }

    return {
      response: "I didn't understand. Could you please clarify?",
      action: null,
    };
  }

  /**
   * Handle complex queries with Claude
   */
  async handleWithClaude(userMessage, initialIntent) {
    const tools = [
      {
        name: 'search_transactions',
        description: 'Search user transactions with date range and type filters. Use this for questions about transfers, bank transactions, etc. DO NOT use for airtime, data, cable, internet, or electricity - use search_bill_payments instead.',
        input_schema: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'Start date (YYYY-MM-DD). Can be null for "last transaction" queries' },
            endDate: { type: 'string', description: 'End date (YYYY-MM-DD). Can be null for single date queries' },
            transactionType: { type: 'string', description: 'Type: transfer, debit, credit, all' },
            limit: { type: 'number', description: 'Maximum number of transactions to return (default: 100)' },
          },
        },
      },
      {
        name: 'search_bill_payments',
        description: 'Search user bill payments (airtime, data, cable, internet, electricity) with date range and type filters. Use this for questions about airtime purchases, data purchases, cable TV payments, internet bills, electricity bills.',
        input_schema: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
            endDate: { type: 'string', description: 'End date (YYYY-MM-DD)' },
            paymentType: { type: 'string', description: 'Type: airtime, data, cable, internet, electricity, all' },
            limit: { type: 'number', description: 'Maximum number of payments to return (default: 100)' },
          },
        },
      },
      {
        name: 'get_last_transaction',
        description: 'Get the most recent transaction for the customer. Use for "last transaction", "recent transaction", "latest payment" queries.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'search_beneficiaries',
        description: 'Find beneficiaries by name (returns all matches). Use when user mentions a person name for transfers.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Beneficiary name to search (partial matches supported)' },
          },
        },
      },
      {
        name: 'get_account_balance',
        description: 'Get account balance for the customer. Use for "balance", "how much money", "account balance" queries.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_customer_info',
        description: 'Get customer information including name, phone, account number, bank name.',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
    ];

    const response = await processWithClaude(userMessage, this.conversationHistory, tools);

    // Handle multiple tool uses if needed
    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter(block => block.type === 'tool_use');
      
      if (toolUses.length > 0) {
        // Execute all tool calls
        const toolResults = await Promise.all(
          toolUses.map(async (toolUse) => {
            const result = await this.executeTool(toolUse.name, toolUse.input);
            return {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
            };
          })
        );
        
        // Send results back to Claude for natural language response
        // Build conversation history with tool results
        const followUpHistory = [
          ...this.conversationHistory,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResults },
        ];

        const followUp = await processWithClaude('Tool results received', followUpHistory, tools);

        const assistantResponse = followUp.content.find(c => c.type === 'text')?.text || 
          'I retrieved the information, but had trouble formatting the response.';

        this.conversationHistory.push({
          role: 'assistant',
          content: assistantResponse,
        });

        return {
          response: assistantResponse,
          action: null,
        };
      }
    }

    // Return conversational response (handles both banking and general questions)
    const textResponse = response.content.find(c => c.type === 'text')?.text || 
      'I understand, but I need more information to help you.';

    this.conversationHistory.push({
      role: 'assistant',
      content: textResponse,
    });

    return {
      response: textResponse,
      action: null,
    };
  }

  /**
   * Execute tool calls
   */
  async executeTool(toolName, parameters) {
    try {
      switch (toolName) {
        case 'search_transactions':
          // Handle queries without date range (e.g., "all my transactions")
          let startDate = parameters.startDate;
          let endDate = parameters.endDate;
          
          // If no dates provided, get all transactions (or last 30 days)
          if (!startDate || !endDate) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            startDate = startDate || thirtyDaysAgo.toISOString().split('T')[0];
            endDate = endDate || new Date().toISOString().split('T')[0];
          }
          
          const transactions = await getTransactionsByDateRange(
            this.customerId,
            startDate,
            endDate,
            parameters.transactionType || 'all'
          );
          
          // Apply limit if specified
          const limit = parameters.limit || 100;
          const limitedTransactions = transactions.slice(0, limit);
          
          return { 
            transactions: limitedTransactions, 
            count: limitedTransactions.length,
            total: transactions.length,
            dateRange: { startDate, endDate }
          };

        case 'search_bill_payments':
          // Handle bill payment queries (airtime, data, cable, internet, electricity)
          let billStartDate = parameters.startDate;
          let billEndDate = parameters.endDate;
          
          // If no dates provided, get all bill payments (or last 30 days)
          if (!billStartDate || !billEndDate) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            billStartDate = billStartDate || thirtyDaysAgo.toISOString().split('T')[0];
            billEndDate = billEndDate || new Date().toISOString().split('T')[0];
          }
          
          const billPayments = await getBillPaymentsByDateRange(
            this.customerId,
            billStartDate,
            billEndDate,
            parameters.paymentType || 'all'
          );
          
          // Apply limit if specified
          const billLimit = parameters.limit || 100;
          const limitedBillPayments = billPayments.slice(0, billLimit);
          
          return { 
            billPayments: limitedBillPayments, 
            count: limitedBillPayments.length,
            total: billPayments.length,
            dateRange: { startDate: billStartDate, endDate: billEndDate }
          };

        case 'get_last_transaction':
          const lastTransaction = await getLastTransaction(this.customerId);
          return { transaction: lastTransaction, found: !!lastTransaction };

        case 'search_beneficiaries':
          const beneficiaries = await searchBeneficiaries(this.customerId, parameters.name);
          return { beneficiaries, count: beneficiaries.length };

        case 'get_account_balance':
          const accounts = await getAccountBalance(this.customerId);
          const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);
          return { accounts, totalBalance, count: accounts.length };

        case 'get_customer_info':
          const customer = await getCustomerById(this.customerId);
          return { customer, found: !!customer };

        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      console.error(`Error executing tool ${toolName}:`, error);
      return { error: error.message || 'Failed to execute tool' };
    }
  }

  /**
   * Execute intent from Gemini extraction
   */
  async executeIntent(intent, originalMessage) {
    const { intent: intentType, parameters } = intent;

    switch (intentType) {
      case 'get_last_transaction':
        return await this.handleGetLastTransaction();

      case 'query_transaction':
        return await this.handleQueryTransactions(parameters);

      case 'query_bill_payment':
      case 'buy_airtime':
        return await this.handleQueryBillPayments(parameters);

      case 'make_transfer':
        return await this.handleMakeTransfer(parameters, originalMessage);

      case 'check_balance':
        return await this.handleCheckBalance();

      default:
        // Fallback to Claude for unclear intents
        return await this.handleWithClaude(originalMessage, intent);
    }
  }

  /**
   * Handle "get last transaction" query
   */
  async handleGetLastTransaction() {
    const transaction = await getLastTransaction(this.customerId);

    if (!transaction) {
      const response = "You don't have any transactions yet.";
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    const date = new Date(transaction.transactionDate).toLocaleDateString('en-NG');
    const response = `Your last transaction was a ${transaction.transactionType} of ₦${transaction.amount.toLocaleString()} to ${transaction.receiverName} on ${date}. Status: ${transaction.status}`;

    this.conversationHistory.push({ role: 'assistant', content: response });
    return { response, action: null };
  }

  /**
   * Handle transaction queries with date ranges
   */
  async handleQueryTransactions(parameters) {
    let { startDate, endDate, transactionType } = parameters;

    // Parse natural language dates
    if (startDate && !startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      startDate = parseNaturalDate(startDate, false);
    }
    if (endDate && !endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      endDate = parseNaturalDate(endDate, true);
    }

    if (!startDate || !endDate) {
      const response = "I need specific dates to search your transactions. Could you provide a date range?";
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    const transactions = await getTransactionsByDateRange(
      this.customerId,
      startDate,
      endDate,
      transactionType || 'all'
    );

    if (transactions.length === 0) {
      const response = `You don't have any ${transactionType || ''} transactions between ${startDate} and ${endDate}.`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    const response = `I found ${transactions.length} transaction(s) between ${startDate} and ${endDate}.`;
    this.conversationHistory.push({ role: 'assistant', content: response });
    return { response, action: null, data: { transactions } };
  }

  /**
   * Handle bill payment queries (airtime, data, cable, internet, electricity)
   */
  async handleQueryBillPayments(parameters) {
    let { startDate, endDate, transactionType } = parameters;
    
    // Map transactionType to paymentType for bill payments
    let paymentType = null;
    if (transactionType) {
      const typeMap = {
        'airtime': 'airtime',
        'data': 'data',
        'cable': 'cable',
        'internet': 'internet',
        'electricity': 'electricity',
      };
      paymentType = typeMap[transactionType.toLowerCase()] || transactionType.toLowerCase();
    }

    // Parse natural language dates
    if (startDate && !startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      startDate = parseNaturalDate(startDate, false);
    }
    if (endDate && !endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      endDate = parseNaturalDate(endDate, true);
    }

    // If no dates provided, default to current year
    if (!startDate || !endDate) {
      const currentYear = new Date().getFullYear();
      startDate = startDate || `${currentYear}-01-01`;
      endDate = endDate || `${currentYear}-12-31`;
    }

    const billPayments = await getBillPaymentsByDateRange(
      this.customerId,
      startDate,
      endDate,
      paymentType || 'all'
    );

    if (billPayments.length === 0) {
      const typeText = paymentType ? paymentType : 'bill payment';
      const response = `You don't have any ${typeText} records between ${startDate} and ${endDate}.`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    // Calculate total
    const total = billPayments.reduce((sum, bp) => sum + bp.amount, 0);
    const typeText = paymentType || 'bill payment';
    const response = `Between ${startDate} and ${endDate}, you made ${billPayments.length} ${typeText} payment(s) for a total of ₦${total.toLocaleString()}.`;
    
    this.conversationHistory.push({ role: 'assistant', content: response });
    return { response, action: null, data: { billPayments, total } };
  }

  /**
   * Handle transfer requests
   */
  async handleMakeTransfer(parameters, originalMessage) {
    const { recipientName, amount } = parameters;

    if (!recipientName || !amount) {
      const response = "I need the recipient name and amount to make a transfer. Could you provide both?";
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    // Search for beneficiaries
    const beneficiaries = await searchBeneficiaries(this.customerId, recipientName);

    if (beneficiaries.length === 0) {
      const response = `I couldn't find any beneficiary named "${recipientName}" in your saved recipients. Would you like to add them first?`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    if (beneficiaries.length === 1) {
      // Single match - ask for confirmation
      const beneficiary = beneficiaries[0];
      const accounts = await getAccountBalance(this.customerId);
      const accountId = accounts[0]?.id;

      if (!accountId) {
        return {
          response: "You don't have an active account. Please contact support.",
          action: null,
        };
      }

      this.pendingAction = {
        type: 'transfer_confirmation',
        beneficiary,
        amount: parseFloat(amount),
        accountId,
      };

      const response = `I found ${beneficiary.name} with ${beneficiary.bankName || 'bank'} (account ending in ${beneficiary.last4Digits}). Should I proceed with the transfer of ₦${amount.toLocaleString()}?`;

      this.conversationHistory.push({ role: 'assistant', content: response });
      return {
        response,
        action: 'confirm_transfer',
        data: { beneficiary, amount: parseFloat(amount) },
      };
    }

    // Multiple matches - ask for clarification
    const options = beneficiaries.map((b, i) => 
      `${i + 1}. ${b.name} - ${b.bankName || 'bank'} (account ending in ${b.last4Digits})`
    ).join('\n');

    const accounts = await getAccountBalance(this.customerId);
    const accountId = accounts[0]?.id;

    this.pendingAction = {
      type: 'beneficiary_selection',
      beneficiaries,
      amount: parseFloat(amount),
      accountId,
    };

    const response = `I found ${beneficiaries.length} people named "${recipientName}":\n\n${options}\n\nWhich one would you like to send ₦${amount.toLocaleString()} to? You can say "the first one" or mention the account number ending.`;

    this.conversationHistory.push({ role: 'assistant', content: response });
    return {
      response,
      action: 'select_beneficiary',
      data: { beneficiaries, amount: parseFloat(amount) },
    };
  }

  /**
   * Handle balance check
   */
  async handleCheckBalance() {
    const accounts = await getAccountBalance(this.customerId);

    if (accounts.length === 0) {
      const response = "You don't have any active accounts.";
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    const balanceText = accounts.map(acc => 
      `Account ${acc.accountNumber}: ₦${acc.balance.toLocaleString()} ${acc.currency}`
    ).join('\n');

    const response = `Your account balance(s):\n${balanceText}`;
    this.conversationHistory.push({ role: 'assistant', content: response });
    return { response, action: null, data: { accounts } };
  }

  /**
   * Extract user selection from message
   */
  extractSelection(message, options) {
    // Check for number selection (1, 2, first, second, etc.)
    const numberMatch = message.match(/(\d+)|(first|second|third|fourth|fifth)/i);
    if (numberMatch) {
      let index = 0;
      if (numberMatch[1]) {
        index = parseInt(numberMatch[1]) - 1;
      } else {
        const words = ['first', 'second', 'third', 'fourth', 'fifth'];
        index = words.findIndex(w => message.toLowerCase().includes(w));
      }
      if (index >= 0 && index < options.length) {
        return options[index];
      }
    }

    // Check for account number ending
    for (const option of options) {
      if (message.includes(option.last4Digits)) {
        return option;
      }
    }

    return null;
  }

  /**
   * Check if user response is positive confirmation
   */
  isPositiveResponse(message) {
    const positiveWords = ['yes', 'yeah', 'sure', 'ok', 'okay', 'proceed', 'go ahead', 'confirm', 'correct', 'right'];
    const negativeWords = ['no', 'cancel', 'stop', 'abort', 'wrong', 'incorrect'];
    
    const lowerMessage = message.toLowerCase();
    
    // Check for negative first
    if (negativeWords.some(word => lowerMessage.includes(word))) {
      return false;
    }
    
    // Check for positive
    return positiveWords.some(word => lowerMessage.includes(word));
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return this.conversationHistory;
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
    this.pendingAction = null;
  }
}

module.exports = ConversationManager;

