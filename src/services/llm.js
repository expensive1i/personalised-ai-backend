const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize LLM clients
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
const claudeModel = 'claude-sonnet-4-20250514';

/**
 * Nigerian Banking Context
 */
const BANKING_CONTEXT = `
Nigerian Banking Context:
- Currency: Naira (₦)
- Common transactions: airtime, data, transfers, bills
- Users may use informal language, pidgin, or code-switching
- Date formats: DD/MM/YYYY, natural language like "last week", "15-18 June 2025", "today", "yesterday", "last month"
- Common names often have multiple matches (Mohammed, Ibrahim, Chinedu, etc.)
- Transaction types: debit, credit, airtime, transfer, bill payment
- Phone numbers: Can be in various formats (08012345678, 080 1234 5678, +234 801 234 5678, 080-123-4567)
  * Always normalize phone numbers by removing spaces, dashes, and converting +234 to 0
  * Nigerian phone numbers are 11 digits starting with 0 (e.g., 08012345678)
  * Common prefixes: 070, 080, 081, 090, 091
- Account numbers: Can be in various formats (1234567890, 1234 5678 90, 1234-5678-90)
  * Always normalize account numbers by removing spaces, dashes, and other special characters
  * Nigerian bank account numbers are typically 10 digits (e.g., 1234567890)
  * Extract and normalize account numbers before using them in transfers
- Amounts: Can be written as "1000", "1,000", "1000 naira", "one thousand naira"
- Be flexible with phrasings: "send money" = "transfer", "buy airtime" = "purchase airtime", "check balance" = "what's my balance"
`;

/**
 * Extract intent and parameters using Gemini (fast, good for varied formats)
 */
async function extractIntentWithGemini(userMessage, conversationHistory = []) {
  const currentDate = new Date().toISOString().split('T')[0];

  const prompt = `${BANKING_CONTEXT}

Current Date: ${currentDate}

Conversation History:
${JSON.stringify(conversationHistory.slice(-5), null, 2)}

User Message: "${userMessage}"

CRITICAL INSTRUCTIONS:
1. UNDERSTAND THE USER'S INTENT - Be flexible and understand various phrasings:
   - "send money" = "make_transfer"
   - "transfer funds" = "make_transfer"
   - "move money" = "internal_transfer"
   - "buy airtime" = "buy_airtime" (PURCHASE action)
   - "show airtime" = "query_bill_payment" (QUERY action)
   - "check balance" = "check_balance" (for account BALANCE - the amount of money, e.g., ₦50,000)
   - "what's my balance" = "check_balance" (for account BALANCE - the amount of money)
   - "how much money" = "check_balance" (for account BALANCE - the amount of money)
   - "account balance" = "check_balance" (for account BALANCE - the amount of money)
   - "what's my account number" = "get_account_number" (for account NUMBER - the 10-digit identifier like "1234567890")
   - "my account number" = "get_account_number" (for account NUMBER - the 10-digit identifier)
   - "account number" = "get_account_number" (for account NUMBER - the 10-digit identifier, NOT the balance)
   - "what account number do I have" = "get_account_number" (for account NUMBER)
   - "how much did I spend" = "query_transaction"
   - "all my transactions" = "query_transaction" (NO date range needed - set startDate/endDate to null)
   - "just search all my transaction" = "query_transaction" (NO date range needed - set startDate/endDate to null)
   - "show everything" = "query_transaction" (NO date range needed - set startDate/endDate to null)
   - "no date needed" = "query_transaction" (NO date range needed - set startDate/endDate to null)
   - "all transactions" = "query_transaction" (NO date range needed - set startDate/endDate to null)
   - "last transaction" = "get_last_transaction"
   - "last airtime purchase" = "query_bill_payment" with "last" keyword
   - "what phone number did I last buy airtime for" = "query_bill_payment" (query about last purchase)
   - "who did I last send airtime to" = "query_bill_payment" (query about last purchase)
   - "phone number from my last airtime" = "query_bill_payment" (query about last purchase)
   - "last airtime I transferred" = "query_bill_payment" (query about last purchase - "transfer" here means purchase/sent)

2. PHONE NUMBER HANDLING - Extract and normalize phone numbers:
   - Phone numbers from voice commands may contain various symbols, dashes, spaces, and transcription errors
   - Handle formats like: "080 1234 5678", "080-123-4567", "+234 801 234 5678", "08012345678"
   - Voice-to-text may produce: "oh eight oh" (for "080"), "one two three" (for "123"), etc.
   - May contain symbols: dashes (-), spaces, parentheses (), dots (.), plus (+), etc.
   - Remove ALL spaces, dashes, parentheses, dots, and other symbols from phone numbers
   - Convert +234 to 0 (e.g., +234 801 234 5678 → 08012345678)
   - Convert 234 to 0 (e.g., 234 801 234 5678 → 08012345678)
   - Phone numbers should be 11 digits starting with 0
   - ALWAYS normalize phone numbers before using them - the system will handle all edge cases

3. ACCOUNT NUMBER HANDLING - Extract and normalize account numbers:
   - Account numbers from voice commands may contain various symbols, dashes, spaces, and transcription errors
   - Handle formats like: "1234 5678 90", "1234-5678-90", "1234567890"
   - Voice-to-text may produce: "one two three four" (for "1234"), "zero" (for "0"), etc.
   - May contain symbols: dashes (-), spaces, parentheses (), dots (.), etc.
   - Remove ALL spaces, dashes, parentheses, dots, and other symbols from account numbers
   - Nigerian bank account numbers are typically 10 digits
   - Extract and normalize account numbers before using them in transfers
   - ALWAYS normalize account numbers before using them - the system will handle all edge cases

4. AMOUNT EXTRACTION - Be flexible with amount formats:
   - "1000" = 1000
   - "1,000" = 1000
   - "1000 naira" = 1000
   - "one thousand" = 1000 (if clearly stated)
   - Extract the numeric value regardless of formatting

5. DATE HANDLING - Understand various date formats:
   - "today" = current date
   - "yesterday" = yesterday's date
   - "last week" = 7 days ago to today
   - "last month" = 1 month ago to today
   - "15-18 June 2025" = 2025-06-15 to 2025-06-18
   - "last 2 hours" = relative time (use startTime/endTime)
   - Natural language dates should be converted to YYYY-MM-DD format

6. INTENT DISTINCTION - Critical:
   - "buy_airtime" = User wants to PURCHASE/BUY airtime (action verb: buy, purchase, send airtime)
   - "query_bill_payment" = User wants to QUERY/VIEW past purchases (query verbs: show, view, check, how much, when did I)
   - Same for data, cable, internet, electricity
   - If user says "buy" or "purchase" = action intent
   - If user says "show", "view", "check", "how much", "when" = query intent

7. BE COMPREHENSIVE - Understand almost anything:
   - Handle typos and informal language
   - Understand context from conversation history
   - If unclear, set requiresClarification: true
   - If not banking-related, use "general_question" intent

Analyze this message and extract:
1. Intent (query_transaction, query_bill_payment, make_transfer, internal_transfer, buy_airtime, check_balance, get_account_number, get_last_transaction, general_question, unclear)
2. Parameters (dates, amounts, names, transaction types, payment types, phone numbers - NORMALIZED)
3. Confidence (0-1)
4. Whether clarification is needed
5. Is this a banking-related question? (true/false)

Respond ONLY in valid JSON format:
{
    "intent": "query_transaction|query_bill_payment|make_transfer|internal_transfer|buy_airtime|check_balance|get_account_number|get_last_transaction|general_question|unclear",
    "parameters": {
        "startDate": "YYYY-MM-DD or null",
        "endDate": "YYYY-MM-DD or null",
        "startTime": "ISO datetime string or null (for relative time like 'last 2 hours')",
        "endTime": "ISO datetime string or null (for relative time like 'last 2 hours')",
        "transactionType": "airtime|data|cable|internet|electricity|transfer|debit|credit|all|null",
        "paymentType": "airtime|data|cable|internet|electricity|all|null (for bill payments)",
        "amount": number or null,
        "recipientName": "string or null",
        "phoneNumber": "normalized phone number (11 digits starting with 0) or null",
        "accountId": number or null
    },
    "confidence": 0.0-1.0,
    "requiresClarification": true|false,
    "isBankingRelated": true|false,
    "reasoning": "brief explanation of your analysis"
}`;

  try {
    const result = await geminiModel.generateContent(prompt);
    const response = result.response.text();
    
    // Clean JSON response (remove markdown if present)
    const cleanedResponse = response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(cleanedResponse);
    return parsed;
  } catch (error) {
    console.error('Error extracting intent with Gemini:', error);
    return {
      intent: 'unclear',
      parameters: {},
      confidence: 0.3,
      requiresClarification: true,
      reasoning: 'Failed to parse user intent',
    };
  }
}

/**
 * Process complex queries with Claude (better for reasoning and disambiguation)
 */
async function processWithClaude(userMessage, conversationHistory = [], tools = []) {
  const currentDate = new Date().toISOString().split('T')[0];

  const systemPrompt = `${BANKING_CONTEXT}

You are an intelligent, helpful Nigerian banking assistant with comprehensive understanding capabilities. You can:

1. UNDERSTAND ALMOST ANYTHING:
   - Handle informal language, pidgin, code-switching, and various phrasings
   - Understand typos, abbreviations, and casual speech
   - Interpret context from conversation history
   - Handle ambiguous requests gracefully by asking clarifying questions

2. PHONE NUMBER HANDLING:
   - ALWAYS normalize phone numbers before using them in tools or responses
   - Phone numbers from voice commands may contain: symbols (-, +, (), spaces), transcription errors ("oh" for "0", "one" for "1"), and various formats
   - The normalization system handles ALL edge cases automatically - extract phone numbers as-is from messages
   - Remove spaces, dashes, parentheses, dots, and other special characters
   - Convert +234 to 0 (e.g., +234 801 234 5678 → 08012345678)
   - Convert 234 to 0 (e.g., 234 801 234 5678 → 08012345678)
   - Handle voice-to-text errors: "oh eight oh" → "080", "one two three" → "123"
   - Nigerian phone numbers are 11 digits starting with 0
   - The system's normalizePhone function will handle all variations automatically - just extract and pass the phone number

3. ACCOUNT NUMBER HANDLING:
   - ALWAYS normalize account numbers before using them in tools or responses
   - Account numbers from voice commands may contain: symbols (-, +, (), spaces), transcription errors ("one" for "1", "zero" for "0"), and various formats
   - The normalization system handles ALL edge cases automatically - extract account numbers as-is from messages
   - Remove spaces, dashes, parentheses, dots, and other special characters
   - Handle formats like: "1234 5678 90", "1234-5678-90", "1234567890"
   - Handle voice-to-text errors: "one two three four" → "1234", "zero" → "0"
   - Nigerian bank account numbers are typically 10 digits
   - Extract and normalize account numbers before using them in transfers
   - The system's normalizeAccountNumber function will handle all variations automatically - just extract and pass the account number

4. DATE AND TIME HANDLING:
   - Understand natural language dates: "today", "yesterday", "last week", "last month"
   - Handle date ranges: "15-18 June 2025" = 2025-06-15 to 2025-06-18
   - Handle relative time: "last 2 hours", "last 30 minutes", "last 3 days"
   - Use appropriate tools (search_transactions with startTime/endTime for precise time queries)
   - For "last" queries (e.g., "last airtime purchase"), use get_last_bill_payment tool

5. AMOUNT AND CURRENCY:
   - Extract amounts from various formats: "1000", "1,000", "1000 naira", "one thousand"
   - Always format amounts in responses as ₦X,XXX.XX
   - Handle both numeric and written amounts when clear

6. INTENT UNDERSTANDING:
   - "buy airtime" = purchase action (buy_airtime intent)
   - "show airtime" = query action (query_bill_payment intent)
   - "what phone number did I last buy airtime for" = query_bill_payment (use get_last_bill_payment tool)
   - "who did I last send airtime to" = query_bill_payment (use get_last_bill_payment tool)
   - "last airtime I transferred" = query_bill_payment (use get_last_bill_payment tool)
   - "send money" = transfer action (make_transfer intent)
   - "move money to my account" = internal transfer (internal_transfer intent)
   - "check balance" = balance query (check_balance intent) - for MONEY AMOUNT (e.g., ₦50,000)
   - "what's my balance" = balance query (check_balance intent) - for MONEY AMOUNT
   - "how much money" = balance query (check_balance intent) - for MONEY AMOUNT
   - "what's my account number" = account number query (get_account_number intent) - for 10-DIGIT IDENTIFIER (e.g., "1234567890")
   - "my account number" = account number query (get_account_number intent) - for 10-DIGIT IDENTIFIER
   - "account number" = account number query (get_account_number intent) - for 10-DIGIT IDENTIFIER, NOT balance
   - CRITICAL DISTINCTION: "account number" and "account balance" are COMPLETELY DIFFERENT:
     * Account NUMBER = the 10-digit identifier (e.g., "1234567890") - use get_customer_info tool
     * Account BALANCE = the amount of money (e.g., ₦50,000) - use get_account_balance tool
   - "how much did I spend" = transaction query (query_transaction intent)
   - "last transaction" = get last transaction (get_last_transaction intent)

7. TOOL USAGE:
   - For ANY banking-related question, ALWAYS use tools to get accurate information
   - For transactions, balances, transfers, beneficiaries - use appropriate tools
   - For airtime/data/cable/internet/electricity queries - use search_bill_payments (NOT search_transactions)
   - For "all transactions" queries (e.g., "all my transactions", "show everything", "no date needed", "just search all my transaction") - use search_transactions with getAll: true or set startDate/endDate to null
   - For "last" bill payment queries (e.g., "last airtime purchase", "phone number from last airtime", "who did I last send airtime to") - use get_last_bill_payment tool with appropriate paymentType
   - For "last" transaction queries - use get_last_transaction tool
   - For queries asking about phone numbers from last purchases - use get_last_bill_payment tool
   - For time-based queries (hours, minutes) - use search_transactions with startTime/endTime
   - For date-based queries - use search_transactions or search_bill_payments with startDate/endDate
   - Wait for tool results before responding
   - If tool returns no results, provide a helpful, friendly response
   - When user asks "what phone number" or "who did I" about last purchases, use get_last_bill_payment
   - NEVER ask for dates if user explicitly says "all transactions", "no date needed", "show everything" - just get all transactions

8. RESPONSE GUIDELINES:
   - Be conversational, friendly, and helpful
   - Format amounts as ₦X,XXX.XX
   - Format phone numbers clearly (e.g., "0801 234 5678" for readability, but normalize before using)
   - When get_last_bill_payment returns a result, ALWAYS include the phone_number in your response if it's available
   - If user asks "what phone number" or "who did I send airtime to", extract and clearly state the phone_number from the bill payment record
   - Provide comprehensive answers based on tool results
   - If information is not available, explain clearly and suggest alternatives
   - For general banking questions (how to open account, interest rates, etc.) - answer conversationally
   - For non-banking questions - politely redirect to banking topics
   - Never make up information - always use tools for accurate data

9. ERROR HANDLING:
   - If a request is unclear, ask clarifying questions naturally
   - If a phone number is invalid, explain the correct format
   - If dates are ambiguous, ask for clarification
   - Always be helpful and never dismissive

Current date: ${currentDate}

Remember: Your goal is to understand almost anything the user says and provide accurate, helpful responses using the available tools. Be flexible, comprehensive, and always normalize phone numbers before using them.`;

  try {
    const messages = conversationHistory.length > 0 
      ? conversationHistory.map(msg => ({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        }))
      : [];
    
    // Only add user message if it's not empty (empty means we're sending tool results)
    if (userMessage) {
      messages.push({ role: 'user', content: userMessage });
    }

    const response = await anthropic.messages.create({
      model: claudeModel,
      max_tokens: 2048,
      system: systemPrompt,
      tools: tools.length > 0 ? tools : undefined,
      messages,
    });

    return response;
  } catch (error) {
    console.error('Error processing with Claude:', error);
    throw error;
  }
}

/**
 * Parse relative time expressions (e.g., "last 2 hours", "last 30 minutes")
 * Returns an object with { startTime: Date, endTime: Date } or null
 */
function parseRelativeTime(timeString) {
  if (!timeString) return null;

  const now = new Date();
  const timeStr = timeString.toLowerCase().trim();
  
  // Pattern: "last X hours/minutes/days/weeks/months"
  const relativePattern = /last\s+(\d+)\s+(hour|hours|minute|minutes|day|days|week|weeks|month|months|year|years)/i;
  const match = timeStr.match(relativePattern);
  
  if (match) {
    const amount = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    const endTime = new Date(now);
    let startTime = new Date(now);
    
    switch (unit) {
      case 'minute':
      case 'minutes':
        startTime.setMinutes(startTime.getMinutes() - amount);
        break;
      case 'hour':
      case 'hours':
        startTime.setHours(startTime.getHours() - amount);
        break;
      case 'day':
      case 'days':
        startTime.setDate(startTime.getDate() - amount);
        break;
      case 'week':
      case 'weeks':
        startTime.setDate(startTime.getDate() - (amount * 7));
        break;
      case 'month':
      case 'months':
        startTime.setMonth(startTime.getMonth() - amount);
        break;
      case 'year':
      case 'years':
        startTime.setFullYear(startTime.getFullYear() - amount);
        break;
      default:
        return null;
    }
    
    return { startTime, endTime };
  }
  
  return null;
}

/**
 * Format date from natural language
 */
function parseNaturalDate(dateString, isEndDate = false) {
  if (!dateString) return null;

  const today = new Date();
  const dateStr = dateString.toLowerCase().trim();

  // Handle relative dates
  if (dateStr === 'today' || dateStr === 'now') {
    return today.toISOString().split('T')[0];
  }
  
  if (dateStr === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }
  
  if (dateStr === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  }
  
  // Handle relative time expressions (e.g., "last week", "last month")
  if (dateStr.includes('last')) {
    const relativeTime = parseRelativeTime(dateStr);
    if (relativeTime) {
      return relativeTime.startTime.toISOString().split('T')[0];
    }
  }

  // Handle "15-18 June 2025" format
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 2) {
      const firstPart = parts[0].trim();
      const secondPart = parts[1].trim();
      
      // Extract day, month, year
      const dayMatch = firstPart.match(/(\d+)/);
      const monthYearMatch = secondPart.match(/(\w+)\s*(\d+)?/);
      
      if (dayMatch && monthYearMatch) {
        const day = parseInt(dayMatch[1]);
        const monthName = monthYearMatch[1];
        const year = monthYearMatch[2] ? parseInt(monthYearMatch[2]) : today.getFullYear();
        
        const monthMap = {
          january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
          july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
          jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        };
        
        const month = monthMap[monthName.toLowerCase()];
        if (month !== undefined) {
          if (isEndDate) {
            // For end date, use the second day
            const secondDayMatch = secondPart.match(/(\d+)/);
            const endDay = secondDayMatch ? parseInt(secondDayMatch[1]) : day;
            return new Date(year, month, endDay).toISOString().split('T')[0];
          } else {
            return new Date(year, month, day).toISOString().split('T')[0];
          }
        }
      }
    }
  }

  // Handle other formats (simplified - you may want to use a library like chrono-node)
  try {
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    // Fallback
  }

  return null;
}

module.exports = {
  extractIntentWithGemini,
  processWithClaude,
  parseNaturalDate,
  parseRelativeTime,
  geminiModel,
};

