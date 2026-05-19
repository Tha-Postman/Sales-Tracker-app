(function(){
    const supportEmail = "olaniyanoluwatobi01@gmail.com";
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
                    '<span class="support-avatar"><i class="fa-solid fa-headset"></i></span>',
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
            '<button type="submit">Open email to support</button>'
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
        });

        body.appendChild(card);
        body.scrollTop = body.scrollHeight;
    }

    window.openSupportChat = openSupport;

    document.addEventListener("DOMContentLoaded", createWidget);
})();


