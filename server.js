import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const port = process.env.PORT || 4242;
const appUrl = process.env.APP_URL || "https://sales-tracker-app-cd7k.onrender.com";
const frontendAppUrl = process.env.FRONTEND_APP_URL || process.env.PUBLIC_APP_URL || "https://use-sales-tracker.vercel.app";
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

const PLAN_LEVELS = {
    starter: 1,
    business: 2,
    pro: 3,
    enterprise: 4
};

const PLAN_REP_LIMITS = {
    starter: 2,
    business: 10,
    pro: 25,
    enterprise: Number.POSITIVE_INFINITY
};

const DEFAULT_RECEIPT_FOOTER = "Thank you for your purchase.";
const DEFAULT_PLAN_PRICING = {
    starter: { name: "Starter", monthly_ngn: 10000 },
    business: { name: "Business", monthly_ngn: 25000 },
    pro: { name: "Pro", monthly_ngn: 50000 }
};

const TRIAL_DAYS = 7;
const TRIAL_PLAN = "business-monthly";

function getTrialEndDate(startDate = new Date()) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + TRIAL_DAYS);
    return date;
}

function isFutureDate(value) {
    return Boolean(value) && new Date(value) > new Date();
}

function isActiveOrTrialing(record = {}) {
    const status = String(record.subscription_status || record.status || "").toLowerCase();

    if (status === "active") {
        return !record.subscription_expires_at || isFutureDate(record.subscription_expires_at);
    }

    if (status === "trialing") {
        return isFutureDate(record.trial_ends_at || record.subscription_expires_at);
    }

    return false;
}

function getAccessStatus(record = {}) {
    const status = String(record.subscription_status || record.status || "inactive").toLowerCase();

    if (status === "trialing" && !isActiveOrTrialing(record)) {
        return "expired";
    }

    return status;
}

app.set("trust proxy", 1);

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false
}));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please wait a moment and try again." },
    skip: req => req.path === "/paystack/webhook"
});

const sensitiveLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please wait before trying again." }
});

const allowedOrigins = [
    appUrl,
    "https://use-sales-tracker.vercel.app",
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

app.get("/api/health", async (req, res) => {
    const checkedAt = new Date().toISOString();
    const services = {
        backend: true,
        signup_route: true,
        supabase: false,
        paystack: Boolean(paystackSecretKey),
        app_url: Boolean(appUrl)
    };

    try {
        const timeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Supabase health check timed out")), 3500);
        });

        await Promise.race([
            supabaseAdmin.from("businesses").select("*", { count: "exact", head: true }),
            timeout
        ]);

        services.supabase = true;
    } catch(error) {
        console.warn("Health check Supabase warning:", error.message);
    }

    res.status(services.supabase ? 200 : 503).json({
        ok: services.backend && services.supabase,
        checked_at: checkedAt,
        services
    });
});

app.use("/api", apiLimiter);

function normalizePricingRows(rows = []) {
    const pricing = { ...DEFAULT_PLAN_PRICING };

    rows.forEach(row => {
        const key = getPlanKey(row.plan_key || row.plan || "");
        if (!pricing[key] || key === "enterprise") return;

        pricing[key] = {
            name: row.name || DEFAULT_PLAN_PRICING[key].name,
            monthly_ngn: Number(row.monthly_ngn || row.monthlyNgn || DEFAULT_PLAN_PRICING[key].monthly_ngn)
        };
    });

    return pricing;
}

async function loadPlatformPricing() {
    const { data, error } = await supabaseAdmin
        .from("platform_pricing")
        .select("*");

    if (error) {
        if (isMissingTableError(error)) return DEFAULT_PLAN_PRICING;
        throw error;
    }

    return normalizePricingRows(data || []);
}

app.get("/api/public/pricing", async (req, res) => {
    try {
        const pricing = await loadPlatformPricing();
        res.json({ ok: true, pricing });
    } catch (error) {
        console.error("Load public pricing failed:", error);
        res.json({ ok: true, pricing: DEFAULT_PLAN_PRICING });
    }
});

app.get("/api/auth/access", async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : null;

        if (!token) {
            res.status(401).json({ error: "Login required" });
            return;
        }

        const {
            data: { user },
            error: userError
        } = await supabaseAdmin.auth.getUser(token);

        if (userError || !user) {
            res.status(401).json({ error: "Invalid login session" });
            return;
        }

        let { data: profile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) {
            throw profileError;
        }

        if (!profile) {
            const fullName = user.user_metadata?.full_name || user.email?.split("@")[0] || "User";

            const { data: createdProfile, error: createError } = await supabaseAdmin
                .from("profiles")
                .insert({
                    id: user.id,
                    email: user.email,
                    full_name: fullName,
                    role: "rep",
                    subscription_status: "inactive",
                    status: "active",
                    is_active: true
                })
                .select("*")
                .single();

            if (createError) throw createError;
            profile = createdProfile;
        }

        if (isDeveloperProfile(profile)) {
            res.json({
                ok: true,
                access: "active",
                destination: "developer.html",
                profile
            });
            return;
        }

        let business = null;

        if (profile.business_id) {
            const { data, error } = await supabaseAdmin
                .from("businesses")
                .select("*")
                .eq("id", profile.business_id)
                .maybeSingle();

            if (error) throw error;
            business = data;
        }

        if (!business) {
            const { data, error } = await supabaseAdmin
                .from("businesses")
                .select("*")
                .eq("owner_id", user.id)
                .maybeSingle();

            if (error) throw error;
            business = data;
        }

        const profileActive = isActiveOrTrialing(profile);

        if (!business && profile.role === "admin" && profileActive) {
            business = await createBusinessForActiveAdmin(profile, user.id);
        }

        const businessActive = isActiveOrTrialing(business);

        if (business && businessActive) {
            const updates = {
                business_id: business.id,
                subscription_status: getAccessStatus(business),
                subscription_plan: business.plan || profile.subscription_plan || TRIAL_PLAN,
                subscription_expires_at: business.subscription_expires_at || business.trial_ends_at || profile.subscription_expires_at || null,
                is_active: true,
                status: "active"
            };

            if (business.owner_id === user.id) {
                updates.role = "admin";
            }

            const { data: updatedProfile, error: updateError } = await supabaseAdmin
                .from("profiles")
                .update(updates)
                .eq("id", user.id)
                .select("*")
                .single();

            if (updateError) {
                if (String(updateError.message || "").includes("profiles_business_id_fkey")) {
                    res.status(409).json({
                        error: "Your payment is active, but the profile-to-business database link is broken. Run paid-access-fk-repair.sql in Supabase, then try signing in again.",
                        code: "PROFILE_BUSINESS_FK_REPAIR_REQUIRED",
                        business_id: business.id,
                        user_id: user.id
                    });
                    return;
                }

                throw updateError;
            }

            profile = updatedProfile;

            if (profile.role === "admin") {
                await migrateLegacyBusinessData(profile);
            }

            res.json({
                ok: true,
                access: "active",
                destination: getProfileDestination(profile),
                profile
            });
            return;
        }

        if (profile.business_id && profileActive && profile.is_active !== false && profile.status !== "inactive") {
            res.json({
                ok: true,
                access: "active",
                destination: getProfileDestination(profile),
                profile
            });
            return;
        }

        res.json({
            ok: true,
            access: "inactive",
            destination: "pricing.html?resumeCheckout=1",
            profile
        });
    } catch (error) {
        console.error("Auth access check failed:", error);
        res.status(500).json({ error: error.message || "Could not check account access" });
    }
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

app.use(express.json({ limit: "1mb" }));

app.post("/api/auth/signup", sensitiveLimiter, async (req, res) => {
    res.status(410).json({ error: "Backend signup endpoint disabled. Please use email confirmation signup." });
    return;

    try {
        const email = String(req.body?.email || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        const fullName = String(req.body?.full_name || req.body?.fullName || "").trim();

        if (!fullName || !email || !password) {
            res.status(400).json({ error: "Full name, email, and password are required" });
            return;
        }

        if (password.length < 8) {
            res.status(400).json({ error: "Password must be at least 8 characters long" });
            return;
        }

        const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                full_name: fullName
            }
        });

        if (createUserError) {
            const message = String(createUserError.message || "").toLowerCase();

            if (message.includes("already") || message.includes("registered") || message.includes("exists")) {
                res.status(409).json({ error: "This email already has an account. Please sign in instead." });
                return;
            }

            throw createUserError;
        }

        const user = createdUser?.user;

        if (!user?.id) {
            res.status(500).json({ error: "Account was created, but user setup could not finish" });
            return;
        }

        const { error: profileError } = await supabaseAdmin
            .from("profiles")
            .upsert({
                id: user.id,
                email,
                full_name: fullName,
                role: "admin",
                subscription_status: "inactive",
                status: "active",
                is_active: true
            }, { onConflict: "id" });

        if (profileError) {
            throw profileError;
        }

        res.status(201).json({
            ok: true,
            message: "Account created. You can now sign in.",
            user: {
                id: user.id,
                email: user.email
            }
        });
    } catch (error) {
        console.error("Backend signup failed:", error);
        res.status(error.status || 500).json({
            error: error.message || "Could not create account. Please try again."
        });
    }
});

app.post("/api/auth/start-trial", sensitiveLimiter, async (req, res) => {
    try {
        const authHeader = req.headers.authorization || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

        if (!token) {
            res.status(401).json({ error: "Login required" });
            return;
        }

        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

        if (userError || !user) {
            res.status(401).json({ error: "Invalid login session" });
            return;
        }

        let { data: profile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .maybeSingle();

        if (profileError) throw profileError;

        if (!profile) {
            const fullName = user.user_metadata?.full_name || user.email?.split("@")[0] || "User";
            const { data: createdProfile, error: createProfileError } = await supabaseAdmin
                .from("profiles")
                .insert({
                    id: user.id,
                    email: user.email,
                    full_name: fullName,
                    role: "admin",
                    subscription_status: "trialing",
                    subscription_plan: TRIAL_PLAN,
                    status: "active",
                    is_active: true
                })
                .select("*")
                .single();

            if (createProfileError) throw createProfileError;
            profile = createdProfile;
        }

        let business = null;

        if (profile.business_id) {
            const { data, error } = await supabaseAdmin
                .from("businesses")
                .select("*")
                .eq("id", profile.business_id)
                .maybeSingle();
            if (error) throw error;
            business = data;
        }

        if (!business) {
            const { data, error } = await supabaseAdmin
                .from("businesses")
                .select("*")
                .eq("owner_id", user.id)
                .maybeSingle();
            if (error) throw error;
            business = data;
        }

        if (business && isActiveOrTrialing(business)) {
            res.json({ ok: true, access: getAccessStatus(business), destination: "admin.html", business, profile });
            return;
        }

        const trialStartedAt = new Date();
        const trialEndsAt = getTrialEndDate(trialStartedAt);
        const businessName = profile.business_name
            || (profile.full_name ? profile.full_name + "'s Business" : "Sales Tracker Business");

        if (!business) {
            const { data: createdBusiness, error: businessError } = await supabaseAdmin
                .from("businesses")
                .insert({
                    business_name: businessName,
                    owner_id: user.id,
                    plan: TRIAL_PLAN,
                    subscription_status: "trialing",
                    subscription_expires_at: trialEndsAt.toISOString(),
                    trial_started_at: trialStartedAt.toISOString(),
                    trial_ends_at: trialEndsAt.toISOString(),
                    trial_status: "active",
                    currency: profile.subscription_currency || "NGN",
                    receipt_footer: DEFAULT_RECEIPT_FOOTER,
                    low_stock_threshold: 5
                })
                .select("*")
                .single();

            if (businessError) throw businessError;
            business = createdBusiness;
        } else {
            const { data: updatedBusiness, error: businessError } = await supabaseAdmin
                .from("businesses")
                .update({
                    plan: business.plan || TRIAL_PLAN,
                    subscription_status: "trialing",
                    subscription_expires_at: trialEndsAt.toISOString(),
                    trial_started_at: trialStartedAt.toISOString(),
                    trial_ends_at: trialEndsAt.toISOString(),
                    trial_status: "active"
                })
                .eq("id", business.id)
                .select("*")
                .single();

            if (businessError) throw businessError;
            business = updatedBusiness;
        }

        const { data: updatedProfile, error: updateProfileError } = await supabaseAdmin
            .from("profiles")
            .update({
                business_id: business.id,
                role: "admin",
                subscription_status: "trialing",
                subscription_plan: TRIAL_PLAN,
                subscription_expires_at: trialEndsAt.toISOString(),
                status: "active",
                is_active: true
            })
            .eq("id", user.id)
            .select("*")
            .single();

        if (updateProfileError) throw updateProfileError;

        res.json({
            ok: true,
            access: "trialing",
            destination: "admin.html",
            trial_days: TRIAL_DAYS,
            trial_ends_at: trialEndsAt.toISOString(),
            business,
            profile: updatedProfile
        });
    } catch (error) {
        console.error("Start trial failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not start free trial" });
    }
});

app.post("/api/verify-payment", sensitiveLimiter, async (req, res) => {
    const { reference } = req.body;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!reference) {
        res.status(400).json({ error: "Payment reference is required" });
        return;
    }

    if (!token) {
        res.status(401).json({ error: "Login required" });
        return;
    }

    try {
        const {
            data: { user },
            error: userError
        } = await supabaseAdmin.auth.getUser(token);

        if (userError || !user) {
            res.status(401).json({ error: "Invalid login session" });
            return;
        }

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

        if (result.data.metadata?.user_id !== user.id) {
            res.status(403).json({ error: "This payment does not belong to the signed-in account" });
            return;
        }

        const profile = await activateSubscriptionFromPaystack(result.data);

        res.json({
            ok: true,
            profile
        });
    } catch (error) {
        console.error("Payment verification failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not verify payment" });
    }
});

app.post("/api/payments/recover", sensitiveLimiter, async (req, res) => {
    const reference = String(req.body?.reference || "").trim();

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
            res.status(400).json({ error: "Payment has not been confirmed by Paystack yet" });
            return;
        }

        const profile = await activateSubscriptionFromPaystack(result.data);

        res.json({
            ok: true,
            message: "Payment confirmed and subscription activated",
            profile
        });
    } catch (error) {
        console.error("Payment recovery failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not recover payment" });
    }
});

app.post("/api/sales/submit", sensitiveLimiter, async (req, res) => {
    try {
        const profile = await requireBusinessProfile(req);
        const { sale, sync_key } = req.body || {};

        if (!sale || !Array.isArray(sale.cart) || sale.cart.length === 0) {
            res.status(400).json({ error: "Sale cart is required" });
            return;
        }

        const { data, error } = await supabaseAdmin.rpc("submit_sale_with_stock_for_user", {
            p_user_id: profile.id,
            p_sale: {
                ...sale,
                user_id: profile.id,
                business_id: profile.business_id,
                created_by: sale.created_by || profile.full_name || profile.email || "Sales Rep"
            },
            p_sync_key: sync_key || sale.offline_sync_key || null
        });

        if (error) {
            if (isMissingTableError(error) || String(error.message || "").includes("submit_sale_with_stock_for_user")) {
                res.status(500).json({ error: "Sales security migration is missing. Run security-advisor-fixes.sql in Supabase." });
                return;
            }

            throw error;
        }

        res.json({ ok: true, sale_id: data });
    } catch (error) {
        console.error("Sale submit failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Sale could not be saved" });
    }
});

app.post("/api/team/invites", sensitiveLimiter, async (req, res) => {
    try {
        const adminProfile = await requireAdminProfile(req);
        const { email, full_name } = req.body;
        const normalizedEmail = String(email || "").trim().toLowerCase();
        const repName = String(full_name || "").trim();

        if (!normalizedEmail || !repName) {
            res.status(400).json({ error: "Rep name and email are required" });
            return;
        }

        const repLimit = getRepLimit(adminProfile);
        const { data: currentReps, error: countError } = await supabaseAdmin
            .from("profiles")
            .select("id, status, is_active")
            .eq("business_id", adminProfile.business_id)
            .eq("role", "rep");

        if (countError) throw countError;

        const activeRepCount = (currentReps || []).filter(profile =>
            profile.is_active !== false && profile.status !== "inactive"
        ).length;

        if (Number.isFinite(repLimit) && activeRepCount >= repLimit) {
            res.status(402).json({ error: "Your current plan has reached its sales rep limit. Upgrade to add more reps." });
            return;
        }

        const token = crypto.randomBytes(24).toString("hex");
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        const { data: invite, error } = await supabaseAdmin
            .from("rep_invites")
            .insert({
                business_id: adminProfile.business_id,
                invited_by: adminProfile.id,
                email: normalizedEmail,
                full_name: repName,
                role: "rep",
                token,
                status: "pending",
                expires_at: expiresAt.toISOString()
            })
            .select("*")
            .single();

        if (error) {
            if (isMissingTableError(error)) {
                res.status(503).json({
                    error: "Team invite setup is not ready yet. Please contact support to finish setup.",
                    code: "REP_INVITES_SETUP_REQUIRED"
                });
                return;
            }

            throw error;
        }

        await logAudit(adminProfile, "rep_invite_created", "rep_invite", invite.id, {
            rep_name: repName,
            rep_email: normalizedEmail
        });

        const inviteUrl = frontendAppUrl.replace(/\/$/, "") + "/signin.html?invite=" + encodeURIComponent(token);

        res.json({ ok: true, invite, invite_url: inviteUrl });
    } catch (error) {
        console.error("Create rep invite failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not create invite" });
    }
});

app.get("/api/team/invites/:token", async (req, res) => {
    try {
        const token = String(req.params.token || "").trim();

        if (!token) {
            res.status(400).json({ error: "Invite link is invalid" });
            return;
        }

        const { data: invite, error: inviteError } = await supabaseAdmin
            .from("rep_invites")
            .select("id, business_id, email, full_name, role, status, expires_at")
            .eq("token", token)
            .maybeSingle();

        if (inviteError) {
            if (isMissingTableError(inviteError)) {
                res.status(503).json({
                    error: "Team invite setup is not ready yet. Please contact support to finish setup.",
                    code: "REP_INVITES_SETUP_REQUIRED"
                });
                return;
            }

            throw inviteError;
        }

        if (!invite || invite.status !== "pending" || new Date(invite.expires_at) <= new Date()) {
            res.status(410).json({ error: "This invite link has expired. Ask your admin for a new invite." });
            return;
        }

        const { data: business, error: businessError } = await supabaseAdmin
            .from("businesses")
            .select("id, business_name, name")
            .eq("id", invite.business_id)
            .maybeSingle();

        if (businessError) throw businessError;

        res.json({
            ok: true,
            invite: {
                email: invite.email,
                full_name: invite.full_name,
                role: invite.role || "rep",
                expires_at: invite.expires_at,
                business_name: business?.business_name || business?.name || "Sales Tracker business"
            }
        });
    } catch (error) {
        console.error("Load rep invite failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load invite" });
    }
});


app.post("/api/team/invites/accept", sensitiveLimiter, async (req, res) => {
    try {
        const { token } = req.body;
        const authHeader = req.headers.authorization || "";
        const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

        if (!token || !accessToken) {
            res.status(400).json({ error: "Invite link is invalid or expired" });
            return;
        }

        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
        if (userError || !user) {
            res.status(401).json({ error: "Please sign in again to accept this invite" });
            return;
        }

        const { data: invite, error: inviteError } = await supabaseAdmin
            .from("rep_invites")
            .select("*")
            .eq("token", token)
            .maybeSingle();

        if (inviteError) {
            if (isMissingTableError(inviteError)) {
                res.status(503).json({
                    error: "Team invite setup is not ready yet. Please contact support to finish setup.",
                    code: "REP_INVITES_SETUP_REQUIRED"
                });
                return;
            }

            throw inviteError;
        }

        if (!invite || invite.status !== "pending" || new Date(invite.expires_at) <= new Date()) {
            res.status(410).json({ error: "This invite link has expired. Ask your admin for a new invite." });
            return;
        }

        if (String(user.email || "").toLowerCase() !== String(invite.email || "").toLowerCase()) {
            res.status(403).json({ error: "This invite was sent to a different email address." });
            return;
        }

        const { data: business, error: businessError } = await supabaseAdmin
            .from("businesses")
            .select("*")
            .eq("id", invite.business_id)
            .maybeSingle();

        if (businessError) throw businessError;
        if (!business || !isActiveOrTrialing(business)) {
            res.status(403).json({ error: "This business is not active right now." });
            return;
        }

        const fullName = invite.full_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Sales Rep";

        const { data: profile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .upsert({
                id: user.id,
                email: user.email,
                full_name: fullName,
                role: "rep",
                business_id: invite.business_id,
                subscription_status: getAccessStatus(business),
                subscription_plan: business.plan || "starter-monthly",
                subscription_expires_at: business.subscription_expires_at || business.trial_ends_at || null,
                is_active: true,
                status: "active"
            }, { onConflict: "id" })
            .select("*")
            .single();

        if (profileError) throw profileError;

        await supabaseAdmin
            .from("rep_invites")
            .update({ status: "accepted", accepted_at: new Date().toISOString() })
            .eq("id", invite.id);

        await logAudit(profile, "rep_invite_accepted", "rep_invite", invite.id, { rep_email: user.email });

        res.json({ ok: true, destination: "dashboard.html", profile });
    } catch (error) {
        console.error("Accept rep invite failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not accept invite" });
    }
});


app.post("/api/team/reps", sensitiveLimiter, async (req, res) => {
    try {
        const adminProfile = await requireAdminProfile(req);
        const { full_name, email, password } = req.body;

        if (!full_name || !email || !password || password.length < 6) {
            res.status(400).json({ error: "Name, email, and 6+ character password are required" });
            return;
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const repLimit = getRepLimit(adminProfile);
        const { data: currentReps, error: countError } = await supabaseAdmin
            .from("profiles")
            .select("id, status, is_active")
            .eq("business_id", adminProfile.business_id)
            .eq("role", "rep");

        if (countError) {
            throw countError;
        }

        const activeRepCount = (currentReps || []).filter(profile =>
            profile.is_active !== false && profile.status !== "inactive"
        ).length;

        if (Number.isFinite(repLimit) && activeRepCount >= repLimit) {
            res.status(402).json({
                error: `Your current plan supports up to ${repLimit} reps. Upgrade to add more.`
            });
            return;
        }

        let userId;

        const created = await supabaseAdmin.auth.admin.createUser({
            email: normalizedEmail,
            password,
            email_confirm: true,
            user_metadata: {
                full_name
            }
        });

        if (created.error) {
            if (!String(created.error.message || "").toLowerCase().includes("already")) {
                throw created.error;
            }

            const { data: existingProfile, error: existingError } = await supabaseAdmin
                .from("profiles")
                .select("id, business_id")
                .eq("email", normalizedEmail)
                .maybeSingle();

            if (existingError || !existingProfile) {
                throw created.error;
            }

            userId = existingProfile.id;
        } else {
            userId = created.data.user.id;
        }

        const { data: profile, error } = await supabaseAdmin
            .from("profiles")
            .upsert({
                id: userId,
                email: normalizedEmail,
                full_name,
                role: "rep",
                business_id: adminProfile.business_id,
                subscription_status: "active",
                subscription_plan: adminProfile.subscription_plan,
                subscription_expires_at: adminProfile.subscription_expires_at,
                is_active: true,
                status: "active"
            }, { onConflict: "id" })
            .select("id, full_name, email, role, business_id, is_active, status")
            .single();

        if (error) {
            throw error;
        }

        await logAudit(adminProfile, "rep_added", "profile", profile.id, {
            rep_name: profile.full_name,
            rep_email: profile.email
        });

        res.json({ ok: true, profile });
    } catch (error) {
        console.error("Create rep failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not create rep" });
    }
});

app.get("/api/team/profiles", async (req, res) => {
    try {
        const adminProfile = await requireAdminProfile(req);

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .select("id, full_name, email, role, business_id, is_active, status, suspended_until, subscription_status, subscription_plan, subscription_expires_at")
            .eq("business_id", adminProfile.business_id)
            .order("role", { ascending: true })
            .order("full_name", { ascending: true });

        if (error) {
            throw error;
        }

        res.json({
            ok: true,
            profiles: data || []
        });
    } catch (error) {
        console.error("Load team profiles failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load team profiles" });
    }
});

app.get("/api/team/business", async (req, res) => {
    try {
        const profile = await requireBusinessProfile(req);
        const business = await getOrCreateBusinessForProfile(profile);

        if (profile.role === "admin") {
            await migrateLegacyBusinessData(profile);
        }

        res.json({
            ok: true,
            business
        });
    } catch (error) {
        console.error("Load business failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load business" });
    }
});


app.get("/api/team/products", async (req, res) => {
    try {
        const profile = await requireBusinessProfile(req);

        const { data, error } = await supabaseAdmin
            .from("products")
            .select("*")
            .eq("business_id", profile.business_id)
            .order("id", { ascending: false });

        if (error) throw error;

        res.json({
            ok: true,
            products: data || []
        });
    } catch (error) {
        console.error("Load team products failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load products" });
    }
});

app.get("/api/team/customers", async (req, res) => {
    try {
        const profile = await requireBusinessProfile(req);

        const { data, error } = await supabaseAdmin
            .from("customers")
            .select("*")
            .eq("business_id", profile.business_id)
            .order("id", { ascending: false });

        if (error) throw error;

        res.json({
            ok: true,
            customers: data || []
        });
    } catch (error) {
        console.error("Load team customers failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load customers" });
    }
});

app.post("/api/team/business/settings", async (req, res) => {
    try {
        const profile = await requireAdminProfile(req);
        const businessName = String(req.body.business_name || "").trim();
        const currency = String(req.body.currency || "NGN").trim().toUpperCase();
        const receiptFooter = String(req.body.receipt_footer || DEFAULT_RECEIPT_FOOTER).trim();
        const receiptLogoUrl = String(req.body.receipt_logo_url || "").trim();
        const lowStockThreshold = Number(req.body.low_stock_threshold || 5);
        const canUseCustomLogo = getPlanLevel(profile.subscription_plan) >= PLAN_LEVELS.pro;

        if (!businessName) {
            res.status(400).json({ error: "Business name is required" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("businesses")
            .upsert({
                id: profile.business_id,
                owner_id: profile.role === "admin" ? profile.id : null,
                business_name: businessName,
                currency,
                receipt_footer: receiptFooter || DEFAULT_RECEIPT_FOOTER,
                receipt_logo_url: canUseCustomLogo ? receiptLogoUrl : null,
                low_stock_threshold: Number.isFinite(lowStockThreshold) ? Math.max(0, lowStockThreshold) : 5,
                plan: profile.subscription_plan || "starter-monthly",
                subscription_status: profile.subscription_status || "active",
                subscription_expires_at: profile.subscription_expires_at || null,
                updated_at: new Date().toISOString()
            }, { onConflict: "id" })
            .select("*")
            .maybeSingle();

        if (error) throw error;
        if (!data) throw new Error("Business settings could not be saved. Run business-id-repair.sql, then try again.");

        await logAudit(profile, "business_settings_updated", "business", profile.business_id, {
            business_name: businessName,
            currency,
            receipt_logo_url: canUseCustomLogo ? receiptLogoUrl : null
        });

        res.json({ ok: true, business: data });
    } catch (error) {
        console.error("Save business settings failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not save business settings" });
    }
});

app.get("/api/team/reports", async (req, res) => {
    try {
        const profile = await requireAdminProfile(req);
        await requireReportsPlan(profile);
        const { from, to, rep, status } = req.query;

        let query = supabaseAdmin
            .from("customers")
            .select("*")
            .eq("business_id", profile.business_id)
            .order("created_at", { ascending: false });

        if (from) query = query.gte("created_at", from);
        if (to) query = query.lte("created_at", to);
        if (rep && rep !== "all") query = query.eq("user_id", rep);
        if (status && status !== "All") query = query.eq("status", status);

        const { data, error } = await query.limit(1000);
        if (error) throw error;

        const rows = data || [];
        const paidRows = rows.filter(row => row.status === "Paid");
        const pendingRows = rows.filter(row => row.status === "Pending");
        const cancelledRows = rows.filter(row => row.status === "Cancelled");
        const revenue = paidRows.reduce((sum, row) => sum + Number(row.final_price || row.price || 0), 0);
        const pendingRevenue = pendingRows.reduce((sum, row) => sum + Number(row.final_price || row.price || 0), 0);

        res.json({
            ok: true,
            summary: {
                totalSales: rows.length,
                paidSales: paidRows.length,
                pendingSales: pendingRows.length,
                cancelledSales: cancelledRows.length,
                revenue,
                pendingRevenue,
                averageSale: paidRows.length ? revenue / paidRows.length : 0
            },
            rows
        });
    } catch (error) {
        console.error("Load reports failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load reports" });
    }
});

app.get("/api/team/expenses", async (req, res) => {
    try {
        const profile = await requireAdminProfile(req);

        const { data, error } = await supabaseAdmin
            .from("business_expenses")
            .select("*")
            .eq("business_id", profile.business_id)
            .order("expense_date", { ascending: false })
            .order("created_at", { ascending: false })
            .limit(500);

        if (error) {
            if (isMissingTableError(error)) {
                res.json({ ok: true, expenses: [], setup_required: true });
                return;
            }
            throw error;
        }

        res.json({ ok: true, expenses: data || [] });
    } catch (error) {
        console.error("Load expenses failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load expenses" });
    }
});

app.post("/api/team/expenses", async (req, res) => {
    try {
        const profile = await requireAdminProfile(req);
        const title = String(req.body?.title || "").trim();
        const category = String(req.body?.category || "General").trim();
        const amount = Number(req.body?.amount || 0);
        const expenseDate = req.body?.expense_date || new Date().toISOString().slice(0, 10);
        const note = String(req.body?.note || "").trim();

        if (!title || !Number.isFinite(amount) || amount <= 0) {
            res.status(400).json({ error: "Expense title and valid amount are required" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("business_expenses")
            .insert({
                business_id: profile.business_id,
                title,
                category,
                amount,
                expense_date: expenseDate,
                note,
                created_by: profile.id
            })
            .select("*")
            .single();

        if (error) throw error;

        await logAudit(profile, "expense_added", "expense", data.id, { title, amount, category });
        res.json({ ok: true, expense: data });
    } catch (error) {
        console.error("Save expense failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not save expense" });
    }
});

app.delete("/api/team/expenses/:id", async (req, res) => {
    try {
        const profile = await requireAdminProfile(req);

        const { error } = await supabaseAdmin
            .from("business_expenses")
            .delete()
            .eq("id", req.params.id)
            .eq("business_id", profile.business_id);

        if (error) throw error;

        await logAudit(profile, "expense_deleted", "expense", req.params.id, {});
        res.json({ ok: true });
    } catch (error) {
        console.error("Delete expense failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not delete expense" });
    }
});

app.get("/api/team/audit", async (req, res) => {
    try {
        const profile = await requireAdminProfile(req);

        const { data, error } = await supabaseAdmin
            .from("audit_logs")
            .select("*")
            .eq("business_id", profile.business_id)
            .order("created_at", { ascending: false })
            .limit(80);

        if (error) {
            if (isMissingTableError(error)) {
                res.json({ ok: true, logs: [] });
                return;
            }

            throw error;
        }

        res.json({ ok: true, logs: data || [] });
    } catch (error) {
        console.error("Load audit failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load activity log" });
    }
});

app.get("/api/team/chat", async (req, res) => {
    try {
        const profile = await requireBusinessProfile(req);
        await requireProPlan(profile);

        const { data: settings } = await supabaseAdmin
            .from("team_chat_settings")
            .select("*")
            .eq("business_id", profile.business_id)
            .maybeSingle();

        const { data: messages, error } = await supabaseAdmin
            .from("team_chat_messages")
            .select("*")
            .eq("business_id", profile.business_id)
            .order("created_at", { ascending: false })
            .limit(60);

        if (error) {
            throw error;
        }

        const messageIds =
            (messages || []).map(message => message.id);

        let reactions = [];

        if (messageIds.length > 0) {
            const { data: reactionRows, error: reactionError } = await supabaseAdmin
                .from("team_chat_reactions")
                .select("*")
                .eq("business_id", profile.business_id)
                .in("message_id", messageIds);

            if (reactionError) {
                if (isMissingTableError(reactionError)) {
                    console.warn("team_chat_reactions table is missing. Chat will load without reactions.");
                } else {
                    throw reactionError;
                }
            } else {
                reactions = reactionRows || [];
            }
        }

        const messagesWithReactions =
            (messages || []).reverse().map(message => ({
                ...message,
                reactions: reactions.filter(reaction => reaction.message_id === message.id)
            }));

        res.json({
            ok: true,
            settings: settings || {
                admin_only: false,
                allow_attachments: true
            },
            messages: messagesWithReactions
        });
    } catch (error) {
        console.error("Load team chat failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load team chat" });
    }
});

app.post("/api/team/chat", async (req, res) => {
    try {
        const profile = await requireBusinessProfile(req);
        await requireProPlan(profile);

        const { message, attachment_url, attachment_type } = req.body;

        const { data: settings } = await supabaseAdmin
            .from("team_chat_settings")
            .select("*")
            .eq("business_id", profile.business_id)
            .maybeSingle();

        if (settings?.admin_only && profile.role !== "admin") {
            res.status(403).json({ error: "Only admins can send messages right now" });
            return;
        }

        if (!String(message || "").trim() && !String(attachment_url || "").trim()) {
            res.status(400).json({ error: "Message or attachment is required" });
            return;
        }

        if (attachment_url && settings?.allow_attachments === false) {
            res.status(403).json({ error: "Attachments are currently disabled" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("team_chat_messages")
            .insert({
                business_id: profile.business_id,
                sender_id: profile.id,
                sender_name: profile.full_name || profile.email || "Team member",
                sender_role: profile.role,
                message: String(message || "").trim(),
                attachment_url: String(attachment_url || "").trim() || null,
                attachment_type: attachment_type || null
            })
            .select("*")
            .single();

        if (error) {
            throw error;
        }

        await logAudit(profile, "chat_message_sent", "team_chat_message", data.id, {
            has_attachment: Boolean(data.attachment_url)
        });

        res.json({ ok: true, message: data });
    } catch (error) {
        console.error("Send team chat failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not send message" });
    }
});

app.post("/api/team/chat/:id/react", async (req, res) => {
    try {
        const profile = await requireBusinessProfile(req);
        await requireProPlan(profile);

        const messageId = req.params.id;
        const reaction = String(req.body.reaction || "").trim();
        const allowed = ["seen", "done", "question"];

        if (!allowed.includes(reaction)) {
            res.status(400).json({ error: "Choose a valid reaction" });
            return;
        }

        const { data: message, error: messageError } = await supabaseAdmin
            .from("team_chat_messages")
            .select("id, business_id")
            .eq("id", messageId)
            .single();

        if (messageError || !message || message.business_id !== profile.business_id) {
            res.status(404).json({ error: "Message not found" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("team_chat_reactions")
            .upsert({
                message_id: messageId,
                business_id: profile.business_id,
                user_id: profile.id,
                user_name: profile.full_name || profile.email || "Team member",
                reaction
            }, { onConflict: "message_id,user_id" })
            .select("*")
            .single();

        if (error) {
            if (isMissingTableError(error)) {
                res.status(503).json({
                    error: "Chat reactions need the team_chat_reactions table. Run chat-upgrade.sql in Supabase, then retry."
                });
                return;
            }

            throw error;
        }

        res.json({ ok: true, reaction: data });
    } catch (error) {
        console.error("React to team chat failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not save reaction" });
    }
});

app.post("/api/team/chat/settings", async (req, res) => {
    try {
        const profile = await requireAdminProfile(req);
        await requireProPlan(profile);

        const { admin_only, allow_attachments } = req.body;

        const { data, error } = await supabaseAdmin
            .from("team_chat_settings")
            .upsert({
                business_id: profile.business_id,
                admin_only: Boolean(admin_only),
                allow_attachments: allow_attachments !== false,
                updated_by: profile.id,
                updated_at: new Date().toISOString()
            }, { onConflict: "business_id" })
            .select("*")
            .single();

        if (error) {
            throw error;
        }

        await logAudit(profile, "chat_settings_updated", "team_chat_settings", profile.business_id, {
            admin_only: Boolean(admin_only),
            allow_attachments: allow_attachments !== false
        });

        res.json({ ok: true, settings: data });
    } catch (error) {
        console.error("Update team chat settings failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not update chat settings" });
    }
});


app.post("/api/team/reps/:id/delete", async (req, res) => {
    try {
        const adminProfile = await requireAdminProfile(req);
        const repId = req.params.id;

        const { data: rep, error: repError } = await supabaseAdmin
            .from("profiles")
            .select("id, role, business_id, full_name, email")
            .eq("id", repId)
            .single();

        if (repError || !rep) {
            res.status(404).json({ error: "Rep not found" });
            return;
        }

        if (rep.business_id !== adminProfile.business_id || rep.role !== "rep") {
            res.status(403).json({ error: "You can only delete reps in your business" });
            return;
        }

        const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(repId);

        if (authError && !String(authError.message || "").toLowerCase().includes("not found")) {
            throw authError;
        }

        const { error: profileError } = await supabaseAdmin
            .from("profiles")
            .delete()
            .eq("id", repId)
            .eq("business_id", adminProfile.business_id)
            .eq("role", "rep");

        if (profileError) {
            throw profileError;
        }

        await logAudit(adminProfile, "rep_permanently_deleted", "profile", repId, {
            rep_name: rep.full_name,
            rep_email: rep.email
        });

        res.json({ ok: true });
    } catch (error) {
        console.error("Delete rep failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not delete rep" });
    }
});

app.post("/api/team/reps/:id/reactivate", async (req, res) => {
    try {
        const adminProfile = await requireAdminProfile(req);
        const repId = req.params.id;

        const { data: rep, error: repError } = await supabaseAdmin
            .from("profiles")
            .select("id, role, business_id")
            .eq("id", repId)
            .single();

        if (repError || !rep) {
            res.status(404).json({ error: "Rep not found" });
            return;
        }

        if (rep.business_id !== adminProfile.business_id || rep.role !== "rep") {
            res.status(403).json({ error: "You can only reactivate reps in your business" });
            return;
        }

        const { error } = await supabaseAdmin
            .from("profiles")
            .update({ is_active: true, status: "active", suspended_until: null })
            .eq("id", repId);

        if (error) throw error;

        await logAudit(adminProfile, "rep_reactivated", "profile", repId, {});
        res.json({ ok: true });
    } catch (error) {
        console.error("Reactivate rep failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not reactivate rep" });
    }
});

app.post("/api/team/reps/:id/deactivate", async (req, res) => {
    try {
        const adminProfile = await requireAdminProfile(req);
        const repId = req.params.id;
        const mode = req.body?.mode || "deactivate";
        const days = Number(req.body?.days || 0);

        const { data: rep, error: repError } = await supabaseAdmin
            .from("profiles")
            .select("id, role, business_id")
            .eq("id", repId)
            .single();

        if (repError || !rep) {
            res.status(404).json({ error: "Rep not found" });
            return;
        }

        if (rep.business_id !== adminProfile.business_id || rep.role !== "rep") {
            res.status(403).json({ error: "You can only deactivate reps in your business" });
            return;
        }

        const updates = mode === "suspend" && days > 0
            ? {
                is_active: true,
                status: "suspended",
                suspended_until: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
            }
            : {
                is_active: false,
                status: "inactive",
                suspended_until: null
            };

        const { error } = await supabaseAdmin
            .from("profiles")
            .update(updates)
            .eq("id", repId);

        if (error) {
            throw error;
        }

        await logAudit(adminProfile, "rep_deactivated", "profile", repId, {});

        res.json({ ok: true });
    } catch (error) {
        console.error("Deactivate rep failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not deactivate rep" });
    }
});



async function createBusinessForActiveAdmin(profile, ownerId = profile.id) {
    const businessName = profile.business_name
        || (profile.full_name ? `${profile.full_name}'s Business` : "Sales Tracker Business");

    const { data, error } = await supabaseAdmin
        .from("businesses")
        .insert({
            business_name: businessName,
            owner_id: ownerId,
            plan: profile.subscription_plan || "starter-monthly",
            subscription_status: profile.subscription_status || "active",
            subscription_expires_at: profile.subscription_expires_at || null,
            currency: profile.subscription_currency || "NGN",
            receipt_footer: DEFAULT_RECEIPT_FOOTER,
            low_stock_threshold: 5
        })
        .select("*")
        .single();

    if (error) throw error;

    return data;
}

async function migrateLegacyBusinessData(profile) {
    if (!profile?.business_id || profile.role !== "admin") return;

    const tables = ["products", "customers"];

    for (const table of tables) {
        const { error } = await supabaseAdmin
            .from(table)
            .update({ business_id: profile.business_id })
            .is("business_id", null);

        if (error && !isMissingTableError(error)) {
            console.warn(`Legacy ${table} migration skipped:`, error.message);
        }
    }
}

async function getOrCreateBusinessForProfile(profile) {
    const { data, error } = await supabaseAdmin
        .from("businesses")
        .select("*")
        .eq("id", profile.business_id)
        .maybeSingle();

    if (error) throw error;
    if (data) return data;

    const businessName = profile.business_name
        || (profile.full_name ? `${profile.full_name}'s Business` : "New Business");

    const { data: created, error: createError } = await supabaseAdmin
        .from("businesses")
        .insert({
            id: profile.business_id,
            business_name: businessName,
            owner_id: profile.role === "admin" ? profile.id : null,
            plan: profile.subscription_plan || "starter-monthly",
            subscription_status: profile.subscription_status || "active",
            subscription_expires_at: profile.subscription_expires_at || null,
            currency: profile.subscription_currency || "NGN",
            receipt_footer: DEFAULT_RECEIPT_FOOTER,
            low_stock_threshold: 5
        })
        .select("*")
        .maybeSingle();

    if (createError) throw createError;
    if (!created) throw new Error("Business record could not be created. Run business-id-repair.sql, then try again.");

    return created;
}
async function hasActiveBusinessSubscription(profile) {
    if (!profile?.business_id) return false;

    const profileActive = isActiveOrTrialing(profile);

    if (profileActive) return true;

    const { data: business } = await supabaseAdmin
        .from("businesses")
        .select("subscription_status, subscription_expires_at")
        .eq("id", profile.business_id)
        .maybeSingle();

    return isActiveOrTrialing(business);
}

async function logAudit(profile, action, targetType, targetId, details = {}) {
    if (!profile?.business_id) return;

    const { error } = await supabaseAdmin
        .from("audit_logs")
        .insert({
            business_id: profile.business_id,
            actor_id: profile.id,
            actor_name: profile.full_name || profile.email || "System",
            actor_role: profile.role || "system",
            action,
            target_type: targetType,
            target_id: targetId ? String(targetId) : null,
            details
        });

    if (error && !isMissingTableError(error)) {
        console.warn("Audit log failed:", error.message);
    }
}

async function logPlatformAudit(profile, action, targetType, targetId, details = {}) {
    const { error } = await supabaseAdmin
        .from("platform_audit_logs")
        .insert({
            actor_id: profile.id,
            actor_name: profile.full_name || profile.email || "Developer",
            action,
            target_type: targetType,
            target_id: targetId ? String(targetId) : null,
            details
        });

    if (error && !isMissingTableError(error)) {
        console.warn("Platform audit log failed:", error.message);
    }
}

function getExpiryDate(billingCycle) {
    const date = new Date();

    if (billingCycle === "yearly") {
        date.setFullYear(date.getFullYear() + 1);
    } else {
        date.setMonth(date.getMonth() + 1);
    }

    return date.toISOString();
}

function isDeveloperProfile(profile) {
    const role = String(profile?.role || "").toLowerCase();
    const platformRole = String(profile?.platform_role || "").toLowerCase();

    return profile?.is_platform_owner === true
        || ["developer", "super_admin", "platform_owner"].includes(role)
        || ["developer", "super_admin", "platform_owner"].includes(platformRole);
}

function getProfileDestination(profile) {
    if (isDeveloperProfile(profile)) return "developer.html";
    return profile?.role === "admin" ? "admin.html" : "dashboard.html";
}

async function requireDeveloperProfile(req) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token) {
        const error = new Error("Developer login required");
        error.status = 401;
        throw error;
    }

    const {
        data: { user },
        error: userError
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
        const error = new Error("Invalid developer login session");
        error.status = 401;
        throw error;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (profileError || !profile || !isDeveloperProfile(profile)) {
        const error = new Error("Platform owner access required");
        error.status = 403;
        throw error;
    }

    return profile;
}

async function requireAdminProfile(req) {
    const profile = await requireBusinessProfile(req);

    if (profile.role !== "admin" || !profile.business_id) {
        const error = new Error("Admin business access required");
        error.status = 403;
        throw error;
    }

    return profile;
}

async function requireBusinessProfile(req) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;

    if (!token) {
        const error = new Error("Login required");
        error.status = 401;
        throw error;
    }

    const {
        data: { user },
        error: userError
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
        const error = new Error("Invalid login session");
        error.status = 401;
        throw error;
    }

    const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
        const error = new Error("Profile not found");
        error.status = 404;
        throw error;
    }

    if (!profile.business_id) {
        const error = new Error("Business access required");
        error.status = 403;
        throw error;
    }

    if (profile.suspended_until && new Date(profile.suspended_until) > new Date()) {
        const error = new Error("Account is temporarily suspended");
        error.status = 403;
        throw error;
    }

    if (profile.is_active === false || profile.status === "inactive") {
        const error = new Error("Account is inactive");
        error.status = 403;
        throw error;
    }

    if (!(await hasActiveBusinessSubscription(profile))) {
        const error = new Error("Subscription is inactive or expired");
        error.status = 402;
        throw error;
    }

    return profile;
}

async function requireReportsPlan(profile) {
    if (getPlanLevel(profile.subscription_plan) >= PLAN_LEVELS.business) {
        return true;
    }

    const { data: business } = await supabaseAdmin
        .from("businesses")
        .select("plan")
        .eq("id", profile.business_id)
        .maybeSingle();

    if (getPlanLevel(business?.plan) >= PLAN_LEVELS.business) {
        return true;
    }

    const error = new Error("Reports are available on the Business plan and above");
    error.status = 402;
    throw error;
}

async function requireProPlan(profile) {
    if (getPlanLevel(profile.subscription_plan) >= PLAN_LEVELS.pro) {
        return true;
    }

    const { data: business } = await supabaseAdmin
        .from("businesses")
        .select("plan")
        .eq("id", profile.business_id)
        .maybeSingle();

    if (getPlanLevel(business?.plan) >= PLAN_LEVELS.pro) {
        return true;
    }

    const error = new Error("Team chat is available on the Pro plan");
    error.status = 402;
    throw error;
}

function getPlanKey(plan) {
    const normalized = String(plan || "").toLowerCase();

    if (normalized.includes("enterprise")) return "enterprise";
    if (normalized.includes("pro")) return "pro";
    if (normalized.includes("business")) return "business";
    if (normalized.includes("starter")) return "starter";

    return "starter";
}

function getPlanLevel(plan) {
    return PLAN_LEVELS[getPlanKey(plan)] || PLAN_LEVELS.starter;
}

function getRepLimit(profile) {
    return PLAN_REP_LIMITS[getPlanKey(profile?.subscription_plan)];
}

async function validatePaymentAmount({ plan, billingCycle, paidAmount }) {
    const planKey = getPlanKey(plan);

    if (planKey === "enterprise" || !DEFAULT_PLAN_PRICING[planKey]) {
        throw new Error("Invalid subscription plan");
    }

    const pricing = await loadPlatformPricing();
    const monthly = Number(pricing[planKey]?.monthly_ngn || DEFAULT_PLAN_PRICING[planKey].monthly_ngn);
    const expectedNgn = billingCycle === "yearly"
        ? Math.round(monthly * 11)
        : monthly;

    const expectedKobo = expectedNgn * 100;
    const actualKobo = Number(paidAmount || 0);

    if (!actualKobo || Math.abs(actualKobo - expectedKobo) > 100) {
        throw new Error("Payment amount does not match the selected plan. Please restart checkout.");
    }
}

function isMissingTableError(error) {
    const message = String(error?.message || "").toLowerCase();
    return error?.code === "42P01"
        || error?.code === "PGRST205"
        || message.includes("schema cache")
        || message.includes("could not find the table")
        || message.includes("does not exist");
}

async function ensureBusinessForOwner({ userId, plan, billingCycle, currency, reference }) {
    const expiresAt = getExpiryDate(billingCycle);

    const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

    if (profileError) {
        throw profileError;
    }

    let businessId = profile.business_id;

    if (!businessId) {
        const businessName =
            profile.business_name
            || (profile.full_name ? `${profile.full_name}'s Business` : "New Business");

        const { data: business, error: businessError } = await supabaseAdmin
            .from("businesses")
            .insert({
                business_name: businessName,
                owner_id: userId,
                plan: `${plan}-${billingCycle}`,
                subscription_status: "active",
                subscription_expires_at: expiresAt,
                currency: currency || profile.subscription_currency || "NGN",
                receipt_footer: DEFAULT_RECEIPT_FOOTER,
                low_stock_threshold: 5
            })
            .select("id")
            .single();

        if (businessError) {
            throw businessError;
        }

        businessId = business.id;
    } else {
        const { error: businessUpdateError } = await supabaseAdmin
            .from("businesses")
            .update({
                plan: `${plan}-${billingCycle}`,
                subscription_status: "active",
                subscription_expires_at: expiresAt,
                currency: currency || profile.subscription_currency || "NGN"
            })
            .eq("id", businessId);

        if (businessUpdateError) {
            throw businessUpdateError;
        }
    }

    return {
        businessId,
        expiresAt
    };
}

async function claimPaymentReference(payment) {
    const reference = String(payment?.reference || "").trim();

    if (!reference) {
        throw new Error("Paystack payment reference is missing");
    }

    const row = {
        reference,
        status: "processing",
        provider: "paystack",
        amount: Number(payment.amount || 0),
        currency: payment.currency || "NGN",
        user_id: payment.metadata?.user_id || null,
        plan: payment.metadata?.plan || "starter",
        billing_cycle: payment.metadata?.billing_cycle || "monthly",
        payload: payment,
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
        .from("payment_events")
        .insert(row)
        .select("*")
        .single();

    if (!error) {
        return { paymentEvent: data, alreadyActivated: false };
    }

    if (error.code !== "23505") {
        if (isMissingTableError(error)) {
            throw new Error("Payment hardening migration is missing. Run launch-hardening.sql in Supabase.");
        }

        throw error;
    }

    const { data: existing, error: existingError } = await supabaseAdmin
        .from("payment_events")
        .select("*")
        .eq("reference", reference)
        .single();

    if (existingError) throw existingError;

    if (existing.status === "activated") {
        return { paymentEvent: existing, alreadyActivated: true };
    }

    const updatedAt = new Date(existing.updated_at || existing.created_at || 0).getTime();
    const isRecentProcessing =
        existing.status === "processing"
        && Number.isFinite(updatedAt)
        && Date.now() - updatedAt < 2 * 60 * 1000;

    if (isRecentProcessing) {
        const error = new Error("Payment activation is already processing. Please try again shortly.");
        error.status = 409;
        throw error;
    }

    const { data: retryEvent, error: retryError } = await supabaseAdmin
        .from("payment_events")
        .update({ ...row, status: "processing" })
        .eq("reference", reference)
        .select("*")
        .single();

    if (retryError) throw retryError;

    return { paymentEvent: retryEvent, alreadyActivated: false };
}

async function markPaymentEvent(reference, status, details = {}) {
    const { error } = await supabaseAdmin
        .from("payment_events")
        .update({
            status,
            details,
            updated_at: new Date().toISOString()
        })
        .eq("reference", reference);

    if (error) {
        console.error("Payment event update failed:", error);
    }
}

async function getActivatedPaymentProfile(paymentEvent) {
    if (!paymentEvent?.user_id) return null;

    const { data } = await supabaseAdmin
        .from("profiles")
        .select("id, role, full_name, business_id, subscription_status, subscription_plan, subscription_expires_at")
        .eq("id", paymentEvent.user_id)
        .maybeSingle();

    return data || null;
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

    await validatePaymentAmount({
        plan,
        billingCycle,
        paidAmount: payment.amount
    });

    const { paymentEvent, alreadyActivated } = await claimPaymentReference(payment);

    if (alreadyActivated) {
        return await getActivatedPaymentProfile(paymentEvent);
    }

    const { businessId, expiresAt } = await ensureBusinessForOwner({
        userId,
        plan,
        billingCycle,
        currency,
        reference
    });

    const { error: teamSubscriptionError } = await supabaseAdmin
        .from("profiles")
        .update({
            subscription_status: "active",
            subscription_plan: `${plan}-${billingCycle}`,
            subscription_expires_at: expiresAt,
            subscription_billing_cycle: billingCycle,
            subscription_currency: currency
        })
        .eq("business_id", businessId);

    if (teamSubscriptionError) {
        throw teamSubscriptionError;
    }

    const { data: ownerProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, role, business_id")
        .eq("id", userId)
        .single();

    await logAudit({
        ...(ownerProfile || {}),
        id: userId,
        business_id: businessId,
        role: "admin"
    }, "subscription_activated", "business", businessId, {
        plan: plan + "-" + billingCycle,
        reference,
        currency
    });

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .update({
            role: "admin",
            business_id: businessId,
            subscription_status: "active",
            subscription_plan: `${plan}-${billingCycle}`,
            subscription_reference: reference,
            subscription_expires_at: expiresAt,
            subscription_billing_cycle: billingCycle,
            subscription_currency: currency,
            is_active: true,
            status: "active"
        })
        .eq("id", userId)
        .select("id, role, full_name, business_id, subscription_status, subscription_plan, subscription_expires_at")
        .single();

    if (error) {
        await markPaymentEvent(reference, "failed", { error: error.message });
        throw error;
    }

    await markPaymentEvent(reference, "activated", {
        business_id: businessId,
        user_id: userId,
        plan: `${plan}-${billingCycle}`
    });

    return data;
}

app.get("/api/developer/overview", async (req, res) => {
    try {
        await requireDeveloperProfile(req);

        const [
            businessesResult,
            profilesResult,
            customersResult,
            productsResult
        ] = await Promise.all([
            supabaseAdmin.from("businesses").select("*"),
            supabaseAdmin.from("profiles").select("*"),
            supabaseAdmin.from("customers").select("*"),
            supabaseAdmin.from("products").select("*")
        ]);

        for (const result of [businessesResult, profilesResult, customersResult, productsResult]) {
            if (result.error) throw result.error;
        }

        const businesses = businessesResult.data || [];
        const profiles = profilesResult.data || [];
        const customers = customersResult.data || [];
        const products = productsResult.data || [];

        const getBusinessStatus = business =>
            String(business.status || business.subscription_status || "").toLowerCase();

        const activeBusinesses = businesses.filter(business =>
            getBusinessStatus(business) === "active"
            && (!business.subscription_expires_at || new Date(business.subscription_expires_at) > new Date())
        );

        const suspendedBusinesses = businesses.filter(business =>
            getBusinessStatus(business) === "suspended"
        );

        const inactiveBusinesses = businesses.filter(business => {
            const status = getBusinessStatus(business);
            return status === "inactive" || status === "cancelled" || status === "expired";
        });

        const paidSales = customers.filter(sale => String(sale.status || "").toLowerCase() === "paid");
        const revenue = paidSales.reduce((sum, sale) => sum + Number(sale.final_price || sale.price || 0), 0);
        const lowStockProducts = products.filter(product => Number(product.stock_quantity || 0) <= 5).length;
        const planCounts = businesses.reduce((counts, business) => {
            const plan = getPlanKey(business.plan || "starter");
            counts[plan] = (counts[plan] || 0) + 1;
            return counts;
        }, {});

        const pricing = await loadPlatformPricing();
        const getPlanMonthlyAmount = business => {
            const plan = getPlanKey(business.plan || "starter");
            return Number(pricing[plan]?.monthly_ngn || DEFAULT_PLAN_PRICING[plan]?.monthly_ngn || 0);
        };
        const isYearlyPlan = business =>
            String(business.plan || "").toLowerCase().includes("yearly");
        const platformEarningsMrr = activeBusinesses.reduce((sum, business) => {
            const monthlyAmount = getPlanMonthlyAmount(business);
            return sum + (isYearlyPlan(business) ? Math.round((monthlyAmount * 11) / 12) : monthlyAmount);
        }, 0);
        const activeSubscriptionValue = activeBusinesses.reduce((sum, business) => {
            const monthlyAmount = getPlanMonthlyAmount(business);
            return sum + (isYearlyPlan(business) ? monthlyAmount * 11 : monthlyAmount);
        }, 0);

        res.json({
            metrics: {
                total_businesses: businesses.length,
                active_businesses: activeBusinesses.length,
                suspended_businesses: suspendedBusinesses.length,
                inactive_businesses: inactiveBusinesses.length,
                total_users: profiles.length,
                total_reps: profiles.filter(profile => profile.role === "rep").length,
                total_sales: customers.length,
                platform_earnings_mrr: platformEarningsMrr,
                active_subscription_value: activeSubscriptionValue,
                paid_revenue: revenue,
                total_products: products.length,
                low_stock_products: lowStockProducts
            },
            plan_counts: planCounts,
            recent_businesses: businesses
                .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
                .slice(0, 8)
        });
    } catch (error) {
        console.error("Developer overview failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load developer overview" });
    }
});

app.get("/api/developer/businesses", async (req, res) => {
    try {
        await requireDeveloperProfile(req);

        const { data: businesses, error } = await supabaseAdmin
            .from("businesses")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) throw error;

        const businessIds = (businesses || []).map(business => business.id);

        const [profilesResult, customersResult, productsResult] = await Promise.all([
            businessIds.length
                ? supabaseAdmin.from("profiles").select("*").in("business_id", businessIds)
                : { data: [], error: null },
            businessIds.length
                ? supabaseAdmin.from("customers").select("*").in("business_id", businessIds)
                : { data: [], error: null },
            businessIds.length
                ? supabaseAdmin.from("products").select("*").in("business_id", businessIds)
                : { data: [], error: null }
        ]);

        for (const result of [profilesResult, customersResult, productsResult]) {
            if (result.error) throw result.error;
        }

        const profiles = profilesResult.data || [];
        const customers = customersResult.data || [];
        const products = productsResult.data || [];

        const rows = (businesses || []).map(business => {
            const businessProfiles = profiles.filter(profile => profile.business_id === business.id);
            const businessSales = customers.filter(sale => sale.business_id === business.id);
            const paidRevenue = businessSales
                .filter(sale => String(sale.status || "").toLowerCase() === "paid")
                .reduce((sum, sale) => sum + Number(sale.final_price || sale.price || 0), 0);

            return {
                ...business,
                user_count: businessProfiles.length,
                rep_count: businessProfiles.filter(profile => profile.role === "rep").length,
                sale_count: businessSales.length,
                paid_revenue: paidRevenue,
                product_count: products.filter(product => product.business_id === business.id).length
            };
        });

        res.json({ businesses: rows });
    } catch (error) {
        console.error("Developer businesses failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load businesses" });
    }
});

app.post("/api/developer/businesses/:id/status", async (req, res) => {
    try {
        const developer = await requireDeveloperProfile(req);
        const businessId = req.params.id;
        const status = String(req.body?.status || "").toLowerCase();
        const planKey = req.body?.plan ? getPlanKey(req.body.plan) : "";
        const billingCycle = String(req.body?.billing_cycle || req.body?.billingCycle || "monthly").toLowerCase();
        const expiresAt = String(req.body?.subscription_expires_at || req.body?.expires_at || "").trim();

        if (!["active", "inactive", "suspended"].includes(status)) {
            res.status(400).json({ error: "Use active, inactive, or suspended" });
            return;
        }

        if (planKey && !["starter", "business", "pro", "enterprise"].includes(planKey)) {
            res.status(400).json({ error: "Use starter, business, pro, or enterprise plan" });
            return;
        }

        if (!["monthly", "yearly"].includes(billingCycle)) {
            res.status(400).json({ error: "Use monthly or yearly billing cycle" });
            return;
        }

        const subscriptionStatus = status === "active" ? "active" : "inactive";
        const updatePayload = {
            status,
            subscription_status: subscriptionStatus
        };

        if (planKey) {
            updatePayload.plan = `${planKey}-${billingCycle}`;
        }

        if (expiresAt) {
            updatePayload.subscription_expires_at = new Date(expiresAt).toISOString();
        }

        let { data: business, error } = await supabaseAdmin
            .from("businesses")
            .update(updatePayload)
            .eq("id", businessId)
            .select("*")
            .single();

        if (error && String(error.message || "").includes("status")) {
            const fallbackPayload = { ...updatePayload };
            delete fallbackPayload.status;

            const retry = await supabaseAdmin
                .from("businesses")
                .update(fallbackPayload)
                .eq("id", businessId)
                .select("*")
                .single();

            business = retry.data ? { ...retry.data, status } : null;
            error = retry.error;
        }

        if (error) throw error;
        if (business) business.status = business.status || status;

        await supabaseAdmin
            .from("profiles")
            .update({
                status: status === "active" ? "active" : "inactive",
                is_active: status === "active",
                subscription_status: subscriptionStatus,
                ...(planKey ? { subscription_plan: `${planKey}-${billingCycle}` } : {}),
                ...(expiresAt ? { subscription_expires_at: new Date(expiresAt).toISOString() } : {})
            })
            .eq("business_id", businessId);

        await logPlatformAudit(developer, "business_status_changed", "business", businessId, {
            status,
            plan: planKey ? `${planKey}-${billingCycle}` : undefined,
            subscription_expires_at: expiresAt || undefined
        });

        res.json({ ok: true, business });
    } catch (error) {
        console.error("Developer business status failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not update business status" });
    }
});

app.delete("/api/developer/businesses/:id", async (req, res) => {
    try {
        const developer = await requireDeveloperProfile(req);
        const businessId = req.params.id;
        const confirmation = String(req.body?.confirmation || "").trim().toUpperCase();

        if (confirmation !== "DELETE") {
            res.status(400).json({ error: "Type DELETE to confirm business deletion" });
            return;
        }

        const { data: business, error: businessLoadError } = await supabaseAdmin
            .from("businesses")
            .select("*")
            .eq("id", businessId)
            .maybeSingle();

        if (businessLoadError) throw businessLoadError;
        if (!business) {
            res.status(404).json({ error: "Business not found" });
            return;
        }

        const { data: businessProfiles, error: profileLoadError } = await supabaseAdmin
            .from("profiles")
            .select("id, email, role")
            .eq("business_id", businessId);

        if (profileLoadError) throw profileLoadError;

        const authUserIds = Array.from(new Set([
            ...(businessProfiles || []).map(profile => profile.id),
            business.owner_id
        ].filter(Boolean)));

        const cleanupTables = [
            "team_chat_reactions",
            "team_chat_messages",
            "team_chat_settings",
            "rep_invites",
            "audit_logs",
            "expenses",
            "customers",
            "products"
        ];

        for (const table of cleanupTables) {
            const { error } = await supabaseAdmin
                .from(table)
                .delete()
                .eq("business_id", businessId);

            if (error && !isMissingTableError(error)) {
                throw error;
            }
        }

        const { error: profileDeleteError } = await supabaseAdmin
            .from("profiles")
            .delete()
            .eq("business_id", businessId);

        if (profileDeleteError) throw profileDeleteError;

        const { error: businessDeleteError } = await supabaseAdmin
            .from("businesses")
            .delete()
            .eq("id", businessId);

        if (businessDeleteError) throw businessDeleteError;

        const authDeleteResults = [];

        for (const userId of authUserIds) {
            if (userId === developer.id) {
                authDeleteResults.push({ user_id: userId, skipped: true, reason: "developer_account" });
                continue;
            }

            const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
            authDeleteResults.push({
                user_id: userId,
                deleted: !authDeleteError,
                error: authDeleteError?.message || null
            });

            if (authDeleteError) {
                console.warn("Business auth user delete skipped:", userId, authDeleteError.message);
            }
        }

        await logPlatformAudit(developer, "business_deleted", "business", businessId, {
            business_name: business.business_name || business.name || "Unnamed business",
            auth_users: authDeleteResults
        });

        res.json({
            ok: true,
            deleted_business_id: businessId,
            auth_users_deleted: authDeleteResults.filter(result => result.deleted).length,
            auth_users_skipped: authDeleteResults.filter(result => !result.deleted).length
        });
    } catch (error) {
        console.error("Developer business delete failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not delete business" });
    }
});


app.get("/api/developer/pricing", async (req, res) => {
    try {
        await requireDeveloperProfile(req);
        const pricing = await loadPlatformPricing();
        res.json({ ok: true, pricing });
    } catch (error) {
        console.error("Developer pricing load failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load pricing" });
    }
});

app.post("/api/developer/pricing", async (req, res) => {
    try {
        const developer = await requireDeveloperProfile(req);
        const pricing = req.body?.pricing || {};
        const rows = ["starter", "business", "pro"].map(plan => {
            const amount = Number(pricing[plan]?.monthly_ngn || pricing[plan]?.monthlyNgn || DEFAULT_PLAN_PRICING[plan].monthly_ngn);
            return {
                plan_key: plan,
                name: DEFAULT_PLAN_PRICING[plan].name,
                monthly_ngn: Math.max(1, Math.round(amount)),
                updated_by: developer.id,
                updated_at: new Date().toISOString()
            };
        });

        const { error } = await supabaseAdmin
            .from("platform_pricing")
            .upsert(rows, { onConflict: "plan_key" });

        if (error) throw error;

        await logPlatformAudit(developer, "platform_pricing_updated", "pricing", "plans", { plans: rows });
        res.json({ ok: true, pricing: normalizePricingRows(rows) });
    } catch (error) {
        console.error("Developer pricing save failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not save pricing. Run developer-dashboard-upgrade.sql first." });
    }
});

app.get("/api/developer/activity", async (req, res) => {
    try {
        await requireDeveloperProfile(req);

        const { data, error } = await supabaseAdmin
            .from("platform_audit_logs")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(30);

        if (error) {
            if (isMissingTableError(error)) {
                res.json({ activity: [] });
                return;
            }

            throw error;
        }

        res.json({ activity: data || [] });
    } catch (error) {
        console.error("Developer activity failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load platform activity" });
    }
});


app.use(express.static(__dirname, {
    extensions: ["html"]
}));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "signin.html"));
});

app.listen(port, () => {
    console.log(`Sales Tracker running on http://localhost:${port}`);
    console.log(`Payment backend ready at http://localhost:${port}/api/health`);
});
