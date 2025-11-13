# Natural Language Banking Backend

Comprehensive technical brief for the conversational banking backend so you can explain design choices, defend implementation decisions, and onboard teammates quickly.

---

## 1. Product Overview

- **Goal**: Allow Nigerian retail banking customers to interact with their accounts using natural language (text or voice) for queries, transfers, airtime purchases, and account management.
- **Interface**: HTTP API (Express 5) exposed to client apps with automatically generated Swagger docs (`/api-docs`).
- **Core Idea**: Combine fast intent extraction (Gemini) with deeper reasoning and tool orchestration (Claude) to translate layman requests into deterministic banking actions backed by Prisma + PostgreSQL.

## 2. Supported Customer Journeys

- Ask for balances, recent transactions, or spend summaries in natural language.
- Initiate transfers (external, internal, manual by account number) with follow-up PIN verification.
- Purchase airtime and other bill payments (data, cable, internet, electricity) via eBills integration.
- Verify bank account numbers using Paystack before manual transfers.
- Register customers, create additional accounts, manage beneficiaries, and set/verify PINs.
- Unified `/api/message` endpoint powers voice assistant scenarios with context-aware follow-ups.

## 3. Technology Stack

- **Runtime & Framework**: Node.js 18+, Express 5.x.
- **ORM & Database**: Prisma 6.x with PostgreSQL (BigInt IDs, Decimal amounts).
- **AI/LLM**: Google Gemini (`@google/generative-ai`) for intent extraction, Anthropic Claude (`@anthropic-ai/sdk`) for reasoning and tool orchestration.
- **Security & Auth**: Phone number based customer lookup (`authenticateByPhone`), `bcryptjs` for PIN hashing.
- **External Integrations**: Paystack (account verification), eBills (airtime/bill payments).
- **Tooling**: Swagger UI (`swagger-jsdoc`, `swagger-ui-express`), `dotenv` for config, `axios` for HTTP clients.

## 4. High-Level Architecture

```
Client (web/mobile/voice)
        │
        ▼
    Express 5 app (`src/app.js`)
        │
        ├── Middleware: JSON parsing, `authenticateByPhone`
        │
        ├── Route Modules (`src/routes/*`)
        │       ├── LLM-driven flows (`queryAi`, `message`)
        │       ├── Traditional REST endpoints (accounts, transfer, pin, etc.)
        │       └── Swagger annotations
        │
        ├── Service Layer
        │       ├── `services/llm.js` (Gemini + Claude orchestration)
        │       ├── `services/conversationManager.js` (multi-turn dialogue state)
        │       ├── `services/database.js` (Prisma accessors & write workflows)
        │       ├── `services/pendingTransactions.js` (in-memory pending state)
        │       └── Integration clients (`services/ebills.js`, `services/bankVerification.js`)
        │
        └── PostgreSQL via Prisma Client
```

### Request Lifecycle (LLM-enabled):
1. Request hits `/api/query-ai` or `/api/message` with `phoneNumber` + message.
2. `authenticateByPhone` finds the customer and attaches `req.customerId`.
3. `ConversationManager` checks for pending actions, otherwise calls Gemini for intent extraction.
4. Low-confidence or complex cases escalate to Claude, which uses registered tools to query Prisma resolvers.
5. Deterministic services execute DB queries/commands; responses formatted in conversational Naira-friendly text.
6. For money-movement intents, a pending transaction token is issued and `/api/verify-transaction` completes it after PIN verification.

### Request Lifecycle (Traditional REST):
- Endpoints such as `/api/create-account`, `/api/buy-airtime`, `/api/manual-transfer` perform validation, lookups, and call service functions directly (bypassing LLM).

## 5. API Surface (Highlights)

| Group | Endpoint | Purpose |
| ----- | -------- | ------- |
| General | `GET /` | Service metadata and route catalog. |
| Health | `GET /health` | Liveness probe. |
| Docs | `GET /api-docs` | Swagger UI with try-it-out (auto URL patching for hosted deployments). |
| AI | `POST /api/query-ai` | Self-service NL queries for transactions/balances/transfers. |
| Voice | `POST /api/message` | Unified voice assistant entry with intent routing and follow-ups. |
| Chat (legacy) | `/api/chat/*` | Backwards-compatible chat endpoints (session-based). |
| Registration | `POST /api/register-account` | Create customer + default account. |
| Accounts | `POST /api/create-account`, `GET /api/list-accounts`, `GET /api/balance` | Account lifecycle and balance retrieval. |
| Transfers | `POST /api/transfer`, `POST /api/internal-transfer`, `POST /api/manual-transfer` | Natural language, own-account, and manual transfers. |
| Transaction Finalization | `POST /api/verify-transaction` | Verify PIN + execute pending transfer/airtime actions. |
| Airtime/Bills | `POST /api/buy-airtime`, plus bill payment intents via message flow. |
| PIN | `POST /api/set-pin`, `POST /api/verify-pin` | PIN management (hashed at rest). |
| Utilities | `POST /api/account-verification` (Paystack), `POST /api/load-money`, `POST /api/message` unified pipeline. |

Swagger annotations inside each route keep the docs self-updating.

## 6. Key Modules & Implementation Notes

- **`src/app.js`**: Configures Express, JSON/body parsing, Swagger generation (with dynamic base URL fix), centralizes route mounting, 404 + error handlers.
- **Authentication (`src/middleware/auth.js`)**: Accepts phone number via body, header `x-phone-number`, or query string. Fails fast with friendly instructions, normalizes format, fetches customer from Prisma.
- **Conversation Manager (`src/services/conversationManager.js`)**:
  - Maintains per-customer conversation history in memory (Map) for contextual replies.
  - Handles partial workflows (beneficiary/account selection, transfer confirmation) before final execution.
  - Executes deterministic tools: transaction/bill queries, balance checks, beneficiary search, etc.
  - Fallback to Claude if Gemini confidence < 0.7 or clarification required.
- **LLM Service (`src/services/llm.js`)**:
  - Provides Nigerian banking context prompts.
  - Gemini: fast JSON intent parser, returns structured parameters.
  - Claude: deeper reasoning + tool-calling API; bound to internal resolvers ensuring no hallucinated data.
- **Data Service (`src/services/database.js`)**:
  - Lazy Prisma initialization with resilience (continues boot even if DB temporarily unavailable).
  - Read helpers convert `BigInt`/`Decimal` for JSON.
  - Transfer workflow uses Prisma transactions to ensure atomic debit/credit entries.
  - Generates unique account numbers, manages customer + account creation.
- **Pending Transactions (`src/services/pendingTransactions.js`)**:
  - Stores short-lived intents before PIN verification. In production, swap to Redis or other TTL cache to avoid multi-instance issues.
- **External Clients**:
  - `services/bankVerification.js`: Paystack API to validate Nigerian bank accounts.
  - `services/ebills.js`: Handles airtime/bill purchase execution.
  - Both use `axios` with environment-configured credentials.
- **Routes**: Organized per domain (`transfer.js`, `internalTransfer.js`, `buyAirtime.js`, `loadMoney.js`, `pin.js`, etc.), each with validation, error handling, and swagger docs.

## 7. Data Model (Prisma)

Primary models within `prisma/schema.prisma`:

- `Customer`: Identity, phone, hashed PIN, bank info.
- `Account`: Customer-linked accounts, balance (Decimal), currency (default `NGN`).
- `Transaction`: Debit/credit ledger with references, statuses, before/after balances.
- `Beneficiary`: Saved recipients with transfer counts for ranking.
- `bill_payments`: Airtime & bill purchase history mapped to accounts.
- `AccountHistory`, `Document` (for RAG/voice guidance), plus supporting enums and indexes.

Design choices:
- Consistent use of `BigInt` IDs for compatibility with PostgreSQL `BIGSERIAL`.
- `deletedAt` soft deletes across tables; queries always filter `deletedAt: null`.
- Indices on phone numbers/account numbers to support authentication & lookups.

## 8. Configuration & Secrets

Environment variables (see `env.txt` / `.env.example`):

- `DATABASE_URL`: PostgreSQL connection string (requires `schema=public`).
- `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`: LLM credentials.
- `PAYSTACK_SECRET_KEY`, `PAYSTACK_API_URL`: Account verification.
- `EBILLS_USERNAME`, `EBILLS_PASSWORD`: Airtime/bill gateway.
- `PORT`, `NODE_ENV`, `API_URL`: Server options.

**Recommendations**:
- Use `.env` locally; set secrets via platform-specific secret managers in production.
- Protect API keys; rotate regularly and ensure outbound IP allow-lists for third-party services.

## 9. Setup & Operations

1. **Prerequisites**: Node.js ≥ 18, npm, PostgreSQL instance.
2. **Install deps**: `npm install`.
3. **Generate Prisma client**: `npx prisma generate`.
4. **Migrations** (when schema files change): `npx prisma migrate dev`.
5. **Seed data** (optional sample data): `npm run seed`.
6. **Run locally**: `npm run dev` (uses `server.js` entry to start Express).
7. **Environment**: create `.env` from template, set all required keys before start.
8. **Docs**: Visit `http://localhost:3000/api-docs` after boot.

Deployment considerations:
- Ensure `API_URL` reflects public domain so Swagger generates correct base URLs.
- Replace in-memory maps (`conversations`, `pendingTransactions`) with Redis or another shared cache in multi-instance deployments.
- Monitor database connection logs (Prisma logs queries/warnings in development mode).

## 10. Security Model & Controls

- **Authentication**: Phone-number based lookup (acts as implicit user session for demos). For production, layer JWT or session tokens on top.
- **Authorization**: Scopes all Prisma queries by `customerId`; no cross-customer data access.
- **PIN Handling**: Stored hashed with `bcryptjs`. `verify-transaction` requires PIN before executing money-moving actions. Input sanitized and compared using constant-time `bcrypt.compare`.
- **Input Validation**: Each route validates required fields and types, returns descriptive 4xx errors.
- **Error Handling**: Central Express error middleware returns generic messages while logging stack traces server-side.
- **Audit**: `Transaction` entries capture before/after balances and references for reconciliation.
- **Secrets**: Only loaded through environment variables; no hard-coded credentials.

## 11. LLM Strategy Rationale

- **Hybrid approach**:
  - Gemini for deterministic JSON intent extraction (cheap + fast).
  - Claude for complex queries, disambiguation, or when Gemini returns low confidence.
- **Function-calling workflow**:
  - Claude is configured with a curated toolset (`search_transactions`, `search_bill_payments`, `get_last_transaction`, `search_beneficiaries`, `get_account_balance`, `get_customer_info`) inside `services/conversationManager.js`.
  - When Gemini confidence is low or clarification is needed, `processWithClaude` (in `services/llm.js`) lets Claude request one or more of these tools.
  - Each tool call is executed server-side via deterministic Prisma helpers (`services/database.js`), and the JSON results are passed back to Claude to compose a natural-language answer.
  - Pending state (e.g., beneficiary selection, transfer confirmation) is tracked in `ConversationManager` so follow-up messages can reuse previous tool outputs without re-querying unnecessarily.
- **Tool-based safeguarding**:
  - Claude can only access structured data via whitelisted tool calls (transaction search, bill search, balance fetch).
  - Prevents hallucinations while keeping conversational tone.
- **Banking context prompt** ensures the assistant interprets Nigerian idioms, pidgin English, and local banking terminology correctly.
- **Conversation memory**: Maintains context per customer enabling multi-turn dialogues and follow-up questions (e.g., beneficiary selection).

## 12. Observability & Support

- **Logging**: Console logging for errors (including Prisma initialization failures). Prisma client logs queries/warnings when `NODE_ENV=development`.
- **Swagger UI**: Serves as living documentation and manual testing harness.
- **Health Check**: `/health` for uptime monitors (returns status + timestamp).
- **Future Enhancements**:
  - Add structured logging (Winston/Pino) with request IDs.
  - Persist conversation history and pending transactions to Redis or database.
  - Implement metrics (Prometheus) and tracing for LLM latency monitoring.

## 13. Testing Strategy (Current & Planned)

- **Current**: Manual flows via Swagger/cURL; depends on seeded data for quick demos.
- **Next Steps**:
  - Add unit tests for service layer (Prisma query mocks, pending transaction logic).
  - Contract tests for `services/llm.js` prompts to guard against model regressions.
  - Integration tests using Prisma test schema + transactional rollbacks.

## 14. Operational Risks & Mitigations

- **In-memory state**: `conversations` and `pendingTransactions` maps are single-instance only; must migrate to shared cache before scaling horizontally.
- **LLM dependency**: Requires Gemini & Claude API availability. Implement retries and graceful degradations for outages.
- **Rate limits**: Use external rate limiting (API gateway) to protect third-party services and LLM quotas.
- **Data privacy**: Review prompts + logs to avoid leaking sensitive PII. Mask account numbers in logs where possible.
- **Airtime/bill payments**: Currently partial implementations; ensure error handling + receipt logging are production-ready.

## 15. Quick Talking Points for Leadership

- **Customer impact**: Enables natural language self-service banking with contextual follow-ups.
- **Safety**: Phone-based scoping + mandatory PIN verification before funds move; deterministic data access via Prisma.
- **Maintainability**: Clear separation between API layer, service logic, LLM orchestration, and integrations; Prisma provides schema-driven safety.
- **Extensibility**: Adding new intents = add Prisma resolver + register as Claude tool; minimal routing changes.
- **Deployment readiness**: Works locally with `.env`, health checks, and Swagger docs; only blockers for scale are shared state storage and automated testing.

Armed with this document, you can walk leadership through the architecture, justify design choices, and highlight the roadmap for production hardening.


