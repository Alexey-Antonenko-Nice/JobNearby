const path = require("node:path");
const { app, BrowserWindow, dialog } = require("electron");

app.setName("Job Nearby");

const dataRoot = process.env.JOB_NEARBY_APP_DATA_DIR
  ? path.resolve(process.env.JOB_NEARBY_APP_DATA_DIR)
  : process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "JobNearby")
    : path.join(app.getPath("appData"), "JobNearby");
app.setPath("userData", dataRoot);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let runtime;
  let mainWindow;
  let closing = false;

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const uiDirectory = path.resolve(__dirname, "..", "ui", "dist");
    const serverModule = path.resolve(__dirname, "..", "dist", "infrastructure", "http", "startJobNearbyServer.js");
    if (!require("node:fs").existsSync(uiDirectory) || !require("node:fs").existsSync(serverModule)) {
      throw new Error("Built application files are missing. Run the desktop build before launching Job Nearby.");
    }
    const { startJobNearbyServer } = require(serverModule);
    runtime = await startJobNearbyServer({
      host: "127.0.0.1",
      port: 0,
      extensionCapturePort: 4317,
      applicationDataRoot: dataRoot,
      ...(process.env.JOB_NEARBY_DOCUMENT_DATA_DIR
        ? { documentDataDir: process.env.JOB_NEARBY_DOCUMENT_DATA_DIR }
        : {}),
      uiDistDirectory: uiDirectory,
    });
    process.stdout.write(`Job Nearby desktop server listening at ${runtime.url}\n`);
    mainWindow = new BrowserWindow({
      title: "Job Nearby",
      width: 1280,
      height: 850,
      minWidth: 900,
      minHeight: 650,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.on("closed", () => { mainWindow = undefined; });
    await mainWindow.loadURL(runtime.url);
  }).catch(error => {
    console.error("Job Nearby desktop startup failed.", error);
    dialog.showErrorBox("Job Nearby could not start", error instanceof Error ? error.message : String(error));
    app.quit();
  });

  app.on("activate", () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", event => {
    if (!runtime || closing) return;
    event.preventDefault();
    closing = true;
    void runtime.close().then(
      () => app.exit(0),
      error => {
        console.error("Job Nearby shutdown failed.", error);
        app.exit(1);
      },
    );
  });
}
