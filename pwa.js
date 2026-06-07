(function cleanupSalesTrackerPwaCache() {
  if (!("serviceWorker" in navigator)) return;
  if (window.location.protocol === "file:") return;

  async function clearCaches() {
    if (!("caches" in window)) return;

    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.toLowerCase().includes("sales-tracker"))
        .map(key => caches.delete(key))
    );
  }

  window.addEventListener("load", async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
      await clearCaches();

      if (navigator.serviceWorker.controller && !sessionStorage.getItem("salesTrackerSwCleared")) {
        sessionStorage.setItem("salesTrackerSwCleared", "1");
        window.location.reload();
      }
    } catch (error) {
      console.log("PWA cleanup failed:", error);
    }
  });
})();
