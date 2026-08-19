# Padel Championship Manager

A web app to organize amateur padel championships with friends without relying on spreadsheets or notes in WhatsApp groups.

It is designed for groups that play recurring matchdays throughout the season with rotating pairs and an individual leaderboard.

---

## How It Works

- **Individual Ranking in a Doubles Sport**: Players rotate partners each matchday, and the leaderboard tracks individual performance across the season.
- **Automated Pair Generation**: When opening a matchday, the app checks attendance (8, 10, or 12 players) and creates balanced pairs while avoiding recent teammate repetitions.
- **Match Results & Standings**: Enter scores in a few taps. The leaderboard recalculates points, games, sets, and head-to-head records immediately.
- **Custom League Rules**: Configurable point distribution by finish position, drop rules (e.g. discard each player's worst 2 matchdays), and automatic seeding for an end-of-season Masters tournament.
- **Guest Players & Invitations**: Add temporary guest players for a matchday and promote them to regular squad seats later using invite links.
- **Multi-Discipline Support**: Manage 2v2 doubles and 1v1 singles within the same tournament.

---

## Tech Stack

- **Frontend**: Next.js 15 (App Router, Server Actions), React 19, Tailwind CSS
- **Database & Auth**: PostgreSQL 17 via Supabase (Auth, RLS policies, SQL migrations)
- **Language**: TypeScript
- **Testing**: Vitest (Unit & Integration tests)

---

## Project Structure

- **`core/`**: Pure domain logic (pair generator, standings, tiebreak snapshots, Masters seeding). Written as pure TypeScript functions with zero external dependencies and 500+ unit tests.
- **`db/`**: Data access layer, Supabase client configuration, and SQL query helpers.
- **`supabase/migrations/`**: 37 SQL migrations managing schema, triggers, and Row-Level Security (RLS) policies.
- **`app/`**: Next.js pages, layouts, and Server Actions for tournament flows, matchday scoring, and player management.

---

## Running Locally

### Prerequisites
- Node.js 20+
- Docker (required for Supabase CLI)

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env.local
```

### 3. Start local database
```bash
# Start PostgreSQL, Auth, and Supabase Studio
npm run db:start

# Apply migrations and load local seed data
npm run db:reset
```

### 4. Start the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Testing

```bash
# Run unit tests (domain logic and UI states)
npm test

# Run database integration tests (against local Supabase)
npm run test:db

# Run TypeScript type check
npm run typecheck
```

---

## License

MIT
