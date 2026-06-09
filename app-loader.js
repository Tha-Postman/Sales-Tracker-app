(function setupSalesTrackerAppShell() {
    const refreshThreshold = 86;
    let pullStartY = 0;
    let pullDistance = 0;
    let pullActive = false;
    let pullReady = false;
    let refreshIndicator;

    function hideLoader() {
        if (!document.body) return;

        document.body.classList.add("app-loaded");

        window.setTimeout(() => {
            document.getElementById("appLoadingScreen")?.remove();
        }, 450);
    }

    function preventIosZoom(event) {
        event.preventDefault();
    }

    function isIosDevice() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function isStandaloneApp() {
        return window.matchMedia("(display-mode: standalone)").matches ||
            window.navigator.standalone === true;
    }

    function isInteractiveTarget(target) {
        return Boolean(target?.closest?.("input, textarea, select, button, a, label, [role='button'], .modal, .chat-messages, .customer-database-list, .expense-list, .audit-log-list, .rep-grid, .business-tools-grid, .panel-body, #liveSalesFeed"));
    }

    function getIndicator() {
        if (refreshIndicator) return refreshIndicator;

        refreshIndicator = document.createElement("div");
        refreshIndicator.className = "app-pull-refresh";
        refreshIndicator.innerHTML = '<span></span><strong>Pull to refresh</strong>';
        refreshIndicator.style.cssText = [
            "position:fixed",
            "left:50%",
            "top:calc(10px + env(safe-area-inset-top))",
            "z-index:100000",
            "display:flex",
            "align-items:center",
            "gap:8px",
            "padding:10px 14px",
            "border:1px solid rgba(125,211,252,.24)",
            "border-radius:999px",
            "color:#e0f2fe",
            "background:rgba(2,6,23,.88)",
            "box-shadow:0 18px 42px rgba(0,0,0,.34)",
            "backdrop-filter:blur(16px)",
            "font:800 12px/1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
            "opacity:0",
            "pointer-events:none",
            "transform:translate(-50%,-18px) scale(.96)",
            "transition:opacity .18s ease, transform .18s ease"
        ].join(";");

        const dot = refreshIndicator.querySelector("span");
        dot.style.cssText = [
            "width:10px",
            "height:10px",
            "border-radius:999px",
            "background:linear-gradient(135deg,#3b82f6,#14b8a6)",
            "box-shadow:0 0 0 6px rgba(56,189,248,.12)"
        ].join(";");

        document.body.appendChild(refreshIndicator);
        return refreshIndicator;
    }

    function setIndicator(distance, ready, refreshing) {
        const indicator = getIndicator();
        const progress = Math.min(distance / refreshThreshold, 1);
        const y = Math.round(-18 + progress * 34);

        indicator.style.opacity = String(Math.min(0.35 + progress, 1));
        indicator.style.transform = `translate(-50%, ${y}px) scale(${0.96 + progress * 0.04})`;
        indicator.querySelector("strong").textContent = refreshing
            ? "Refreshing..."
            : ready
                ? "Release to refresh"
                : "Pull to refresh";
    }

    function hideIndicator() {
        if (!refreshIndicator) return;
        refreshIndicator.style.opacity = "0";
        refreshIndicator.style.transform = "translate(-50%, -18px) scale(.96)";
    }

    function setupPullToRefresh() {
        if (!isIosDevice() || !isStandaloneApp()) return;

        document.addEventListener("touchstart", event => {
            if (window.scrollY > 0 || isInteractiveTarget(event.target)) return;
            pullStartY = event.touches[0]?.clientY || 0;
            pullDistance = 0;
            pullActive = true;
            pullReady = false;
        }, { passive: true });

        document.addEventListener("touchmove", event => {
            if (!pullActive || window.scrollY > 0) return;

            const currentY = event.touches[0]?.clientY || 0;
            pullDistance = Math.max(0, currentY - pullStartY);

            if (pullDistance < 18) return;

            event.preventDefault();
            pullReady = pullDistance >= refreshThreshold;
            setIndicator(pullDistance, pullReady, false);
        }, { passive: false });

        document.addEventListener("touchend", () => {
            if (!pullActive) return;

            const shouldRefresh = pullReady;
            pullActive = false;
            pullReady = false;

            if (shouldRefresh) {
                setIndicator(refreshThreshold, true, true);
                window.setTimeout(() => window.location.reload(), 180);
            } else {
                hideIndicator();
            }
        }, { passive: true });
    }

    window.addEventListener("load", hideLoader, { once: true });
    window.setTimeout(hideLoader, 3500);

    document.addEventListener("gesturestart", preventIosZoom, { passive: false });
    document.addEventListener("gesturechange", preventIosZoom, { passive: false });
    document.addEventListener("gestureend", preventIosZoom, { passive: false });
    setupPullToRefresh();
})();
