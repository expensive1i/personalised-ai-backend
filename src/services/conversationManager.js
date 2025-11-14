const { extractIntentWithGemini, processWithClaude, parseNaturalDate, parseRelativeTime } = require('./llm');
const {
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
} = require('./database');
const { normalizePhone, normalizeAccountNumber } = require('../utils/networkDetector');

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
        description: 'Search user transactions with date range, time range, and type filters. Use this for questions about transfers, bank transactions, spending, etc. Supports date ranges (YYYY-MM-DD), relative time (e.g., "last 2 hours", "last 30 minutes", "last week"), or NO DATE RANGE for "all transactions" queries. If user says "all my transactions", "show everything", "no date needed", "all transactions" - set startDate and endDate to null. DO NOT use for airtime, data, cable, internet, or electricity - use search_bill_payments instead.',
        input_schema: {
          type: 'object',
          properties: {
            startDate: { type: 'string', description: 'Start date (YYYY-MM-DD) or relative time (e.g., "last 2 hours", "last 30 minutes", "last week"). Can be null for "all transactions" or "no date range" queries' },
            endDate: { type: 'string', description: 'End date (YYYY-MM-DD) or "now" for current time. Can be null for single date queries, relative time queries, or "all transactions" queries' },
            startTime: { type: 'string', description: 'Start time in ISO format (YYYY-MM-DDTHH:mm:ssZ). Use this for precise time-based queries. Overrides startDate if provided.' },
            endTime: { type: 'string', description: 'End time in ISO format (YYYY-MM-DDTHH:mm:ssZ). Use this for precise time-based queries. Overrides endDate if provided.' },
            transactionType: { type: 'string', description: 'Type: transfer, debit, credit, all' },
            limit: { type: 'number', description: 'Maximum number of transactions to return (default: 1000 for "all transactions", 100 for date range queries)' },
            getAll: { type: 'boolean', description: 'Set to true if user wants ALL transactions without date range (e.g., "all transactions", "show everything", "no date needed")' },
          },
        },
      },
      {
        name: 'search_bill_payments',
        description: 'Search user bill payments (airtime, data, cable, internet, electricity) with date range and type filters. Use this for questions about airtime purchases, data purchases, cable TV payments, internet bills, electricity bills. DO NOT use for "last" or "most recent" queries - use get_last_bill_payment instead.',
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
        name: 'get_last_bill_payment',
        description: 'Get the most recent bill payment (airtime, data, cable, internet, electricity) for the customer. Use for queries like: "last airtime purchase", "last bill payment", "most recent airtime", "recent airtime purchase", "what phone number did I last buy airtime for", "phone number from my last airtime", "who did I last send airtime to", "last airtime I transferred", "last airtime I bought". This tool returns the complete bill payment record including phone_number, amount, date, provider, etc. Can optionally filter by payment type (airtime, data, cable, internet, electricity).',
        input_schema: {
          type: 'object',
          properties: {
            paymentType: { type: 'string', description: 'Optional: Filter by payment type (airtime, data, cable, internet, electricity). For queries about "airtime", use "airtime". Leave empty or null for all types.' },
          },
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
        description: 'Get account BALANCE (the amount of money) for the customer. Use ONLY for queries about: "balance", "how much money", "account balance", "what is my balance", "how much do I have". DO NOT use for queries about account NUMBER (the 10-digit identifier).',
        input_schema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_customer_info',
        description: 'Get customer information including name, phone, ACCOUNT NUMBER (the 10-digit identifier), bank name. Use for queries about: "what is my account number", "my account number", "account number", "what account number do I have". This returns the account number (e.g., "1234567890"), NOT the balance.',
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
      // Normalize phone numbers in parameters if present
      if (parameters && typeof parameters === 'object') {
        for (const key in parameters) {
          if (key.toLowerCase().includes('phone') && typeof parameters[key] === 'string') {
            const normalized = normalizePhone(parameters[key]);
            if (normalized) {
              parameters[key] = normalized;
            }
          }
        }
      }
      
      switch (toolName) {
        case 'search_transactions':
          // Check if user wants ALL transactions (no date range)
          if (parameters.getAll === true || (!parameters.startDate && !parameters.endDate && !parameters.startTime && !parameters.endTime)) {
            const limit = parameters.limit || 1000; // Default to 1000 for "all transactions"
            const transactions = await getAllTransactions(
              this.customerId,
              parameters.transactionType || 'all',
              limit
            );
            
            return { 
              transactions, 
              count: transactions.length,
              total: transactions.length,
              allTransactions: true
            };
          }
          
          // Handle time-based queries (e.g., "last 2 hours", "last 30 minutes")
          let startTime = parameters.startTime;
          let endTime = parameters.endTime;
          let startDate = parameters.startDate;
          let endDate = parameters.endDate;
          
          // If precise times are provided, use them directly
          if (startTime && endTime) {
            const transactions = await getTransactionsByTimeRange(
              this.customerId,
              new Date(startTime),
              new Date(endTime),
              parameters.transactionType || 'all'
            );
            
            const limit = parameters.limit || 100;
            const limitedTransactions = transactions.slice(0, limit);
            
            return { 
              transactions: limitedTransactions, 
              count: limitedTransactions.length,
              total: transactions.length,
              timeRange: { startTime, endTime }
            };
          }
          
          // Check for relative time expressions (e.g., "last 2 hours")
          if (startDate && !startDate.match(/^\d{4}-\d{2}-\d{2}/)) {
            const relativeTime = parseRelativeTime(startDate);
            if (relativeTime) {
              const transactions = await getTransactionsByTimeRange(
                this.customerId,
                relativeTime.startTime,
                relativeTime.endTime,
                parameters.transactionType || 'all'
              );
              
              const limit = parameters.limit || 100;
              const limitedTransactions = transactions.slice(0, limit);
              
              return { 
                transactions: limitedTransactions, 
                count: limitedTransactions.length,
                total: transactions.length,
                timeRange: { 
                  startTime: relativeTime.startTime.toISOString(),
                  endTime: relativeTime.endTime.toISOString()
                }
              };
            }
          }
          
          // Handle date-based queries
          // If only one date is provided (e.g., "today"), use it for both start and end
          if (startDate && !endDate) {
            endDate = startDate;
          } else if (endDate && !startDate) {
            startDate = endDate;
          }
          
          // If no dates provided, get all transactions (or last 30 days)
          if (!startDate || !endDate) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            startDate = startDate || thirtyDaysAgo.toISOString().split('T')[0];
            endDate = endDate || new Date().toISOString().split('T')[0];
          }
          
          // Parse natural language dates (e.g., "today", "yesterday")
          if (startDate && !startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parsedStart = parseNaturalDate(startDate, false);
            if (parsedStart) startDate = parsedStart;
          }
          if (endDate && !endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parsedEnd = parseNaturalDate(endDate, true);
            if (parsedEnd) endDate = parsedEnd;
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
          
          // If only one date is provided (e.g., "today"), use it for both start and end
          if (billStartDate && !billEndDate) {
            billEndDate = billStartDate;
          } else if (billEndDate && !billStartDate) {
            billStartDate = billEndDate;
          }
          
          // If no dates provided, get all bill payments (or last 30 days)
          // Use UTC dates to match database timezone
          if (!billStartDate || !billEndDate) {
            const now = new Date();
            const thirtyDaysAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30));
            const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            billStartDate = billStartDate || thirtyDaysAgo.toISOString().split('T')[0];
            billEndDate = billEndDate || today.toISOString().split('T')[0];
          }
          
          // Parse natural language dates (e.g., "today", "yesterday")
          if (billStartDate && !billStartDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parsedStart = parseNaturalDate(billStartDate, false);
            if (parsedStart) billStartDate = parsedStart;
          }
          if (billEndDate && !billEndDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const parsedEnd = parseNaturalDate(billEndDate, true);
            if (parsedEnd) billEndDate = parsedEnd;
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

        case 'get_last_bill_payment':
          const lastBillPayment = await getLastBillPayment(this.customerId, parameters.paymentType || null);
          return { billPayment: lastBillPayment, found: !!lastBillPayment };

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
        return await this.handleQueryBillPayments(parameters, originalMessage);

      case 'buy_airtime':
        // buy_airtime should be handled by the message endpoint directly, not here
        // If it reaches here, it's a fallback - return a helpful message
        return {
          response: "I understand you want to buy airtime. Please use a command like 'buy 1000 airtime to 07016409616' or 'buy airtime for me'.",
          action: null,
        };

      case 'make_transfer':
        return await this.handleMakeTransfer(parameters, originalMessage);

      case 'check_balance':
        return await this.handleCheckBalance();

      case 'get_account_number':
        return await this.handleGetAccountNumber();

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

    // Check for relative time expressions (e.g., "last 2 hours", "last 30 minutes")
    if (startDate && !startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const relativeTime = parseRelativeTime(startDate);
      if (relativeTime) {
        // Handle time-based query
        const transactions = await getTransactionsByTimeRange(
          this.customerId,
          relativeTime.startTime,
          relativeTime.endTime,
          transactionType || 'all'
        );

        if (transactions.length === 0) {
          const typeText = transactionType && transactionType !== 'all' ? transactionType : '';
          const response = `You don't have any ${typeText ? typeText + ' ' : ''}transactions in the last period.`;
          this.conversationHistory.push({ role: 'assistant', content: response });
          return { response, action: null };
        }

        // Calculate totals
        const totalSpent = transactions
          .filter(t => t.transactionType === 'debit')
          .reduce((sum, t) => sum + (t.amount || 0), 0);
        
        const totalReceived = transactions
          .filter(t => t.transactionType === 'credit')
          .reduce((sum, t) => sum + (t.amount || 0), 0);

        let response = `I found ${transactions.length} transaction(s) in the last period.`;
        
        if (totalSpent > 0 || totalReceived > 0) {
          const parts = [];
          if (totalSpent > 0) {
            parts.push(`Total spent: ₦${totalSpent.toLocaleString()}`);
          }
          if (totalReceived > 0) {
            parts.push(`Total received: ₦${totalReceived.toLocaleString()}`);
          }
          if (parts.length > 0) {
            response += ` ${parts.join('. ')}.`;
          }
        }
        
        this.conversationHistory.push({ role: 'assistant', content: response });
        return { response, action: null, data: { transactions, totalSpent, totalReceived } };
      }
    }

    // Parse natural language dates
    if (startDate && !startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      startDate = parseNaturalDate(startDate, false);
    }
    if (endDate && !endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      endDate = parseNaturalDate(endDate, true);
    }

    // If no dates provided, get all transactions (user wants all transactions without date range)
    if (!startDate || !endDate) {
      const limit = 1000; // Get up to 1000 transactions
      const transactions = await getAllTransactions(
        this.customerId,
        transactionType || 'all',
        limit
      );

      if (transactions.length === 0) {
        const response = "You don't have any transactions yet.";
        this.conversationHistory.push({ role: 'assistant', content: response });
        return { response, action: null };
      }

      // Calculate totals
      const totalSpent = transactions
        .filter(t => t.transactionType === 'debit')
        .reduce((sum, t) => sum + (t.amount || 0), 0);
      
      const totalReceived = transactions
        .filter(t => t.transactionType === 'credit')
        .reduce((sum, t) => sum + (t.amount || 0), 0);

      let response = `I found ${transactions.length} transaction(s) in your account.`;
      
      if (totalSpent > 0 || totalReceived > 0) {
        const parts = [];
        if (totalSpent > 0) {
          parts.push(`Total spent: ₦${totalSpent.toLocaleString()}`);
        }
        if (totalReceived > 0) {
          parts.push(`Total received: ₦${totalReceived.toLocaleString()}`);
        }
        if (parts.length > 0) {
          response += ` ${parts.join('. ')}.`;
        }
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null, data: { transactions, totalSpent, totalReceived } };
    }

    const transactions = await getTransactionsByDateRange(
      this.customerId,
      startDate,
      endDate,
      transactionType || 'all'
    );

    if (transactions.length === 0) {
      const typeText = transactionType && transactionType !== 'all' ? transactionType : '';
      const response = `You don't have any ${typeText ? typeText + ' ' : ''}transactions between ${startDate} and ${endDate}.`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    // Calculate total spent (sum of debit transactions)
    const totalSpent = transactions
      .filter(t => t.transactionType === 'debit')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    // Calculate total received (sum of credit transactions)
    const totalReceived = transactions
      .filter(t => t.transactionType === 'credit')
      .reduce((sum, t) => sum + (t.amount || 0), 0);

    // Format date range for display
    const dateRangeText = startDate === endDate ? `on ${startDate}` : `between ${startDate} and ${endDate}`;
    let response = `I found ${transactions.length} transaction(s) ${dateRangeText}.`;
    
    // Add spending summary if relevant
    if (totalSpent > 0 || totalReceived > 0) {
      const parts = [];
      if (totalSpent > 0) {
        parts.push(`Total spent: ₦${totalSpent.toLocaleString()}`);
      }
      if (totalReceived > 0) {
        parts.push(`Total received: ₦${totalReceived.toLocaleString()}`);
      }
      if (parts.length > 0) {
        response += ` ${parts.join('. ')}.`;
      }
    }
    
    this.conversationHistory.push({ role: 'assistant', content: response });
    return { response, action: null, data: { transactions, totalSpent, totalReceived } };
  }

  /**
   * Handle bill payment queries (airtime, data, cable, internet, electricity)
   */
  async handleQueryBillPayments(parameters, originalMessage = '') {
    let { startDate, endDate, transactionType } = parameters;
    
    // Check if this is a "last" or "most recent" query
    const lastKeywords = /\b(last|most recent|recent|latest|previous)\b/i;
    const isLastQuery = lastKeywords.test(originalMessage) && (!startDate && !endDate);
    
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
    
    // If payment type not in parameters, try to extract from original message
    if (!paymentType && originalMessage) {
      const messageLower = originalMessage.toLowerCase();
      const paymentTypeKeywords = {
        'airtime': /\b(airtime|air time)\b/i,
        'data': /\b(data|internet data|mobile data)\b/i,
        'cable': /\b(cable|cable tv|dstv|gotv|startimes)\b/i,
        'internet': /\b(internet|broadband)\b/i,
        'electricity': /\b(electricity|electric|power|prepaid|postpaid)\b/i,
      };
      
      for (const [type, regex] of Object.entries(paymentTypeKeywords)) {
        if (regex.test(originalMessage)) {
          paymentType = type;
          break;
        }
      }
    }

    // If this is a "last" query, use getLastBillPayment instead
    if (isLastQuery) {
      const lastBillPayment = await getLastBillPayment(this.customerId, paymentType);
      
      if (!lastBillPayment) {
        const typeText = paymentType ? paymentType : 'bill payment';
        const response = `You don't have any ${typeText} records.`;
        this.conversationHistory.push({ role: 'assistant', content: response });
        return { response, action: null };
      }

      // Format response with details
      const date = new Date(lastBillPayment.payment_date).toLocaleDateString('en-NG');
      const time = new Date(lastBillPayment.payment_date).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
      let response = `Your last ${paymentType || 'bill payment'} was on ${date} at ${time}. `;
      response += `Amount: ₦${lastBillPayment.amount.toLocaleString()}. `;
      
      if (lastBillPayment.phone_number) {
        response += `Phone number: ${lastBillPayment.phone_number}. `;
      }
      if (lastBillPayment.provider) {
        response += `Provider: ${lastBillPayment.provider}. `;
      }
      if (lastBillPayment.status) {
        response += `Status: ${lastBillPayment.status}.`;
      }
      
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null, data: { billPayment: lastBillPayment } };
    }

    // Parse natural language dates
    if (startDate && !startDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const parsedStart = parseNaturalDate(startDate, false);
      if (parsedStart) {
        startDate = parsedStart;
      }
    }
    if (endDate && !endDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      const parsedEnd = parseNaturalDate(endDate, true);
      if (parsedEnd) {
        endDate = parsedEnd;
      }
    }

    // If no dates provided, default to current year (use UTC)
    if (!startDate || !endDate) {
      const now = new Date();
      const currentYear = now.getUTCFullYear();
      startDate = startDate || `${currentYear}-01-01`;
      endDate = endDate || `${currentYear}-12-31`;
    }

    console.log(`[handleQueryBillPayments] Querying bill payments:`);
    console.log(`  - customerId: ${this.customerId}`);
    console.log(`  - startDate: ${startDate}`);
    console.log(`  - endDate: ${endDate}`);
    console.log(`  - paymentType: ${paymentType || 'all'}`);
    console.log(`  - originalMessage: ${originalMessage}`);

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

    const balanceText = accounts.map(acc => {
      const normalizedAccountNumber = normalizeAccountNumber(acc.accountNumber) || acc.accountNumber;
      return `Account ${normalizedAccountNumber}: ₦${acc.balance.toLocaleString()} ${acc.currency}`;
    }).join('\n');

    const response = `Your account balance(s):\n${balanceText}`;
    this.conversationHistory.push({ role: 'assistant', content: response });
    return { response, action: null, data: { accounts } };
  }

  /**
   * Handle account number query
   */
  async handleGetAccountNumber() {
    const customer = await getCustomerById(this.customerId);

    if (!customer) {
      const response = "I couldn't find your account information.";
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    // Get all accounts for the customer
    const accounts = await getAccountBalance(this.customerId);

    if (accounts.length === 0) {
      const response = "You don't have any active accounts.";
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null };
    }

    // Format account numbers - normalize to remove spaces
    if (accounts.length === 1) {
      const normalizedAccountNumber = normalizeAccountNumber(accounts[0].accountNumber) || accounts[0].accountNumber;
      const response = `Your account number is ${normalizedAccountNumber}.`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null, data: { accountNumber: normalizedAccountNumber } };
    } else {
      const normalizedAccountNumbers = accounts.map(acc => normalizeAccountNumber(acc.accountNumber) || acc.accountNumber);
      const accountNumbersText = normalizedAccountNumbers.join(', ');
      const response = `You have ${accounts.length} accounts. Your account numbers are: ${accountNumbersText}.`;
      this.conversationHistory.push({ role: 'assistant', content: response });
      return { response, action: null, data: { accountNumbers: normalizedAccountNumbers } };
    }
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

