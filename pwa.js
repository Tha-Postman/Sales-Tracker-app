(function registerSalesTrackerPwa() {
  if (!("serviceWorker" in navigator)) return;
  if (window.location.protocol === "file:") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => {
      console.log("PWA registration failed:", error);
    });
  });
})();
