# Persevex LeadGen Dashboard

Production lead-generation platform for Persevex, built with Next.js and
Supabase.

## Product flow

1. Admin creates teams and employee accounts.
2. Sales Executives create Campus Ambassadors.
3. The app generates a public referral link and WhatsApp-ready message.
4. Students register with their name and Indian mobile number.
5. The registration is attributed to the ambassador, salesperson, and team.
6. Sales, Team Lead, Admin, and Campus Ambassador progress views update live.

The first release intentionally does not include OTP verification. Registrations
are labelled accurately and duplicate phone numbers are blocked company-wide.

## Local setup

1. Copy `.env.example` to `.env.local` and provide Supabase values.
2. Install dependencies with `npm install`.
3. Apply the database migration with `npm run db:migrate`.
4. Create the first Admin with `npm run bootstrap:admin -- --name "Name" --email "admin@example.com" --password "temporary-password"`.
5. Start the app with `npm run dev`.

## Validation

```bash
npm test
```

## Deployment

Connect this repository to Vercel and add these production environment
variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL` (the final `https://...vercel.app` or custom domain)
- `REGISTRATION_RATE_LIMIT_SECRET` (recommended: a separate random secret)

`DATABASE_URL`, `SUPABASE_PROJECT_REF`, and `SUPABASE_POOLER_HOST` are only
needed by the local migration command; the deployed app does not open direct
Postgres connections.

In Supabase Authentication URL settings, set the Site URL to the production
domain and add the same domain to Redirect URLs. The initial Admin is required
to replace the temporary password on first sign-in.
