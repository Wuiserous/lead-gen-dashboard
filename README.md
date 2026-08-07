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
7. Admin explicitly enables WATI employee by employee. Only future
   registrations credited to an enabled employee receive the approved WATI
   template. Button/list replies qualify the lead and hand hot leads to the
   credited salesperson.

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
- `WATI_API_ENDPOINT` (copy the complete endpoint from WATI API Docs)
- `WATI_API_TOKEN` (create a scoped server token; never expose it publicly)
- `WATI_CHANNEL` (optional; required only for a specific multi-number channel)
- `WATI_WEBHOOK_SECRET` (a separate long random secret)
- `WATI_WELCOME_TEMPLATE` (defaults to `persevex_lead_welcome_v1`)
- `WATI_REMINDER_TEMPLATE` (defaults to `persevex_lead_reminder_v1`)
- `WATI_FINAL_REMINDER_TEMPLATE` (defaults to `persevex_lead_final_reminder_v1`)
- `CRON_SECRET` (a separate long random secret)

`DATABASE_URL`, `SUPABASE_PROJECT_REF`, and `SUPABASE_POOLER_HOST` are only
needed by the local migration command; the deployed app does not open direct
Postgres connections.

In Supabase Authentication URL settings, set the Site URL to the production
domain and add the same domain to Redirect URLs.

## WATI production setup

### 1. Apply the database migration first

Run `npm run db:migrate` before deploying the code that reads WhatsApp
conversation fields. Migration `0008_wati_conversion_engine.sql` creates the
conversion engine, `0009_admin_employee_wati_gate.sql` makes sending disabled
for every employee by default, and `0010_sales_wati_chat_scope.sql` gives Sales
Executives read access only to their own credited conversations. Historical
registrations are never queued when an employee is enabled; only registrations
created after that employee's switch is enabled can start WATI automation.

### Controlled rollout and chat access

- Admin can see and manage every WhatsApp conversation.
- Sales Executives can see and manage only registrations credited to their own
  account. This ownership is enforced by both the API and database RLS.
- Team Leads cannot see or manage WhatsApp conversations during this rollout.
- Admin enables or disables WATI from the Employees page for each Sales
  Executive or Team Lead.
- The shared WATI number does not require employee-to-WATI operator email
  mapping; conversation ownership is enforced inside this dashboard.
- Disabling an employee cancels their unsent jobs and pauses their existing
  conversations.
- Enabling an employee does not backfill or message historical registrations.
- Keep every employee disabled until all templates, credentials, webhook
  events, and the dispatcher schedule are ready.

### 2. Submit these templates in WATI

Create the templates from WATI so they are available to the WATI API. Keep the
template names, parameter names, and quick-reply text exact.

#### `persevex_lead_welcome_v1`

- Category: `Marketing`
- Template type/subcategory: `Standard`
- Language: `English (en)`
- Header: `None`

```text
Hi {{name}} 👋
Thanks for registering your interest in the Persevex {{domain}} internship opportunity through {{ambassador_name}}.

Your interest has been recorded. Choose what you would like to do next.
```

Quick replies:

- `Explore program`
- `Request a call`
- `Not interested`

Footer: `Reply STOP anytime to stop WhatsApp updates.`

Quick-reply button order:

1. `Explore program`
2. `Request a call`
3. `Not interested`

Named variables and review samples:

- `name`: `Aman`
- `domain`: `Data Science`
- `ambassador_name`: `Rahul`

#### `persevex_lead_reminder_v1`

- Category: `Marketing`
- Template type/subcategory: `Standard`
- Language: `English (en)`
- Header: `None`

```text
Hi {{name}}, your interest in the Persevex {{domain}} internship is saved.

Would you like to explore the program or speak directly with an advisor?
```

Quick replies:

- `Explore program`
- `Talk to advisor`
- `Not now`

Footer: `Reply STOP anytime to stop WhatsApp updates.`

Named variables and review samples:

- `name`: `Aman`
- `domain`: `Data Science`

#### `persevex_lead_final_reminder_v1`

- Category: `Marketing`
- Template type/subcategory: `Standard`
- Language: `English (en)`
- Header: `None`

```text
Hi {{name}}, we are pausing your pending Persevex {{domain}} internship enquiry for now.

You can still view the program details or request a callback below.
```

Quick replies:

- `View details`
- `Request a call`
- `Pause updates`

Footer: `Reply STOP anytime to stop WhatsApp updates.`

Named variables and review samples:

- `name`: `Aman`
- `domain`: `Data Science`

All templates should include the STOP footer. Do not enable production sending
until all three templates show as approved in WATI.

### 3. Configure the webhook

In WATI, add this webhook URL:

```text
https://campus.persevex.com/api/webhooks/wati?key=YOUR_WATI_WEBHOOK_SECRET
```

Enable at least:

- Message received
- Template message sent
- Session message sent
- Delivered
- Read
- Replied
- Failed

The endpoint stores every event once, using WATI/WhatsApp message identifiers
for deduplication. Unknown contacts are retained as ignored webhook audit rows
and never create phantom registrations.

### 4. Schedule the durable dispatcher

The registration route attempts immediate delivery after returning the success
response. A cron call is still required for retries and scheduled follow-ups.
Because the database is on Supabase Pro, the recommended scheduler is Supabase
Cron calling the protected application endpoint every minute.

Create two secrets in Supabase Vault, then schedule the request from the SQL
Editor (replace the example values):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(
  'https://campus.persevex.com/api/cron/whatsapp',
  'whatsapp_dispatch_url'
);

select vault.create_secret(
  'REPLACE_WITH_THE_SAME_CRON_SECRET_USED_IN_VERCEL',
  'whatsapp_cron_secret'
);

select cron.schedule(
  'persevex-whatsapp-dispatch',
  '* * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'whatsapp_dispatch_url'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'whatsapp_cron_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $$
);
```

Verify the cron job with:

```sql
select * from cron.job where jobname = 'persevex-whatsapp-dispatch';
```

### 5. Shared-number dashboard ownership

No WATI operator-email mapping is required. The application uses the single
WATI number for transport and keeps ownership in Supabase:

- each registration is permanently credited to its Sales Executive;
- Sales APIs and database RLS return only that employee's conversations;
- Admin can inspect and manage every conversation;
- Team Leads have no WhatsApp workspace access in this rollout;
- only Admin can enable WATI for an employee, and every employee starts off.

### 6. Launch checklist

1. Test the three approved templates with internal numbers.
2. Confirm WATI webhook events reach the production endpoint.
3. Confirm a button reply advances the dashboard stage without refresh.
4. Confirm STOP disables automation and manual sending.
5. Confirm a salesperson's dashboard reply pauses the bot.
6. Confirm a failed WATI request retries without duplicating a lead.
7. Pilot on a small percentage of real registrations before full traffic.
