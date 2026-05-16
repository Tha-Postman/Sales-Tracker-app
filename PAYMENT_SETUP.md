# Sales Tracker Payment Backend

This backend verifies Paystack payments and activates subscriptions in Supabase with the service-role key.

## 1. Install dependencies

```bash
npm install
```

## 2. Create `.env`

Copy `.env.example` to `.env`, then fill in:

```bash
PORT=4242
APP_URL=http://localhost:5500
SUPABASE_URL=https://nihqmpimzvhjglwkmhfl.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
PAYSTACK_SECRET_KEY=your_paystack_secret_key
```

Keep `SUPABASE_SERVICE_ROLE_KEY` private. Never put it inside frontend HTML.

## 3. Start backend

```bash
npm run dev
```

Local API:

```text
http://localhost:4242
```

## 4. Paystack webhook URL

For local testing, expose your backend with a tunnel such as ngrok, then set this webhook URL in Paystack:

```text
https://your-tunnel-url.ngrok-free.app/api/paystack/webhook
```

For production, deploy the backend and use:

```text
https://your-backend-domain.com/api/paystack/webhook
```

## 5. Frontend setting

In `pricing.html`, set:

```js
const PAYMENT_API_URL = "https://your-backend-domain.com";
```

For local testing, it can stay:

```js
const PAYMENT_API_URL = "http://localhost:4242";
```
