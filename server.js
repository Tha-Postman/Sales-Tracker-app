import crypto from "crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const port = process.env.PORT || 4242;
const appUrl = process.env.APP_URL || "http://localhost:5500";
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey || !paystackSecretKey) {
    console.error("\nPayment backend setup is incomplete.");
    console.error("Create a .env file in this project folder and add:");
    console.error("SUPABASE_URL=your_supabase_project_url");
    console.error("SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key");
    console.error("PAYSTACK_SECRET_KEY=your_paystack_secret_key\n");
    process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

const allowedOrigins = [
    appUrl,
    "http://localhost:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:3000"
];

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error("Origin not allowed"));
    }
}));

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

app.post(
    "/api/paystack/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
        const signature = req.headers["x-paystack-signature"];
        const expectedSignature = crypto
            .createHmac("sha512", paystackSecretKey)
            .update(req.body)
            .digest("hex");

        if (signature !== expectedSignature) {
            res.status(401).json({ error: "Invalid signature" });
            return;
        }

        const event = JSON.parse(req.body.toString("utf8"));

        try {
            if (event.event === "charge.success") {
                await activateSubscriptionFromPaystack(event.data);
            }

            res.sendStatus(200);
        } catch (error) {
            console.error("Webhook activation failed:", error);
            res.status(500).json({ error: "Webhook processing failed" });
        }
    }
);

app.use(express.json());

app.post("/api/verify-payment", async (req, res) => {
    const { reference } = req.body;

    if (!reference) {
        res.status(400).json({ error: "Payment reference is required" });
        return;
    }

    try {
        const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
            headers: {
                Authorization: `Bearer ${paystackSecretKey}`
            }
        });

        const result = await response.json();

        if (!response.ok || result.data?.status !== "success") {
            res.status(400).json({ error: "Payment has not been confirmed" });
            return;
        }

        const profile = await activateSubscriptionFromPaystack(result.data);

        res.json({
            ok: true,
            profile
        });
    } catch (error) {
        console.error("Payment verification failed:", error);
        res.status(500).json({ error: "Could not verify payment" });
    }
});

function getExpiryDate(billingCycle) {
    const date = new Date();

    if (billingCycle === "yearly") {
        date.setFullYear(date.getFullYear() + 1);
    } else {
        date.setMonth(date.getMonth() + 1);
    }

    return date.toISOString();
}

async function activateSubscriptionFromPaystack(payment) {
    const metadata = payment.metadata || {};
    const userId = metadata.user_id;
    const plan = metadata.plan || "starter";
    const billingCycle = metadata.billing_cycle || "monthly";
    const currency = payment.currency || metadata.currency || "NGN";
    const reference = payment.reference;

    if (!userId) {
        throw new Error("Paystack metadata is missing user_id");
    }

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .update({
            subscription_status: "active",
            subscription_plan: `${plan}-${billingCycle}`,
            subscription_reference: reference,
            subscription_expires_at: getExpiryDate(billingCycle),
            subscription_billing_cycle: billingCycle,
            subscription_currency: currency
        })
        .eq("id", userId)
        .select("id, role, full_name, subscription_status, subscription_plan, subscription_expires_at")
        .single();

    if (error) {
        throw error;
    }

    return data;
}

app.listen(port, () => {
    console.log(`Sales Tracker payment backend running on http://localhost:${port}`);
});
