const { app, BrowserWindow, ipcMain, shell, screen, dialog, Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const { randomUUID } = require("node:crypto");
const OpenAI = require("openai");

// Keep development's Chromium cache and single-instance lock separate from the installed app.
// Otherwise launching `npm run dev` while Snoopy is already installed can attach to that
// running instance and immediately exit, with Chromium cache permission warnings on Windows.
if (process.env.NODE_ENV === "development") {
  app.setPath("userData", path.join(app.getPath("appData"), `${app.getName()}-development`));
}

let win;
let tray;
let isExiting = false;
let voiceProcess;
let voiceSession;
let dragTimer;
let selectedProjectDirectory = "";
const defaultSettings = { ollamaBaseUrl: "http://127.0.0.1:11434/v1", ollamaModel: "qwen3:1.7b", launchAtStartup: false };
let settings = { ...defaultSettings };
const windowBoundsPath = () => path.join(app.getPath("userData"), "snoopy-window.json");
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

function logOperationalError(scope, error) {
  // Store only error category/code. Never write chat, key, URL, or user file contents.
  const category = error?.status ? `http_${error.status}` : error?.code || error?.name || "unknown";
  const line = `${new Date().toISOString()} ${scope} ${String(category).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 60)}\n`;
  const logPath = path.join(app.getPath("logs"), "snoopy.log");
  fs.mkdir(path.dirname(logPath), { recursive: true }).then(() => fs.appendFile(logPath, line, "utf8")).catch(() => {});
}

function normalizeSettings(raw = {}) {
  const candidate = { ...defaultSettings, ...raw };
  const url = new URL(candidate.ollamaBaseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error("Ollama must use a local URL such as http://127.0.0.1:11434/v1.");
  }
  if (url.pathname.replace(/\/$/, "") !== "/v1") throw new Error("Ollama's API path should end in /v1.");
  const model = String(candidate.ollamaModel || "").trim();
  if (!/^[a-zA-Z0-9_.:/-]{1,120}$/.test(model)) throw new Error("Enter a valid local Ollama model name.");
  return { ollamaBaseUrl: url.toString().replace(/\/$/, ""), ollamaModel: model, launchAtStartup: candidate.launchAtStartup === true };
}

async function loadSettings() {
  try { settings = normalizeSettings(JSON.parse(await fs.readFile(settingsPath(), "utf8"))); }
  catch (error) {
    if (error.code !== "ENOENT") logOperationalError("settings-load", error);
    settings = { ...defaultSettings };
  }
}

function applyStartupSetting(enabled) {
  if (!app.isPackaged || process.platform !== "win32") return;
  app.setLoginItemSettings({ openAtLogin: enabled, enabled: true, path: process.execPath, name: "Snoopy" });
}

async function createWindow() {
  const width = 300;
  const height = 230;
  const margin = 16;
  let savedBounds = null;
  try { savedBounds = JSON.parse(await fs.readFile(windowBoundsPath(), "utf8")); } catch {}

  const display = savedBounds && Number.isFinite(savedBounds.x) && Number.isFinite(savedBounds.y)
    ? screen.getDisplayMatching({ x: savedBounds.x, y: savedBounds.y, width, height })
    : screen.getPrimaryDisplay();
  const area = display.workArea;
  const screenArea = display.bounds;
  const bounds = {
    width: Math.min(width, area.width),
    height: Math.min(height, area.height),
    x: Number.isFinite(savedBounds?.x) ? savedBounds.x : area.x + area.width - width - margin,
    y: Number.isFinite(savedBounds?.y) ? savedBounds.y : area.y + area.height - height - margin
  };
  // Restore saved placement against the full monitor so Snoopy can sit beside or
  // overlap the taskbar after the user deliberately drags him to a screen edge.
  bounds.x = Math.max(screenArea.x, Math.min(bounds.x, screenArea.x + screenArea.width - bounds.width));
  bounds.y = Math.max(screenArea.y, Math.min(bounds.y, screenArea.y + screenArea.height - bounds.height));

  win = new BrowserWindow({
    ...bounds, minWidth: 300, minHeight: 230,
    frame: false, transparent: true, backgroundColor: "#00000000", alwaysOnTop: true,
    // Keep the compact transparent pet canvas predictable; only chat mode resizes.
    resizable: false, roundedCorners: true,
    icon: app.isPackaged ? path.join(process.resourcesPath, "snoopy.ico") : path.join(__dirname, "../../build-resources/snoopy.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"), contextIsolation: true,
      nodeIntegration: false, sandbox: true
    }
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.webContents.on("did-fail-load", (_event, errorCode) => {
    logOperationalError(`window-load-${errorCode}`, Object.assign(new Error(), { code: `load_${errorCode}` }));
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    logOperationalError(`renderer-${details.reason}`, Object.assign(new Error(), { code: `renderer_${details.reason}` }));
  });
  win.webContents.on("console-message", (details) => {
    if (details.level >= 2) logOperationalError("renderer-console-error", new Error("renderer-console-error"));
  });
  win.on("close", (event) => {
    if (!isExiting) { event.preventDefault(); win.hide(); }
  });
  let saveTimer;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      fs.writeFile(windowBoundsPath(), JSON.stringify(win.getBounds()), "utf8").catch(() => {});
    }, 250);
  };
  win.on("move", saveBounds);
  win.on("resize", saveBounds);
  win.on("closed", () => { clearTimeout(saveTimer); win = null; });
  try {
    if (!app.isPackaged && process.env.NODE_ENV === "development") await win.loadURL("http://127.0.0.1:5173");
    else await win.loadFile(path.join(__dirname, "../../dist/index.html"));
  } catch (error) {
    logOperationalError("window-load", error);
    throw error;
  }
}

function showWindow() {
  if (!win || win.isDestroyed()) { void createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus(); win.setAlwaysOnTop(true, "floating");
}

function showSettingsWindow() {
  showWindow();
  if (!win?.webContents) return;
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", () => win?.webContents.send("snoopy:showSettings"));
  else win.webContents.send("snoopy:showSettings");
}

function createTray() {
  if (tray) return;
  const iconPath = app.isPackaged ? path.join(process.resourcesPath, "snoopy.ico") : path.join(__dirname, "../../build-resources/snoopy.ico");
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip("Snoopy — desktop companion");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Snoopy", click: showWindow },
    { label: "Hide Snoopy", click: () => win?.hide() },
    { type: "separator" },
    { label: "Settings", click: showSettingsWindow },
    { type: "separator" },
    { label: "Exit Snoopy", click: () => { isExiting = true; app.quit(); } }
  ]));
  tray.on("double-click", showWindow);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(async () => {
    app.setAppUserModelId("com.snoopy.desktop");
    await loadSettings();
    applyStartupSetting(settings.launchAtStartup);
    await createWindow();
    createTray();
  }).catch((error) => { logOperationalError("startup", error); app.quit(); });
}
app.on("before-quit", () => { isExiting = true; if (dragTimer) clearInterval(dragTimer); if (voiceProcess) voiceProcess.kill(); if (tray) { tray.destroy(); tray = null; } });

function isMainWindow(event) { return BrowserWindow.fromWebContents(event.sender) === win; }

ipcMain.handle("snoopy:getSettings", (event) => {
  if (!isMainWindow(event)) throw new Error("Settings request is not allowed.");
  return { ...settings, startupSupported: app.isPackaged && process.platform === "win32", appVersion: app.getVersion() };
});

ipcMain.handle("snoopy:saveSettings", async (event, requested) => {
  if (!isMainWindow(event) || !requested || typeof requested !== "object") throw new Error("Settings request is not allowed.");
  const next = normalizeSettings(requested);
  if (next.launchAtStartup && (!app.isPackaged || process.platform !== "win32")) {
    throw new Error("Enable Windows startup from the installed Snoopy app; it isn't available in development mode.");
  }
  applyStartupSetting(next.launchAtStartup);
  await fs.writeFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  settings = next;
  return { ...settings, startupSupported: app.isPackaged && process.platform === "win32", appVersion: app.getVersion() };
});

ipcMain.handle("snoopy:testOllama", async (event, requested) => {
  if (!isMainWindow(event)) throw new Error("Ollama test request is not allowed.");
  const candidate = normalizeSettings({ ...settings, ...requested });
  const client = new OpenAI({ apiKey: "ollama-local", baseURL: candidate.ollamaBaseUrl, maxRetries: 0, timeout: 8000 });
  try {
    const result = await client.models.list();
    const models = result.data.map((model) => model.id).slice(0, 40);
    return { connected: true, modelAvailable: models.includes(candidate.ollamaModel), model: candidate.ollamaModel, models };
  } catch (error) {
    logOperationalError("ollama-test", error);
    const detail = `${error?.message || ""} ${error?.cause?.code || ""}`.toLowerCase();
    if (detail.includes("econnrefused") || detail.includes("fetch failed") || detail.includes("connect")) {
      return { connected: false, modelAvailable: false, message: "Couldn't connect to Ollama. Open the Ollama app and try again." };
    }
    return { connected: false, modelAvailable: false, message: "Ollama responded with an error. Check the local URL and model settings." };
  }
});

const tools = [
  { type: "function", function: { name: "search_web", description: "Prepare a web search and ask the user before opening it in their browser.", parameters: { type: "object", properties: { query: { type: "string", description: "Search terms" } }, required: ["query"], additionalProperties: false } } },
  { type: "function", function: { name: "open_website", description: "Prepare to open a website and ask the user first.", parameters: { type: "object", properties: { url: { type: "string", description: "Full http or https URL" } }, required: ["url"], additionalProperties: false } } },
  { type: "function", function: { name: "open_application", description: "Prepare to open or switch to an allowlisted Windows application. Always ask the user to approve.", parameters: { type: "object", properties: { app: { type: "string", enum: ["chrome", "visual_studio_code", "command_prompt", "notepad", "calculator"] } }, required: ["app"], additionalProperties: false } } },
  { type: "function", function: { name: "close_application", description: "Prepare to politely close an allowlisted app. The user must approve; unsaved-work dialogs remain under the app's control.", parameters: { type: "object", properties: { app: { type: "string", enum: ["chrome", "visual_studio_code", "command_prompt", "notepad", "calculator"] } }, required: ["app"], additionalProperties: false } } },
  { type: "function", function: { name: "open_project", description: "Prepare to open the user-selected project folder in Visual Studio Code. Ask for approval.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "open_project_terminal", description: "Prepare to open Command Prompt in the user-selected project folder. Ask for approval.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "run_project_tests", description: "Prepare to run the selected project's npm test script. Always ask for approval and show the output.", parameters: { type: "object", properties: {}, additionalProperties: false } } },
  { type: "function", function: { name: "open_windows_settings", description: "Prepare to open a built-in Windows Settings page. Ask the user before opening it.", parameters: { type: "object", properties: { page: { type: "string", enum: ["system", "display", "sound", "network", "windows_update"] } }, required: ["page"], additionalProperties: false } } },
  { type: "function", function: { name: "save_note", description: "Prepare a plain text note for the user to approve before it is saved in their Documents folder.", parameters: { type: "object", properties: { title: { type: "string" }, content: { type: "string" } }, required: ["title", "content"], additionalProperties: false } } }
];

function makeAction(name, rawArguments) {
  let args;
  try { args = JSON.parse(rawArguments); } catch { return null; }
  if (name === "open_chrome" && args && typeof args === "object" && Object.keys(args).length === 0) {
    return { id: randomUUID(), name, arguments: {} };
  }
  const allowedApps = ["chrome", "visual_studio_code", "command_prompt", "notepad", "calculator"];
  if (name === "open_application" && allowedApps.includes(args.app)) {
    return { id: randomUUID(), name, arguments: { app: args.app } };
  }
  if (name === "close_application" && allowedApps.includes(args.app)) {
    return { id: randomUUID(), name, arguments: { app: args.app } };
  }
  if (["open_project", "open_project_terminal", "run_project_tests"].includes(name) && args && typeof args === "object" && Object.keys(args).length === 0) {
    return { id: randomUUID(), name, arguments: {} };
  }
  if (name === "search_web" && typeof args.query === "string" && args.query.trim() && args.query.length <= 300) {
    return { id: randomUUID(), name, arguments: { query: args.query.trim() } };
  }
  if (name === "open_website" && typeof args.url === "string" && args.url.length <= 2048) {
    try {
      const url = new URL(args.url);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password)
        return { id: randomUUID(), name, arguments: { url: url.toString() } };
    } catch { return null; }
  }
  if (name === "open_windows_settings" && ["system", "display", "sound", "network", "windows_update"].includes(args.page)) {
    return { id: randomUUID(), name, arguments: { page: args.page } };
  }
  if (name === "save_note" && typeof args.title === "string" && typeof args.content === "string" && args.title.trim() && args.content.trim() && args.title.length <= 120 && args.content.length <= 12000) {
    return { id: randomUUID(), name, arguments: { title: args.title.trim(), content: args.content.trim() } };
  }
  return null;
}

async function launchChrome() {
  return launchWindowsApp("chrome");
}

const appLabels = { chrome: "Chrome", visual_studio_code: "Visual Studio Code", command_prompt: "Command Prompt", notepad: "Notepad", calculator: "Calculator" };
async function launchWindowsApp(appName, { projectDirectory = "" } = {}) {
  if (process.platform !== "win32") throw new Error("Opening Windows apps is only available on Windows.");
  if (!Object.hasOwn(appLabels, appName)) throw new Error("That application is not in Snoopy's allowlist.");
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const candidates = appName === "chrome"
    ? [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean).map((root) => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
    : appName === "visual_studio_code"
      ? [
          path.join(process.env.LOCALAPPDATA || "", "Programs", "Microsoft VS Code", "Code.exe"),
          path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft VS Code", "Code.exe"),
          path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft VS Code", "Code.exe")
        ]
      : appName === "command_prompt"
        ? [path.join(systemRoot, "System32", "cmd.exe")]
        : appName === "notepad"
          ? [path.join(systemRoot, "System32", "notepad.exe")]
          : [path.join(systemRoot, "System32", "calc.exe")];
  let executable;
  for (const candidate of candidates) {
    try { await fs.access(candidate); executable = candidate; break; } catch { /* Try the next standard install location. */ }
  }
  if (!executable) throw new Error(`${appLabels[appName]} wasn't found in its standard Windows install location.`);
  await new Promise((resolve, reject) => {
    const args = appName === "visual_studio_code" && projectDirectory ? [projectDirectory] : [];
    const child = spawn(executable, args, { cwd: projectDirectory || undefined, detached: true, stdio: "ignore", windowsHide: false });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
  });
  return { message: `Started ${appLabels[appName]}.` };
}

async function requestCloseWindowsApp(appName) {
  if (process.platform !== "win32" || !Object.hasOwn(appLabels, appName)) throw new Error("That application cannot be closed by Snoopy.");
  const processNames = { chrome: "chrome", visual_studio_code: "Code", command_prompt: "cmd", notepad: "notepad", calculator: "CalculatorApp" };
  const target = processNames[appName];
  const script = `$source = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class SnoopyWindowCloser {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr window, IntPtr extra);
  public static int CloseByProcess(string name) {
    int sent = 0;
    EnumWindows((window, extra) => { uint pid; GetWindowThreadProcessId(window, out pid); if (pid == 0) return true;
      try { if (String.Equals(Process.GetProcessById((int)pid).ProcessName, name, StringComparison.OrdinalIgnoreCase) && PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero)) sent++; } catch {}
      return true; }, IntPtr.Zero);
    return sent;
  }
}
'@; Add-Type -TypeDefinition $source; [SnoopyWindowCloser]::CloseByProcess('${target}')`;
  const { stdout = "" } = await new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve({ stdout }) : reject(new Error(stderr.trim() || "Windows could not request the app to close.")));
  });
  const count = Number(stdout.trim());
  if (!count) return { message: `I couldn't find an open ${appLabels[appName]} window.` };
  return { message: `Asked ${appLabels[appName]} to close. It may ask you to save unsaved work.` };
}

ipcMain.handle("snoopy:chat", async (event, history, requestId) => {
  if (!isMainWindow(event)) throw new Error("Chat request is not allowed.");
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId) || !Array.isArray(history) || history.length > 50 || history.some((m) => !m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 8000)) {
    throw new Error("The chat history is invalid or too long.");
  }
  const baseURL = settings.ollamaBaseUrl;
  const model = settings.ollamaModel;
  const client = new OpenAI({ apiKey: "ollama-local", baseURL, maxRetries: 0, timeout: 120000 });
  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are Snoopy, a friendly black-and-white robot puppy desktop companion. /no_think Answer promptly in 1–3 concise sentences and ask at most one question; if you need clarification, ask one question and wait. You may propose these approved actions: open or close Chrome, Visual Studio Code, Command Prompt, Notepad, or Calculator; open the selected project or its terminal; run that project's npm test; search the web; open a website or Windows Settings page; save a note. Tool calls only propose actions and require user approval. Never claim an action succeeded until confirmed. Closing an app may show its save prompt. Never run generated shell commands, control arbitrary apps, or inspect unselected files." },
        // Keep the visible transcript in the UI, but send only the recent turns
        // to the model so token prefill stays quick as a chat grows.
        ...history.slice(-16)
      ],
      tools, tool_choice: "auto", temperature: 0.5, max_tokens: 240, reasoning_effort: "none", stream: true
    });
    let reply = "";
    const toolCalls = new Map();
    for await (const chunk of response) {
      const delta = chunk.choices?.[0]?.delta;
      if (typeof delta?.content === "string" && delta.content) {
        reply += delta.content;
        if (!event.sender.isDestroyed()) event.sender.send("snoopy:chatChunk", { requestId, text: delta.content });
      }
      for (const item of delta?.tool_calls || []) {
        let call = toolCalls.get(item.index);
        if (!call) { call = { id: "", type: "function", function: { name: "", arguments: "" } }; toolCalls.set(item.index, call); }
        call.id += item.id || "";
        call.function.name += item.function?.name || "";
        call.function.arguments += item.function?.arguments || "";
      }
    }
    response = { choices: [{ message: { content: reply, tool_calls: [...toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call) } }] };
  } catch (error) {
    logOperationalError("ollama-chat", error);
    const detail = `${error?.message || ""} ${error?.cause?.code || ""}`.toLowerCase();
    if (detail.includes("econnrefused") || detail.includes("fetch failed") || detail.includes("connect")) {
      throw new Error(`Snoopy can't reach Ollama. Open the Ollama app and make sure the ${model} model is installed.`);
    }
    if (error?.status === 404 || detail.includes("model") && detail.includes("not found")) {
      throw new Error(`The local model ${model} isn't installed. In PowerShell, run: ollama pull ${model}`);
    }
    throw new Error(error?.message || "The local model couldn't answer. Check that Ollama is running.");
  }
  const message = response.choices?.[0]?.message;
  const actions = (message?.tool_calls || []).map((call) => makeAction(call.function.name, call.function.arguments)).filter(Boolean);
  let reply = message?.content || (actions.length ? "I can do that. Please review the action below." : "I'm here! What would you like help with?");
  if (!actions.length && /\b(?:is open|opened|i have launched|i launched)\b/i.test(reply)) {
    reply = "I haven't opened anything yet. Ask me to open Chrome, Visual Studio Code, or Command Prompt and review the action card.";
  }
  return { reply, actions };
});

ipcMain.handle("snoopy:approveAction", async (event, action) => {
  if (!isMainWindow(event)) throw new Error("Action approval request is not allowed.");
  if (!action || typeof action !== "object") throw new Error("This action is invalid.");
  const verified = makeAction(action.name, JSON.stringify(action.arguments));
  if (!verified) throw new Error("This action is not allowed or its details are invalid.");
  if (action.name === "open_chrome") {
    return launchWindowsApp("chrome");
  }
  if (action.name === "open_application") {
    return launchWindowsApp(verified.arguments.app);
  }
  if (action.name === "close_application") {
    return requestCloseWindowsApp(verified.arguments.app);
  }
  if (action.name === "open_project") {
    if (!selectedProjectDirectory) throw new Error("Choose your project folder first using the Set project folder button.");
    return launchWindowsApp("visual_studio_code", { projectDirectory: selectedProjectDirectory });
  }
  if (action.name === "open_project_terminal") {
    if (!selectedProjectDirectory) throw new Error("Choose your project folder first using the Set project folder button.");
    await new Promise((resolve, reject) => {
      const child = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"), [], { cwd: selectedProjectDirectory, detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); });
    });
    return { message: `Opened Command Prompt in ${selectedProjectDirectory}.` };
  }
  if (action.name === "run_project_tests") {
    if (!selectedProjectDirectory) throw new Error("Choose your project folder first using the Set project folder button.");
    const output = await new Promise((resolve, reject) => {
      const child = spawn("cmd.exe", ["/d", "/s", "/c", "npm test"], { cwd: selectedProjectDirectory, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      let text = "";
      const append = (chunk) => { text = (text + chunk.toString()).slice(-24000); };
      child.stdout.on("data", append); child.stderr.on("data", append);
      const timeout = setTimeout(() => child.kill(), 120000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal, text: text.trim() });
      });
    });
    const status = output.signal ? `stopped (${output.signal})` : `finished with exit code ${output.code}`;
    return { message: `npm test ${status}.${output.text ? `\n\n${output.text}` : "\n\nNo output was produced."}` };
  }
  if (action.name === "open_website") {
    await shell.openExternal(verified.arguments.url);
    return { message: `Opened ${new URL(verified.arguments.url).host} in your browser.` };
  }
  if (action.name === "search_web") {
    const url = `https://www.google.com/search?q=${encodeURIComponent(verified.arguments.query)}`;
    await shell.openExternal(url);
    return { message: `Opened a web search for “${verified.arguments.query}”.` };
  }
  if (action.name === "open_windows_settings") {
    const labels = { system: "System", display: "Display", sound: "Sound", network: "Network & internet", windows_update: "Windows Update" };
    const page = verified.arguments.page;
    await shell.openExternal(`ms-settings:${page === "system" ? "about" : page === "network" ? "network" : page === "windows_update" ? "windowsupdate" : page}`);
    return { message: `Opened Windows Settings: ${labels[page]}.` };
  }
  const notesDir = path.join(app.getPath("documents"), "Snoopy Companion Notes");
  await fs.mkdir(notesDir, { recursive: true });
  const safeTitle = verified.arguments.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "").slice(0, 100) || "Note";
  const notePath = path.join(notesDir, `${safeTitle}-${Date.now()}.txt`);
  await fs.writeFile(notePath, `${verified.arguments.title}\n\n${verified.arguments.content}\n`, { encoding: "utf8", flag: "wx" });
  return { message: `Saved your note in Documents\\Snoopy Companion Notes\\${path.basename(notePath)}.` };
});

ipcMain.handle("snoopy:voiceCommand", async (event, command) => {
  if (!isMainWindow(event)) throw new Error("Voice command request is not allowed.");
  const voiceApps = { open_chrome: "chrome", open_visual_studio_code: "visual_studio_code", open_command_prompt: "command_prompt", open_notepad: "notepad", open_calculator: "calculator" };
  const appName = voiceApps[command];
  if (!appName) throw new Error("That voice command isn't available yet.");
  return launchWindowsApp(appName);
});

ipcMain.handle("snoopy:startVoiceListener", async (event, sessionId) => {
  if (process.platform !== "win32") throw new Error("Voice commands in this starter are available on Windows.");
  if (BrowserWindow.fromWebContents(event.sender) !== win) throw new Error("Voice listener request is not allowed.");
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 100) throw new Error("Voice listener session is invalid.");
  if (voiceProcess) { voiceSession = sessionId; return { started: true }; }
  const voiceRoot = app.isPackaged ? path.join(process.resourcesPath, "voice") : path.join(__dirname, "../..");
  const python = app.isPackaged
    ? path.join(voiceRoot, "python", "python.exe")
    : path.join(voiceRoot, ".voice-env", "Scripts", "python.exe");
  const listenerScript = app.isPackaged ? path.join(voiceRoot, "voice-listener.py") : path.join(__dirname, "voice-listener.py");
  const modelPath = app.isPackaged ? path.join(voiceRoot, "model") : path.join(voiceRoot, "models", "vosk-model-small-en-in-0.4");
  const child = spawn(python, [listenerScript], { env: { ...process.env, SNOOPY_VOSK_MODEL: modelPath }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  voiceProcess = child;
  voiceSession = sessionId;
  const sender = event.sender;
  const output = readline.createInterface({ input: child.stdout });
  let ready = false;
  let reportedError = false;
  const startupOutput = [];
  output.on("line", (line) => {
    const transcript = line.trim();
    if (transcript === "__SNOOPY_READY__") { ready = true; sender.send("snoopy:voiceStatus", { listening: true }); }
    else if (transcript.startsWith("__SNOOPY_LANGUAGE__")) sender.send("snoopy:voiceStatus", { recognizerLanguage: transcript.slice("__SNOOPY_LANGUAGE__".length) });
    else if (transcript === "__SNOOPY_SPEECH__") sender.send("snoopy:voiceStatus", { speechDetected: true });
    else if (transcript.startsWith("__SNOOPY_PARTIAL__")) sender.send("snoopy:voicePartial", transcript.slice("__SNOOPY_PARTIAL__".length));
    else if (transcript.startsWith("__SNOOPY_FINAL__")) sender.send("snoopy:voiceTranscript", transcript.slice("__SNOOPY_FINAL__".length));
    else if (transcript.startsWith("__SNOOPY_LEVEL__")) {
      const level = Number(transcript.slice("__SNOOPY_LEVEL__".length));
      if (Number.isFinite(level)) sender.send("snoopy:voiceLevel", Math.max(0, Math.min(100, level)));
    }
    else if (transcript.startsWith("__SNOOPY_ERROR__")) {
      reportedError = true;
      sender.send("snoopy:voiceStatus", { error: transcript.slice("__SNOOPY_ERROR__".length) });
    } else if (!ready && transcript) startupOutput.push(transcript);
  });
  let errorOutput = "";
  child.stderr.on("data", (chunk) => { errorOutput += chunk.toString(); });
  child.once("error", (error) => { if (!sender.isDestroyed()) sender.send("snoopy:voiceStatus", { error: error.message }); });
  child.once("exit", (code) => {
    const wasCurrent = voiceProcess === child;
    if (wasCurrent) { voiceProcess = null; voiceSession = null; }
    if (wasCurrent && !sender.isDestroyed()) {
      if ((!ready || code !== 0) && !reportedError) {
        const message = errorOutput.trim().split(/\r?\n/).find(Boolean) || startupOutput.join(" ").slice(0, 240);
        sender.send("snoopy:voiceStatus", { error: message || "Offline speech recognition stopped. Run npm run setup:voice, then restart Snoopy." });
      } else if (ready) sender.send("snoopy:voiceStatus", { stopped: true });
    }
  });
  return { started: true };
});

ipcMain.handle("snoopy:stopVoiceListener", (event, sessionId) => {
  if (BrowserWindow.fromWebContents(event.sender) !== win) return false;
  if (voiceProcess && sessionId === voiceSession) { voiceProcess.kill(); voiceProcess = null; voiceSession = null; }
  return true;
});

ipcMain.handle("snoopy:window", (event, action) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow !== win || !["minimize", "close"].includes(action)) return;
  if (action === "minimize") senderWindow.minimize();
  if (action === "close") senderWindow.close();
});

ipcMain.handle("snoopy:windowMode", (event, expanded) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow !== win || typeof expanded !== "boolean") return false;
  if (expanded) senderWindow.setResizable(true);
  senderWindow.setSize(expanded ? 410 : 300, expanded ? 680 : 230, false);
  if (!expanded) senderWindow.setResizable(false);
  return true;
});

ipcMain.handle("snoopy:beginWindowDrag", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow !== win || senderWindow.isDestroyed()) return false;
  if (dragTimer) clearInterval(dragTimer);
  const start = screen.getCursorScreenPoint();
  const origin = senderWindow.getBounds();
  dragTimer = setInterval(() => {
    if (senderWindow.isDestroyed()) { clearInterval(dragTimer); dragTimer = null; return; }
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).bounds;
    const [width, height] = senderWindow.getSize();
    const x = Math.max(area.x, Math.min(origin.x + cursor.x - start.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(origin.y + cursor.y - start.y, area.y + area.height - height));
    senderWindow.setPosition(Math.round(x), Math.round(y), false);
  }, 16);
  return true;
});

ipcMain.handle("snoopy:endWindowDrag", (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow !== win) return false;
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
  return true;
});

ipcMain.handle("snoopy:chooseProjectFolder", async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow !== win) return { canceled: true };
  const result = await dialog.showOpenDialog(senderWindow, { title: "Choose Snoopy's project folder", properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  selectedProjectDirectory = path.resolve(result.filePaths[0]);
  return { canceled: false, path: selectedProjectDirectory };
});

// Let the compact desktop pet hop to a new visible spot on the current monitor.
ipcMain.handle("snoopy:hopWindow", async (event) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow || senderWindow !== win || senderWindow.isDestroyed()) return false;
  const [width, height] = senderWindow.getSize();
  if (width > 300 || height > 260) return false;

  const bounds = senderWindow.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  let targetX = bounds.x;
  let targetY = bounds.y;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    targetX = Math.round(area.x + Math.random() * Math.max(0, area.width - width));
    targetY = Math.round(area.y + Math.random() * Math.max(0, area.height - height));
    if (Math.hypot(targetX - bounds.x, targetY - bounds.y) > Math.min(area.width, area.height) * 0.22) break;
  }
  targetX = Math.max(area.x, Math.min(targetX, maxX));
  targetY = Math.max(area.y, Math.min(targetY, maxY));

  const duration = 950;
  const started = Date.now();
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (senderWindow.isDestroyed()) { clearInterval(timer); resolve(); return; }
      const progress = Math.min(1, (Date.now() - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const x = Math.round(bounds.x + (targetX - bounds.x) * eased);
      const arc = Math.sin(progress * Math.PI) * 72;
      const y = Math.round(bounds.y + (targetY - bounds.y) * eased - arc);
      senderWindow.setPosition(x, Math.max(area.y, y), false);
      if (progress >= 1) { clearInterval(timer); senderWindow.setPosition(targetX, targetY, false); resolve(); }
    }, 16);
  });
  return true;
});
