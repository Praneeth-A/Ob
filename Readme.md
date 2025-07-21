# ReachInbox

ReachInbox is a full-stack email analytics and automation platform. It features a backend service for syncing, categorizing, and searching emails, and a frontend dashboard for visualizing email statistics and managing your inbox.

## Project Structure

```
ReachInbox.code-workspace
backend/
  ├── src/
  ├── data/
  ├── .env
  ├── docker-compose.yml
  ├── package.json
  └── tsconfig.json
frontend/
  ├── src/
  ├── public/
  ├── package.json
  └── tsconfig.json
```

## Backend

- **Tech Stack:** Node.js, TypeScript, Express, Elasticsearch, ChromaDB, Gemini AI
- **Features:**
  - IMAP email sync and categorization
  - AI-powered email classification (Gemini)
  - Search and filter emails (Elasticsearch)
  - Suggested replies (RAG with ChromaDB & Gemini)
  - Slack and webhook notifications

### Setup

1. Copy `backend/.env` and fill in your email, Elasticsearch, ChromaDB, and API keys.
2. Start dependencies:
   ```sh
   docker-compose up -d
   ```
3. Build and run backend:
   ```sh
   npm install
   npm run build
   npm start
   ```
   Or for development:
   ```sh
   npm run dev
   ```

## Frontend

- **Tech Stack:** React, TypeScript, Chakra UI, Recharts
- **Features:**
  - Dashboard with email analytics
  - Inbox with filters and AI categorization
  - Email detail modal with recategorization

### Setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Start frontend:
   ```sh
   npm start
   ```
   The app runs on [http://localhost:3021](http://localhost:3021) by default.

## Usage

- Access the dashboard and inbox via the frontend.
- Backend API endpoints:
  - `/emails/search` — Search emails
  - `/emails/stats` — Get statistics
  - `/emails/:id/categorize` — Recategorize email
  - `/emails/:id/suggest-reply` — Get AI suggested reply

## Development

- TypeScript is used throughout.
- See [backend/src/services](backend/src/services) for core backend logic.
- See [frontend/src/pages](frontend/src/pages) and [frontend/src/components](frontend/src/components) for UI.

## License

MIT

---

For more details, see the code and comments in each