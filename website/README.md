# Flowstate website

Marketing site for Flowstate. Next.js App Router, deployed to Vercel.

This repo folder holds the **backend** (API route handlers in `app/api`, pure
logic in `lib`, the Supabase migration in `supabase/migrations`). The frontend
(pages/components) is built from `docs/claude-design-prompt-website.md`.

## Develop
```bash
cd website
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

## Test
```bash
npm test
```

Reuses the existing Flowstate Supabase project + PayRam for checkout. See the design
spec at `docs/superpowers/specs/2026-06-20-flowstate-website-backend-design.md`.
