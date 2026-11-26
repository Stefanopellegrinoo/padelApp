# Design system — Padel Liga (current)

Captured from the code on 2026-11-15. Only values found in the sources are listed.
This is the system the app ships today; the redesign (`odd/tasks/rediseno-app.md`) may replace it.

## Colors

Source: `app/globals.css` (`@theme` for light, `@media (prefers-color-scheme: dark) :root` for dark). The theme follows the system; there is no toggle.

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--color-bg` | `#ffffff` | `#0d1512` | Page background, bottom nav |
| `--color-surface` | `#f4f6f3` | `#16201c` | Cards, menus, form panels |
| `--color-chip` | `#eaefea` | `#1b2823` | Neutral chips, avatar background, pressed rows |
| `--color-line` | `#e4e9e5` | `#21302a` | 1px borders and dividers |
| `--color-text` | `#10231a` | `#eaf2ee` | Body text, titles |
| `--color-muted` | `#5f6e66` | `#8ea298` | Secondary text, micro labels, inactive tabs |
| `--color-accent` | `#0e5c3f` | `#0f6b48` | Primary button fill |
| `--color-accent-text` | `#ffffff` | `#dbf5e8` | Text on primary buttons |
| `--color-accent-link` | `#0e5c3f` | `#34c08a` | Links, active tab |
| `--color-live` | `#c13d27` | `#ff8368` | Live / in-progress state |
| `--color-live-bg` | `#fbeae6` | `#2a1a15` | Live state background |
| `--color-up` | `#27794e` | `#34c08a` | Positive state text (state chips, gains) |
| `--color-ok-bg` | `#e6f2ea` | `#12291f` | Positive state chip background, friend avatar |
| `--color-down` | `#b24b31` | `#ff9a6b` | Negative state text (losses) |
| `--color-warn-bg` | `#f8ece4` | `#2a2016` | Warning background |
| `--color-scrim` | `rgba(10,25,18,.45)` | `rgba(0,0,0,.6)` | Overlay behind sheets |

## Typography

- Family: Archivo, weights 400–800 (`app/layout.tsx:8-11`, `--font-sans` in `app/globals.css`). Fallback `ui-sans-serif, system-ui, sans-serif`.
- Screen title: 26px, weight 800, tracking -0.03em (`app/torneos/page.tsx`, `app/amigos/page.tsx`).
- Card title: 18px, weight 800, tracking -0.02em (`app/torneos/page.tsx`).
- Empty-state title: 22px, weight 800, tracking -0.02em (`app/torneos/page.tsx`).
- Body / button: 15px, weight 800 for buttons, 700 for list names (`app/torneos/page.tsx`, `app/amigos/page.tsx`).
- Secondary text: 13–14px, weight 550, muted, line-height 1.5 (`app/torneos/page.tsx`, `app/amigos/page.tsx`).
- Micro label: 12px, weight 800, uppercase, tracking 0.13em, muted (`app/torneos/page.tsx`).
- Tab label: 12px, weight 800 (`app/torneo/[id]/nav.tsx`).

## Spacing

- Screen: max-width 32rem (`max-w-lg`), horizontal padding 20px (`px-5`), top 16px (`pt-4`) (`app/torneos/page.tsx`).
- Gaps between blocks: 12px (`gap-3`) on Mis torneos, 24px (`gap-6`) on Amigos.
- Card padding: 16px (`p-4`). Button padding: 16px. Button stack gap: 9px.
- Bottom nav: horizontal padding 22px, top 8px, bottom `max(1.5rem, safe-area)` (`app/torneo/[id]/nav.tsx`).

## Radius

- `--radius-field`: 12px — buttons and inputs (`app/globals.css`).
- `--radius-card`: 16px — cards and lists (`app/globals.css`).
- Pills: fully rounded (`rounded-full`) — state chips, avatars, counts.
- Menu: 14px (`app/torneos/cuenta.tsx`).

## Shadows

None. Separation is done with 1px `line` borders and `surface` fills.

## Components

- **Primary button**: full width, `accent` fill, `accent-text`, 15px/800, radius `field`, padding 16px.
- **Secondary button**: full width, 1px `line` border, `text`, 15px/800, optional 12px muted subline.
- **Card**: `surface` fill, 1px `line` border, radius `card`, padding 16px. Tournament card: name 18px/800 + state pill, then "Mi posición" and "Próxima fecha" as micro label + 15px/800 value, split by a 1px vertical line.
- **State pill**: `ok-bg` fill, `up` text, 12px/800, padding 6px 10px.
- **Avatar**: 40px circle with initials 12px/800; neutral `chip`/`muted`, friend `ok-bg`/`up` (`app/amigos/page.tsx`).
- **List**: rows inside one bordered card, rows split by 1px `line`, chevron `›` on the right.
- **Bottom nav** (inside a tournament only): 4 tabs Tabla, Fechas, Stats, Reglas; Lucide strokes at 22px, stroke 2 (2.4 when active); active color `accent-link`, inactive `muted`; min height 44px (`app/torneo/[id]/nav.tsx`).
- **Account menu**: circle with initials top-right of Mis torneos; dropdown with Amigos, Privacidad, Cerrar sesión (`app/torneos/cuenta.tsx`).
- **Disabled**: opacity 0.45 (`app/globals.css`).
- Touch targets: min 44px.
