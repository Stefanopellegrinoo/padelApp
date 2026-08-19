# Padel Championship Manager

A full-stack tournament and league management platform designed for rotating-partner racket sports championships (Padel, Tennis, Pickleball, Ping Pong).

Engineered with a **Functional Core, Imperative Shell** architecture using **Next.js 15 (App Router)**, **React 19**, **TypeScript**, and **PostgreSQL** via **Supabase** with comprehensive **Row-Level Security (RLS)**.

---

## Architectural Principles

### 1. Functional Core, Imperative Shell
All championship domain logic—pairing algorithms, standings derivation, drop-score calculations, tiebreak rules, and Masters playoff generation—lives in `core/` as pure, deterministic TypeScript functions without runtime dependencies on Next.js or PostgreSQL.
- **100% deterministic & side-effect free**: Inputs are immutable snapshots; outputs are computed standings and fixture matrices.
- **High test coverage**: 530+ unit tests validate domain edge cases, mathematical fairness, and state transitions.

### 2. Defense-in-Depth & Database Invariants
Data integrity is enforced at the database level via PostgreSQL constraints, triggers, and granular Row-Level Security (RLS) policies across 37 versioned migrations:
- **Strict Role Isolation**: Separate privilege scopes for `anon`, `authenticated`, and `service_role`.
- **Security Definer Functions**: Complex transactional operations (seat claiming, guest promotions, matchday settlements) execute via validated stored procedures to prevent race conditions.
- **Safe Environment Guardrails**: Test harnesses strictly verify local database execution targets (`127.0.0.1` / `localhost`) before running destructive operations.

### 3. Modern React 19 & Next.js 15 App Router
- **Server Actions with Optimistic Updates**: Form mutations and tournament actions leverage Next.js Server Actions with immediate UI feedback and rollback capabilities.
- **Route Handlers & Secure Redirects**: OAuth callbacks and invitation links implement path normalization and open-redirect protections.
- **Tailwind CSS v4**: High-performance, token-driven responsive design tailored for mobile-first league management.

---

## Core Domain Capabilities

- **Rotating Pairs & Fair Pairing Engine**: Balances matchday fixtures to minimize repeat pairings across a season while adapting to variable attendance (8, 10, or 12 players).
- **Cumulative Standings & Drop Rules**: Computes season leaderboards with configurable "Best of N" matchday rules (discarding a player's worst results).
- **Tiebreak Snapshots**: Freezes periodic ranking snapshots to ensure deterministic tiebreaking across changing matchday contexts.
- **Multi-Discipline Engine**: Supports both 2v2 doubles and 1v1 singles disciplines within the same tournament structure, with configurable scoring systems (sets, tiebreaks, or open score formats).
- **Masters Tournament Bracket Generation**: Automatically seeds and generates the season-ending championship bracket from qualified leaderboard players.
- **Guest Management & Seat Claiming**: Handles substitute guest players and seamless promotion to official roster seats via secure invitation tokens.

---

## Project Structure

```
padelApp/
├── app/                  # Next.js 15 App Router (Pages, Layouts, Server Actions)
│   ├── auth/             # Authentication callbacks and redirect guards
│   ├── login/            # Sign-in and password recovery interfaces
│   ├── registro/         # User registration flows
│   ├── torneo/[id]/      # Tournament views: standings, matchdays, settings, rules
│   ├── torneos/          # Dashboard and tournament creation wizard
│   └── unirse/[token]/   # Token-based squad invitation landing
├── core/                 # Pure domain logic (Standings, Pairing, Awards, Masters)
├── db/                   # Database data access layer, Supabase clients & RPC wrappers
├── supabase/             # Local database configuration, seed data & migrations
│   ├── migrations/       # 37 SQL migrations with RLS, triggers & functions
│   └── seed.sql          # Local development seed fixtures
└── scripts/              # Automated smoke tests and UX latency measurement tools
```

---

## Tech Stack

- **Frontend**: Next.js 15.5 (App Router, Server Components, Server Actions), React 19, Tailwind CSS v4
- **Backend / Database**: PostgreSQL 17, Supabase (Auth, RLS, Storage)
- **Languages / Runtime**: TypeScript 5, Node.js 20+
- **Testing**: Vitest 3, Playwright (Smoke & UX latency scripts)
- **Deployment**: Vercel (Frontend), Supabase Cloud (Database & Auth)

---

## Getting Started

### Prerequisites
- **Node.js**: `v20.x` or higher
- **npm**: `v10.x` or higher
- **Docker**: Required to run the local Supabase stack via Supabase CLI

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Stefanopellegrinoo/padelApp.git
cd padelApp
npm install
```

### 2. Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env.local
```

The default values in `.env.example` point to the local Supabase instance:
```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

### 3. Start Local Supabase Stack
```bash
# Start PostgreSQL, Auth, and Studio containers
npm run db:start

# Apply all migrations and load seed data
npm run db:reset
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) with your browser.

---

## Quality Assurance & Testing

### Unit Tests (Pure Core & UI State)
Runs 530+ unit tests across the domain engine and UI state machines:
```bash
npm test
```

### Database Integration Tests
Executes integration suites against real PostgreSQL tables, verifying constraints, triggers, and RLS policies:
```bash
npm run test:db
```

### TypeScript Validation
```bash
npm run typecheck
```

### Production Build
```bash
npm run build
```

---

## License

This project is licensed under the [MIT License](LICENSE).
