const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const liveAppUrl = process.env.SALES_TRACKER_DESKTOP_URL || "https://use-sales-tracker.vercel.app/signin.html";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "Sales Tracker",
    backgroundColor: "#07111f",
    icon: path.join(__dirname, "img", "sales-tracker.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  win.webContents.on("did-finish-load", () => {
    win.webContents.setZoomFactor(1);
  });

  win.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const isZoomShortcut = (input.control || input.meta) && ["+", "-", "=", "0"].includes(key);

    if (isZoomShortcut) {
      event.preventDefault();
      win.webContents.setZoomFactor(1);
    }
  });

  win.loadFile(path.join(__dirname, "loading.html"));

  setTimeout(() => {
    win.loadURL(liveAppUrl);
  }, 650);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://use-sales-tracker.vercel.app") || url.startsWith("https://sales-tracker-app-cd7k.onrender.com")) {
      return { action: "allow" };
    }

    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
