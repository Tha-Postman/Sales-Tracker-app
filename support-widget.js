(function(){
    const supportEmail = "thapostmancde@outlook.com";
    const answers = [
        {
            keys: ["plan", "pricing", "price", "subscription", "starter", "business", "pro", "enterprise"],
            answer: "Plans are Starter, Business, Pro, and Enterprise. Starter is for small teams, Business adds more reps and management tools, Pro unlocks team chat and advanced workflow features, and Enterprise is for larger/custom teams. You can switch monthly or yearly on the pricing page."
        },
        {
            keys: ["pay", "payment", "paystack", "subscribe", "access", "activate"],
            answer: "After payment, Sales Tracker activates the business account, makes the payer the admin, and unlocks the dashboards. If access does not update, refresh once and make sure the backend is running with npm run dev."
        },
        {
            keys: ["admin", "rep", "team", "add rep", "sales rep", "deactivate"],
            answer: "Admins can add reps from the Admin Dashboard under Team. Each rep gets their own login, and admins can deactivate reps when needed. Sales are linked to the business and the rep who created them."
        },
        {
            keys: ["product", "stock", "inventory", "low stock", "restock"],
            answer: "Admins add products from the Admin Dashboard. Reps select products while recording sales. Low stock alerts help the business know what needs to be restocked."
        },
        {
            keys: ["sale", "cart", "receipt", "record", "customer", "print"],
            answer: "To record a sale, open the Sales Dashboard, choose a product, quantity, payment mode, and status, add it to cart, then click Add Sale. You can print a receipt from the customer history card."
        },
        {
            keys: ["offline", "online", "network", "sync"],
            answer: "Sales Tracker supports offline saving. If the network drops, sales can be saved locally and synced when the connection returns. Watch the Online/Offline indicator in the sales dashboard."
        },
        {
            keys: ["chat", "message", "announcement", "pro"],
            answer: "Team chat is a Pro feature. Admins can let everyone chat or switch to admin-only announcements. Reps can react to messages as acknowledgement."
        },
        {
            keys: ["login", "signin", "password", "account"],
            answer: "If login fails, confirm the email and password. Admin accounts need an active subscription and reps must be added by their business admin. Use the password option inside the dashboard to change your password."
        },
        {
            keys: ["dashboard", "admin dashboard", "sales dashboard", "not loading", "blank", "stuck", "refresh"],
            answer: "If a dashboard does not load, first refresh the page once. Admins should confirm the business subscription is active, backend service is online, and the account role is admin. Reps should confirm their admin has not deactivated or suspended their account."
        },
        {
            keys: ["currency", "naira", "dollar", "usd", "ngn", "receipt currency"],
            answer: "Admins can set the business currency from Admin Dashboard > Settings. That currency is used for product prices, sales totals, dashboard stats, and receipts."
        },
        {
            keys: ["import", "csv", "excel", "bulk", "many products", "upload products"],
            answer: "Admins can bulk add products from Admin Dashboard > Products. Download the template, fill product name, price, stock, and optional image URL, then upload the CSV or Excel file."
        },
        {
            keys: ["image", "product image", "upload image", "crop", "photo", "picture"],
            answer: "Admins can upload product images while adding or editing products. Use Auto fit when you want the full product visible, or Crop section when you want a close-up."
        },
        {
            keys: ["report", "reports", "export", "excel", "docx", "backup"],
            answer: "Admins can export sales reports and business backups from the Admin Dashboard. Some reporting features are available on Business plan and above, while deeper workflow tools are available on Pro."
        },
        {
            keys: ["stock reduce", "stock reducing", "inventory tracking", "sold", "left"],
            answer: "When a sale is saved, Sales Tracker reduces product stock automatically. Admin inventory cards show initial stock, sold quantity, stock left, and latest stock movement where available."
        },
        {
            keys: ["ios", "iphone", "bookmark", "home screen", "desktop app", "exe", "install"],
            answer: "You can use Sales Tracker from the browser, install it to an iPhone home screen, or use the Windows desktop app. Open the Install App page for the latest setup steps."
        },
        {
            keys: ["security", "safe", "data", "privacy", "card", "payment details"],
            answer: "Sales Tracker separates each business workspace and uses role-based access. Payments are processed by Paystack, so Sales Tracker does not store card numbers."
        }
    ];

    const quickTopics = [
        ["Choosing a plan", "Which plan should I choose?"],
        ["Payment issue", "My payment or access is not working"],
        ["Add sales rep", "How do I add a sales rep?"],
        ["Record sale", "How do I record a sale?"],
        ["Products/stock", "How do products and stock work?"],
        ["Talk to support", "I want to talk to customer care"]
    ];

    function createWidget(){
        if(document.getElementById("supportWidget")) return;

        const launcher = document.createElement("button");
        launcher.className = "support-launcher";
        launcher.type = "button";
        launcher.innerHTML = '<span class="support-pulse"></span><i class="fa-solid fa-headset"></i><span>Support</span>';
        launcher.addEventListener("click", openSupport);

        const widget = document.createElement("section");
        widget.id = "supportWidget";
        widget.className = "support-widget";
        widget.setAttribute("aria-label", "Sales Tracker support chat");
        widget.innerHTML = [
            '<div class="support-head">',
                '<div class="support-agent">',
                    '<span class="support-avatar"><img src="img/sales-tracker-icon.png" alt="Sales Tracker Care"></span>',
                    '<div><strong>Sales Tracker Care</strong><span>Online help desk</span></div>',
                '</div>',
                '<button class="support-close" type="button" aria-label="Close support"><i class="fa-solid fa-xmark"></i></button>',
            '</div>',
            '<div class="support-body" id="supportBody"></div>',
            '<form class="support-foot" id="supportForm">',
                '<input class="support-input" id="supportInput" autocomplete="off" placeholder="Ask about plans, payment, reps, sales...">',
                '<button class="support-send" type="submit" aria-label="Send"><i class="fa-solid fa-paper-plane"></i></button>',
            '</form>'
        ].join("");

        document.body.append(widget, launcher);
        widget.querySelector(".support-close").addEventListener("click", closeSupport);
        widget.querySelector("#supportForm").addEventListener("submit", event => {
            event.preventDefault();
            const input = widget.querySelector("#supportInput");
            const value = input.value.trim();
            if(!value) return;
            input.value = "";
            askSupport(value);
        });
    }

    function openSupport(){
        const widget = document.getElementById("supportWidget");
        const body = document.getElementById("supportBody");
        widget.classList.add("open");

        if(!body.dataset.started){
            body.dataset.started = "true";
            addBot("Hi, welcome to Sales Tracker. I can help with plans, payments, setup, adding reps, products, sales, receipts, or dashboard issues. What do you need help with?");
            addQuickTopics();
        }

        setTimeout(() => document.getElementById("supportInput")?.focus(), 100);
    }

    function closeSupport(){
        document.getElementById("supportWidget")?.classList.remove("open");
    }

    function addMessage(text, type){
        const body = document.getElementById("supportBody");
        const message = document.createElement("div");
        message.className = "support-message " + type;
        message.textContent = text;
        body.appendChild(message);
        body.scrollTop = body.scrollHeight;
    }

    function addBot(text){ addMessage(text, "bot"); }
    function addUser(text){ addMessage(text, "user"); }

    function addQuickTopics(){
        const body = document.getElementById("supportBody");
        const wrap = document.createElement("div");
        wrap.className = "support-quick";

        quickTopics.forEach(([label, prompt]) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.addEventListener("click", () => askSupport(prompt));
            wrap.appendChild(button);
        });

        body.appendChild(wrap);
        body.scrollTop = body.scrollHeight;
    }

    function askSupport(question){
        addUser(question);

        if(question.toLowerCase().includes("talk to support") || question.toLowerCase().includes("customer care") || question.toLowerCase().includes("human")){
            showEnquiry();
            return;
        }

        const normalized = question.toLowerCase();
        const match = answers.find(item => item.keys.some(key => normalized.includes(key)));

        setTimeout(() => {
            addBot(match ? match.answer : "I can help with plans, payment, dashboard access, adding reps, products, recording sales, receipts, offline sync, and team chat. If you want a human reply, choose Talk to support.");
            addQuickTopics();
        }, 260);
    }

    function showEnquiry(){
        const body = document.getElementById("supportBody");
        const card = document.createElement("form");
        card.className = "support-enquiry";
        card.innerHTML = [
            '<strong>Send an enquiry</strong>',
            '<input name="name" placeholder="Your name" required>',
            '<input name="email" type="email" placeholder="Your email" required>',
            '<textarea name="message" placeholder="What do you need help with?" required></textarea>',
            '<button type="submit">Send email to support</button>'
        ].join("");

        card.addEventListener("submit", event => {
            event.preventDefault();
            const data = new FormData(card);
            const subject = encodeURIComponent("Sales Tracker support enquiry");
            const message = encodeURIComponent(
                "Name: " + data.get("name") + "\n" +
                "Email: " + data.get("email") + "\n\n" +
                data.get("message")
            );
            window.location.href = "mailto:" + supportEmail + "?subject=" + subject + "&body=" + message;
            addBot("Your email app should open with the enquiry ready to send to Sales Tracker support. If it does not open, send your message directly to " + supportEmail + ".");
        });

        body.appendChild(card);
        body.scrollTop = body.scrollHeight;
    }

    window.openSupportChat = openSupport;

    document.addEventListener("DOMContentLoaded", createWidget);
})();


