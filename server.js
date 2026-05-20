import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
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

        const profileActive =
            String(profile.subscription_status || profile.status || "").toLowerCase() === "active"
            && (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

        const businessActive =
            String(business?.subscription_status || business?.status || "").toLowerCase() === "active"
            && (!business?.subscription_expires_at || new Date(business.subscription_expires_at) > new Date());

        if (business && businessActive) {
            const updates = {
                business_id: business.id,
                subscription_status: "active",
                subscription_plan: business.plan || profile.subscription_plan || "starter-monthly",
                subscription_expires_at: business.subscription_expires_at || profile.subscription_expires_at || null,
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

            if (updateError) throw updateError;
            profile = updatedProfile;

            res.json({
                ok: true,
                access: "active",
                destination: profile.role === "admin" ? "admin.html" : "dashboard.html",
                profile
            });
            return;
        }

        if (profile.business_id && profileActive && profile.is_active !== false && profile.status !== "inactive") {
            res.json({
                ok: true,
                access: "active",
                destination: profile.role === "admin" ? "admin.html" : "dashboard.html",
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

app.post("/api/team/reps", async (req, res) => {
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
            .select("id, full_name, email, role, business_id, is_active, status, subscription_status, subscription_plan, subscription_expires_at")
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

        res.json({
            ok: true,
            business
        });
    } catch (error) {
        console.error("Load business failed:", error);
        res.status(error.status || 500).json({ error: error.message || "Could not load business" });
    }
});


app.post("/api/team/business/settings", async (req, res) => {
    try {
        const profile = await requireAdminProfile(req);
        const businessName = String(req.body.business_name || "").trim();
        const currency = String(req.body.currency || "NGN").trim().toUpperCase();
        const receiptFooter = String(req.body.receipt_footer || DEFAULT_RECEIPT_FOOTER).trim();
        const lowStockThreshold = Number(req.body.low_stock_threshold || 5);

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
            currency
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

app.post("/api/team/reps/:id/deactivate", async (req, res) => {
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
            res.status(403).json({ error: "You can only deactivate reps in your business" });
            return;
        }

        const { error } = await supabaseAdmin
            .from("profiles")
            .update({
                is_active: false,
                status: "inactive"
            })
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

    const profileActive = profile.subscription_status === "active"
        && (!profile.subscription_expires_at || new Date(profile.subscription_expires_at) > new Date());

    if (profileActive) return true;

    const { data: business } = await supabaseAdmin
        .from("businesses")
        .select("subscription_status, subscription_expires_at")
        .eq("id", profile.business_id)
        .maybeSingle();

    return business?.subscription_status === "active"
        && (!business.subscription_expires_at || new Date(business.subscription_expires_at) > new Date());
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

function getExpiryDate(billingCycle) {
    const date = new Date();

    if (billingCycle === "yearly") {
        date.setFullYear(date.getFullYear() + 1);
    } else {
        date.setMonth(date.getMonth() + 1);
    }

    return date.toISOString();
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
                subscription_expires_at: expiresAt
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
                subscription_expires_at: expiresAt
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
        throw error;
    }

    return data;
}

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


