# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**PrintCost** is a Progressive Web App (PWA) for calculating 3D print manufacturing costs. It's a single-page application built with React (loaded from CDN) using inline JSX/Babel transpilation, shipped as a bare-bones HTML/JS/CSS setup. Currently at v1.0.

The app helps 3D printing service providers track filament inventory, define models, calculate order costs with multiple cost factors, and generate invoices (simple or advanced freelancer-style). Data persists to localStorage and optionally syncs to Google Firestore.

## Repository Structure

The codebase is minimal and single-file focused:

- `index.html` — Entry point; loads React/ReactDOM/Babel from CDN, bootstraps the app
- `app.jsx` — Monolithic React app (~1000 lines); all UI components, logic, and state in one file
- `manifest.json` — PWA manifest with app metadata, icons, and theme colors
- `sw.js` — Service Worker for offline support and asset caching
- `.git/` — Git history (no build artifacts or node_modules; deployment-ready)

## Core Architecture

### Data Layer & State Management

All state is managed through React hooks (`useState`) in the `App` component:
- **filaments** — Array of filament/material entries (brand, type, color, price/kg, stock in grams)
- **models** — Array of 3D models with weight slots (allowing multi-part models)
- **extras** — Array of extra services/charges (name, unit price, unit type)
- **orders** — Array of print orders, each containing:
  - Order metadata (name, description, client details)
  - Items (models with filament usage tracking and markup)
  - Extra line items (labor, support removal, etc.)
  - Time/electricity metrics
  - Images (stored as base64 in localStorage)
- **settings** — Global app configuration (pricing, invoice templates, Czech locale, sync key, etc.)

**Persistence:**
- Primary: localStorage with keys `fil2`, `mod2`, `ext1`, `ord2`, `set2`, `syncKey`
- Optional: Google Firestore (`fsGet`/`fsSet` functions) for cloud sync via 32-hex key
- Sync debounced to 800ms to avoid excessive writes

### Calculation Logic

`calcOrderTotal(order, filaments, extras, settings)` computes the final price:
1. **Filament costs** — Sum of (grams/1000 × price_per_kg × markup) for each filament use
2. **Labor costs** — Print minutes × cost-per-minute (disabled in "friend mode")
3. **Electricity** — Electricity minutes × cost-per-minute (disabled in "friend mode")
4. **Extras** — Sum of (quantity × unit price) for all extra line items

### UI Tabs

The app is tab-based navigation:
1. **Orders** — View/edit/delete orders; generate HTML invoices; track costs; manage filament stock deductions
2. **Filaments** — Manage filament library with stock warnings (low stock threshold configurable)
3. **Models** — Define 3D model templates with multi-part weight slots for quick reuse
4. **Extras** — Define recurring services (support removal, post-processing, rush fees, etc.)
5. **Settings** — App config (brand name, cost rates, Czech/English locale, Firestore sync, import/export)

### Invoice Generation

`exportInvoice()` generates a self-contained HTML file (printable/PDF-saveable) with:
- **Simple mode** — Minimal invoice (date, items, total)
- **Advanced mode** — Full Czech freelancer invoice with supplier details, client info, banking info, variable symbol, payment due date
- Supports Czech language (CZK formatting, localized labels)
- Customizable accent color
- Grouped cost breakdown (filaments, other costs, services)

### Service Worker & PWA

`sw.js` implements:
- **Cache-first strategy** for app assets (index.html, app.jsx, external JS libraries)
- **Network-first strategy** for Firestore API calls (always attempt fresh data)
- Graceful fallback for offline Firestore requests
- Cache versioning (`CACHE = "printcost-v1.0"`)

## Key Implementation Patterns

### Setter Pattern

Custom hook-like functions to keep state synced with localStorage and Firestore:

```javascript
const mkSetter = (setter, key) => v => {
  setter(prev => {
    const n = typeof v === "function" ? v(prev) : v;
    persistAll({ ...stateRef.current, [key]: n });
    return n;
  });
};
```

This ensures any state change triggers `persistAll()` after a debounce, keeping localStorage/Firestore in sync.

### Unique ID Generation

- `uid()` — Quick 7-char random string for IDs (used for UI elements)
- `genKey()` — 32-hex cryptographic random key for Firestore sync

### Form Handling

Each major tab (Filaments, Models, Extras, Orders) follows a pattern:
- Form component with local state
- Submit validates required fields, generates entry with unique ID
- Edit mode: prefill form from existing entry, update on save, clear on cancel
- Import/export: JSON file I/O via FileReader and blob downloads

### Responsive UI

NavBar detects `window.innerWidth < 640` to switch between desktop (tab buttons + button bar) and mobile (hamburger menu + dropdown).

## Important Firebase Configuration

The app uses Firebase/Firestore with hardcoded credentials (read-only API key):
- Project ID: `habit-tracker-claude-cc01a`
- Firestore endpoint: `/v1/projects/{projectId}/databases/(default)/documents/printcost`
- Data is stored and retrieved as Firestore documents with stringified JSON fields

**Security note:** The API key is public and read-only; full write access requires authentication tokens (not implemented).

## Currency & Locale

Default currency is CZK (Czech Koruna). `fmtCZK()` formats numbers:
- Czech mode: `"1 234,56 Kč"` (space thousands separator, comma decimal)
- English mode: `"1234.56 CZK"`

## Development Notes

### No Build Step

The app uses Babel standalone (`babel-standalone@7.23.2`) to transpile JSX on the fly in the browser. This is suitable for small projects but becomes slow for larger codebases. If the app grows significantly, consider migrating to:
- Vite or webpack with a build process
- Separating components into separate files
- Proper module bundling

### Single Large Component File

All 1000+ lines are in `app.jsx`. When adding features:
- Extract large sub-components (e.g., `OrderEditor`, `FilamentsTab`) to their own function definitions
- Keep utility functions at the top (helpers, calculations, Firebase, localStorage)
- Group by functional area (Firebase → localStorage → helpers → main App → each tab component)

### Styling

Inline styles only; no CSS files. Colors are hardcoded:
- Dark background: `#0f0f13`, `#141420`
- Text: `#e8e8f0`
- Accent (customizable): default `#7c3aed` (purple)
- Success/warning: `#86efac` (green), `#f87171` (red)

Shared style objects at the bottom: `inp`, `ghostBtn`, `Card`, `Btn`, etc.

### localStorage Key Conventions

- `fil2` → filaments (previous versions used `fil`, hence `fil2`)
- `mod2` → models
- `ext1` → extras
- `ord2` → orders
- `set2` → settings
- `syncKey` → Firestore sync key (32-hex string or null)

The version numbers in keys allow schema migrations if the data structure changes.

## Common Tasks

### Running the App

No build step required. The app is served as-is:
1. Open `index.html` in a browser (or serve via any static HTTP server for HTTPS PWA features)
2. LocalStorage works immediately
3. Firestore sync requires internet and a valid sync key

### Adding a New Cost Factor

1. Add a new field to `DEFAULT_SETTINGS` (e.g., `markupPercentage: 0`)
2. Add UI input in `SettingsTab`
3. Update `calcOrderTotal()` to include the new cost
4. Update `OrderEditor` to display the cost breakdown

### Modifying Invoice Template

Edit the `L` (labels) object in `exportInvoice()` for text, and the `html` template string for layout/styling.

### Exporting Data

Use the "Export All" button in Settings to download a JSON backup; import it back on another device or browser. This is the primary data portability mechanism.

## Version History

Current version: **0.93** (see `index.html` comment and `sw.js` cache version)

Recent changes tracked in git with tags for each release.
