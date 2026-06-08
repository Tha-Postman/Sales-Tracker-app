(function setupSalesTrackerAppShell() {
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

    window.addEventListener("load", hideLoader, { once: true });
    window.setTimeout(hideLoader, 3500);

    document.addEventListener("gesturestart", preventIosZoom, { passive: false });
    document.addEventListener("gesturechange", preventIosZoom, { passive: false });
    document.addEventListener("gestureend", preventIosZoom, { passive: false });
})();
