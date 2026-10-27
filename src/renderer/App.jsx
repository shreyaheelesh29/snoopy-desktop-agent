import { useEffect, useRef, useState } from "react";

const starters = ["Help me plan my day", "Search the web for something", "Save a note for me"];
const appLabels = { chrome: "Chrome", visual_studio_code: "Visual Studio Code", command_prompt: "Command Prompt", notepad: "Notepad", calculator: "Calculator" };
const appGlyphs = { chrome: "🌐", visual_studio_code: "<> ", command_prompt: ">_", notepad: "▤", calculator: "＋" };

function parseAppCommand(text) {
  const normalized = text.trim().toLowerCase().replace(/[.!?,]/g, " ").replace(/\s+/g, " ").trim();
  const command = normalized
    .replace(/^(?:(?:hi|hey|hello)\s+)?snoopy\s+/, "")
    .replace(/\s+(?:hi|hey|hello)?\s*snoopy$/, "")
    .trim();
  const match = command.match(/^(?:(?:please)\s+)?(?:(?:can|could|will)\s+(?:you|u)\s+)?(open|launch|start|close|quit|exit)\s+(?:the\s+)?(google\s+chrome|chrome(?:\s+browser)?|visual\s+studio\s+code|vs\s+code|vscode|code|command\s+prompt|cmd(?:\.exe)?|notepad|calculator|calc)$/i);
  if (!match) return null;
  const operation = ["close", "quit", "exit"].includes(match[1].toLowerCase()) ? "close" : "open";
  const name = match[2].replace(/\s+/g, " ").toLowerCase();
  if (["google chrome", "chrome", "chrome browser"].includes(name)) return { operation, app: "chrome" };
  if (["visual studio code", "vs code", "vscode", "code"].includes(name)) return { operation, app: "visual_studio_code" };
  if (["command prompt", "cmd", "cmd.exe"].includes(name)) return { operation, app: "command_prompt" };
  if (name === "notepad") return { operation, app: "notepad" };
  return { operation, app: "calculator" };
}

const spriteFrames = {
  idle: "0% 0%", happy: "33.333% 0%", thinking: "66.667% 0%", speaking: "100% 0%",
  working: "0% 100%", walking: "33.333% 100%", sleeping: "66.667% 100%", excited: "100% 100%"
};

function Puppy({ mood, compact = false, onWake, onPointerDown, onPointerUp, onPointerCancel }) {
  // Use the excited sprite while hopping, but keep the mood class so the hop animation runs.
  const pose = mood === "hopping" ? "excited" : spriteFrames[mood] ? mood : "idle";
  return <div
    className={`puppy ${mood}${compact ? " compact-puppy" : ""}`}
    role="img"
    aria-label={`Snoopy is ${pose}`}
    style={{
      backgroundImage: `url("${import.meta.env.BASE_URL}character/snoopy-emotions.png")`,
      backgroundPosition: spriteFrames[pose]
    }}
    onPointerDown={onPointerDown}
    onPointerUp={onPointerUp}
    onPointerCancel={onPointerCancel}
    onClick={onWake}
    title="Drag Snoopy to move him; double-click anywhere on him to wake him"
  />;
}

function ActionCard({ action, onApprove, onDismiss, busy }) {
  const details = action.name === "save_note"
    ? `Save “${action.arguments.title}” in Snoopy Companion Notes?\n\n${action.arguments.content}`
    : action.name === "search_web"
      ? `Search the web for “${action.arguments.query}” in your browser?`
      : action.name === "open_chrome"
        ? "Open Chrome on this PC?"
      : action.name === "open_application"
        ? `Open ${appLabels[action.arguments.app]} on this PC?`
      : action.name === "close_application"
        ? `Ask ${appLabels[action.arguments.app]} to close? It may ask you to save unsaved work.`
      : action.name === "open_project"
        ? "Open your selected project folder in Visual Studio Code?"
      : action.name === "open_project_terminal"
        ? "Open Command Prompt in your selected project folder?"
      : action.name === "run_project_tests"
        ? "Run npm test in your selected project folder? Snoopy will show the result."
      : action.name === "open_windows_settings"
        ? `Open Windows Settings to ${({ system: "System", display: "Display", sound: "Sound", network: "Network & internet", windows_update: "Windows Update" })[action.arguments.page]}?`
      : `Open this website in your browser?\n${action.arguments.url}`;
  return <div className="action-card">
    <div className="action-kicker">Snoopy WOULD LIKE TO</div>
    <p>{details}</p>
    <div className="action-buttons">
      <button className="approve" disabled={busy} onClick={() => onApprove(action)}>Allow</button>
      <button className="dismiss" disabled={busy} onClick={() => onDismiss(action.id)}>Dismiss</button>
    </div>
  </div>;
}

export default function App() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm Snoopy, your little robot pup. I can chat, open Chrome, Visual Studio Code, Command Prompt, Notepad, or Calculator, search the web, and save notes. I'll ask before changing anything. 🐾" }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mood, setMood] = useState("idle");
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({ ollamaBaseUrl: "http://127.0.0.1:11434/v1", ollamaModel: "qwen3:1.7b", launchAtStartup: false, startupSupported: false, appVersion: "" });
  const [settingsStatus, setSettingsStatus] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [bubbleText, setBubbleText] = useState("Need a paw?");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voice off");
  const [voiceLevel, setVoiceLevel] = useState(0);
  const [launchTarget, setLaunchTarget] = useState(null);
  const [projectDirectory, setProjectDirectory] = useState("");
  const listRef = useRef(null);
  const voiceHandler = useRef(null);
  const wakePendingUntil = useRef(0);
  const lastVoiceActionAt = useRef(0);
  const lastPuppyClickAt = useRef(0);
  const pendingVoiceInputs = useRef([]);

  function startPuppyDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void window.snoopyAPI.beginWindowDrag();
  }

  function endPuppyDrag() {
    void window.snoopyAPI.endWindowDrag();
  }

  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, busy]);
  useEffect(() => window.snoopyAPI.onOpenSettings(() => { void openSettings(); }), []);
  useEffect(() => {
    if (busy || mood !== "idle") return undefined;
    const timer = setTimeout(() => setMood("sleeping"), 60000);
    return () => clearTimeout(timer);
  }, [busy, mood]);

  function setChatExpanded(next) {
    setExpanded(next);
    if (next) setMood("idle");
    window.snoopyAPI.setWindowMode(next).catch((error) => {
      setBubbleText(error?.message || "I couldn't resize Snoopy's window.");
    });
  }

  function wakeSnoopy(event) {
    const now = Date.now();
    if (now - lastPuppyClickAt.current > 500) {
      lastPuppyClickAt.current = now;
      return;
    }
    lastPuppyClickAt.current = 0;
    event.preventDefault();
    setMood("happy");
    setBubbleText("I'm awake! Need anything? 🐾");
    window.setTimeout(() => setMood((current) => current === "happy" ? "idle" : current), 1100);
  }

  async function openSettings() {
    setChatExpanded(true);
    setSettingsBusy(true);
    setSettingsStatus("");
    try {
      const current = await window.snoopyAPI.getSettings();
      setSettingsDraft(current);
      setSettingsOpen(true);
    } catch (error) {
      setSettingsStatus(error?.message || "Couldn't load Snoopy settings.");
    } finally { setSettingsBusy(false); }
  }

  async function testOllama() {
    setSettingsBusy(true);
    setSettingsStatus("Checking the local Ollama connection…");
    try {
      const result = await window.snoopyAPI.testOllama(settingsDraft);
      if (!result.connected) setSettingsStatus(result.message);
      else if (!result.modelAvailable) setSettingsStatus(`Connected to Ollama, but ${result.model} isn't installed. In PowerShell, run: ollama pull ${result.model}`);
      else setSettingsStatus(`Connected. ${result.model} is ready.`);
    } catch (error) { setSettingsStatus(error?.message || "Couldn't test Ollama."); }
    finally { setSettingsBusy(false); }
  }

  async function saveSettings() {
    setSettingsBusy(true);
    setSettingsStatus("Saving settings…");
    try {
      const saved = await window.snoopyAPI.saveSettings(settingsDraft);
      setSettingsDraft(saved);
      setSettingsStatus("Settings saved.");
    } catch (error) { setSettingsStatus(error?.message || "Couldn't save settings."); }
    finally { setSettingsBusy(false); }
  }

  function toggleVoice() {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    setVoiceStatus(next ? "Starting microphone…" : "Voice off");
    if (next) setMood("idle");
  }

  async function chooseProjectFolder() {
    try {
      const result = await window.snoopyAPI.chooseProjectFolder();
      if (!result.canceled) {
        setProjectDirectory(result.path);
        setBubbleText(`Project folder set to ${result.path}`);
      }
    } catch (error) {
      setBubbleText(error?.message || "I couldn't choose that project folder.");
    }
  }

  async function send(text = input) {
    const content = text.trim();
    if (!content || busy) return;
    const requestedApp = parseAppCommand(content);
    if (requestedApp) {
      const action = { id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: requestedApp.operation === "close" ? "close_application" : "open_application", arguments: { app: requestedApp.app } };
      setInput("");
      const reply = requestedApp.operation === "close" ? `I can ask ${appLabels[requestedApp.app]} to close. Review the action below.` : `I can open ${appLabels[requestedApp.app]}. Review the action below.`;
      setMessages((old) => [...old, { role: "user", content }, { role: "assistant", content: reply }, { role: "action", action }]);
      setBubbleText(reply); setMood("idle");
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const next = [...messages, { role: "user", content }];
    setInput("");
    setMessages([...next, { role: "assistant", content: "", streaming: true, requestId }]);
    setBusy(true); setMood("thinking"); setBubbleText("Thinking it through…");
    const removeChunks = window.snoopyAPI.onChatChunk(({ requestId: incomingId, text: chunk }) => {
      if (incomingId !== requestId || typeof chunk !== "string") return;
      setMessages((old) => old.map((message) => message.requestId === requestId ? { ...message, content: message.content + chunk } : message));
      setMood("speaking");
    });
    try {
      const result = await window.snoopyAPI.chat(next.filter((m) => ["user", "assistant"].includes(m.role)).map(({ role, content }) => ({ role, content })), requestId);
      const reply = result.reply || "I have a plan ready for you.";
      setMessages((old) => [...old.map((message) => message.requestId === requestId ? { role: "assistant", content: reply } : message), ...(result.actions || []).map((action) => ({ role: "action", action }))]);
      if (result.actions?.length) setChatExpanded(true);
      setBubbleText(reply || (result.actions?.length ? "I have a plan ready for you." : "Need a paw?"));
      setMood(result.actions?.length ? "thinking" : "speaking");
      if (!result.actions?.length) setTimeout(() => setMood("idle"), 1600);
    } catch (error) {
      setMessages((old) => [...old.map((message) => message.requestId === requestId ? { role: "assistant", content: error?.message || "Sorry, something went wrong. Check that Ollama is running." } : message)]);
      setBubbleText(error?.message || "I couldn't do that just now.");
      setMood("idle");
    } finally { removeChunks(); setBusy(false); }
  }

  useEffect(() => {
    if (busy || pendingVoiceInputs.current.length === 0) return;
    const nextSentence = pendingVoiceInputs.current.shift();
    void send(nextSentence);
  }, [busy]);

  async function approve(action) {
    const app = action.name === "open_application" ? action.arguments.app : null;
    setBusy(true); setMood(app ? "hopping" : "working");
    if (app) {
      setLaunchTarget({ app, phase: "approach" });
      setBubbleText(`Hopping to ${appLabels[app]}…`);
    }
    try {
      if (app) {
        const windowHop = expanded ? Promise.resolve(false) : window.snoopyAPI.hopWindow().catch(() => false);
        await Promise.all([windowHop, new Promise((resolve) => setTimeout(resolve, 1000))]);
        setLaunchTarget({ app, phase: "clicked" });
        setBubbleText(`Tap! Opening ${appLabels[app]}…`);
      }
      const result = await window.snoopyAPI.approveAction(action);
      setMessages((old) => old.map((m) => m.action?.id === action.id ? { role: "assistant", content: result.message } : m));
      setBubbleText(result.message);
      setMood("excited"); setTimeout(() => setMood("idle"), 2000);
    } catch (error) {
      setMessages((old) => [...old, { role: "assistant", content: error?.message || "That action could not be completed." }]);
      setBubbleText(error?.message || "That action couldn't be completed.");
      setMood("idle");
    } finally { if (app) setLaunchTarget(null); setBusy(false); }
  }

  function dismiss(id) {
    setMessages((old) => old.map((m) => m.action?.id === id ? { role: "assistant", content: "Okay, I left that action alone." } : m));
    setMood("idle");
  }

  voiceHandler.current = async (transcript) => {
    const heard = transcript.trim().replace(/[.!?,]/g, " ").replace(/\s+/g, " ");
    if (!heard) return;
    const wake = heard.match(/^(?:(?:hi|hey|hello)\s+)?snoopy(?:\s|$)(.*)$/i);
    const trailingWake = heard.match(/^(.*?)\s+(?:(?:hi|hey|hello)\s+)?snoopy$/i);
    let command;
    if (wake) {
      command = wake[1].trim();
      if (!command) {
        wakePendingUntil.current = Date.now() + 8000;
        setInput("");
        setMessages((old) => [...old, { role: "user", content: heard }, { role: "assistant", content: "Hi! I'm here. What can I help you with?" }]);
        setBubbleText("Hi! I'm here. What can I help you with?");
        setMood("excited");
        setTimeout(() => setMood("idle"), 1600);
        return;
      }
    } else if (trailingWake && trailingWake[1].trim()) command = trailingWake[1].trim();
    else if (Date.now() < wakePendingUntil.current) command = heard;
    else {
      // The recognizer emits a final transcript after the speaker pauses.
      // Treat that sentence just like text typed into the composer and submit it.
      if (busy) {
        pendingVoiceInputs.current.push(heard);
        setBubbleText("I heard you. I'll send that as soon as I'm ready.");
        return;
      }
      setInput(heard);
      void send(heard);
      return;
    }
    if (busy) { setBubbleText("One moment, I'm finishing something."); return; }
    wakePendingUntil.current = 0;
    const requestedApp = parseAppCommand(command);
    if (!requestedApp) { send(command); return; }
    if (Date.now() - lastVoiceActionAt.current < 2500) return;
    lastVoiceActionAt.current = Date.now();
    wakePendingUntil.current = 0;
    if (requestedApp.operation === "close") {
      const action = { id: `close-${Date.now()}`, name: "close_application", arguments: { app: requestedApp.app } };
      const reply = `I can ask ${appLabels[requestedApp.app]} to close. Review the action in chat.`;
      setInput("");
      setMessages((old) => [...old, { role: "user", content: command }, { role: "assistant", content: reply }, { role: "action", action }]);
      setBubbleText(reply); setChatExpanded(true); return;
    }
    setInput("");
    setMessages((old) => [...old, { role: "user", content: command }]);
    setBubbleText(`Hopping to ${appLabels[requestedApp.app]}…`); setBusy(true); setMood("hopping");
    setLaunchTarget({ app: requestedApp.app, phase: "approach" });
    try {
      const windowHop = expanded ? Promise.resolve(false) : window.snoopyAPI.hopWindow().catch(() => false);
      await Promise.all([windowHop, new Promise((resolve) => setTimeout(resolve, 1000))]);
      setLaunchTarget({ app: requestedApp.app, phase: "clicked" });
      setBubbleText(`Tap! Opening ${appLabels[requestedApp.app]}…`);
      const result = await window.snoopyAPI.voiceCommand(`open_${requestedApp.app}`);
      setMessages((old) => [...old, { role: "assistant", content: result.message }]);
      setBubbleText(result.message); setMood("excited"); setTimeout(() => setMood("idle"), 2000);
    } catch (error) {
      const message = error?.message || "I couldn't open Chrome.";
      setMessages((old) => [...old, { role: "assistant", content: message }]);
      setBubbleText(message); setMood("idle");
    } finally { setLaunchTarget(null); setBusy(false); }
  };

  useEffect(() => {
    if (!voiceEnabled) return undefined;
    let active = true;
    const voiceSession = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const removeTranscript = window.snoopyAPI.onVoiceTranscript((transcript) => voiceHandler.current?.(transcript));
    const removeLevel = window.snoopyAPI.onVoiceLevel((level) => { if (active) setVoiceLevel(level); });
    const removePartial = window.snoopyAPI.onVoicePartial((transcript) => {
      // Windows hypotheses are provisional and often mishear the wake phrase
      // (for example, showing a wrong word in the composer before the final
      // result arrives). Keep them out of the input; voiceHandler commits only
      // the recognizer's final transcript and removes a recognized wake phrase.
      if (active && transcript.trim()) setBubbleText("I heard you. Finishing the transcript…");
    });
    const removeStatus = window.snoopyAPI.onVoiceStatus((status) => {
      if (!active) return;
      if (status.listening) {
        setVoiceStatus("Listening for your voice");
        setBubbleText("I'm listening. I'll send what you say after you pause.");
      }
      if (status.speechDetected) { setBubbleText("I heard you. Transcribing…"); setMood("thinking"); }
      if (status.recognizerLanguage && status.recognizerLanguage !== "en-IN") {
        setBubbleText(`Using English (${status.recognizerLanguage.slice(3)}). For better Indian English recognition, install the English (India) speech feature in Windows.`);
      }
      if (status.stopped) {
        setVoiceEnabled(false); setVoiceStatus("Voice stopped"); setBubbleText("Voice listening stopped. Turn the mic back on to try again.");
      }
      if (status.error) {
        setVoiceEnabled(false); setVoiceStatus("Voice unavailable"); setBubbleText(status.error);
      }
    });
    window.snoopyAPI.startVoiceListener(voiceSession).catch((error) => {
      if (active) { setVoiceEnabled(false); setVoiceStatus("Voice unavailable"); setBubbleText(error?.message || "Couldn't start voice recognition."); }
    });
    return () => {
      active = false; removeTranscript(); removePartial(); removeStatus();
      removeLevel();
      window.snoopyAPI.stopVoiceListener(voiceSession);
    };
  }, [voiceEnabled]);

  return <main className={expanded ? "window" : "window pet-only"}>
    {!expanded && <div className="pet-controls">
      <button type="button" title="Open Snoopy chat" aria-label="Open Snoopy chat" onClick={() => setChatExpanded(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5A7.5 7.5 0 1 1 20 11.5Z" /></svg></button>
      <button type="button" title={voiceEnabled ? "Turn voice commands off" : "Turn voice commands on"} aria-label={voiceEnabled ? "Turn voice commands off" : "Turn voice commands on"} aria-pressed={voiceEnabled} className={voiceEnabled ? "mic-toggle active" : "mic-toggle"} onClick={toggleVoice}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v4m-4 0h8" /></svg></button>
      {voiceEnabled && <div className="pet-mic-level" role="status" aria-label={`Microphone input ${voiceLevel}%`}><span>Mic {voiceLevel}%</span><i><b style={{ width: `${voiceLevel}%` }} /></i></div>}
      <button type="button" title="Close Snoopy" aria-label="Close Snoopy" onClick={() => window.snoopyAPI.windowAction("close")}>×</button>
    </div>}
    {expanded && <header className="titlebar">
      <div className="brand"><span className="paw-icon">✦</span><span>Snoopy</span><span className="online-dot" /></div>
      <div className="window-actions">
        <button type="button" title={voiceEnabled ? "Turn voice commands off" : "Turn voice commands on"} aria-pressed={voiceEnabled} className={voiceEnabled ? "mic-toggle active" : "mic-toggle"} onClick={toggleVoice}>{voiceEnabled ? "🎙" : "🎤"}</button>
        <button type="button" title="Snoopy settings" aria-label="Snoopy settings" onClick={() => { void openSettings(); }}>⚙</button>
        <button type="button" title="Collapse chat" onClick={() => setChatExpanded(!expanded)}>{expanded ? "—" : "＋"}</button>
        <button title="Close" onClick={() => window.snoopyAPI.windowAction("close")}>×</button>
      </div>
    </header>}
    <section className="pet-area">
      <div className="sparkle sparkle-one">✦</div><div className="sparkle sparkle-two">✧</div>
      <Puppy mood={mood} compact={!expanded} onWake={wakeSnoopy} onPointerDown={startPuppyDrag} onPointerUp={endPuppyDrag} onPointerCancel={endPuppyDrag} />
      {launchTarget && <div className={`launch-target ${launchTarget.phase}`} aria-label={`Snoopy is tapping ${appLabels[launchTarget.app]}`}>
        <span className={`launch-glyph ${launchTarget.app}`}>{appGlyphs[launchTarget.app]}</span>
        <small>{appLabels[launchTarget.app]}</small>
      </div>}
      {(!(!expanded && bubbleText === "Need a paw?")) && <div className="speech">{bubbleText}</div>}
      {(expanded || bubbleText !== "Need a paw?") && <div className="mood-label">{voiceEnabled ? voiceStatus.toUpperCase() : mood === "idle" ? "YOUR AI BUDDY" : mood.toUpperCase()}</div>}
    </section>
    {expanded && <>
      {settingsOpen ? <section className="chat-panel settings-panel">
        <div className="settings-title"><strong>Snoopy settings</strong><button type="button" onClick={() => setSettingsOpen(false)}>Back to chat</button></div>
        <p className="settings-note">AI runs locally through Ollama. No OpenAI key or API credits are used.</p>
        <label className="settings-field">Local Ollama URL
          <input value={settingsDraft.ollamaBaseUrl} onChange={(event) => setSettingsDraft((old) => ({ ...old, ollamaBaseUrl: event.target.value }))} placeholder="http://127.0.0.1:11434/v1" />
        </label>
        <label className="settings-field">Model name
          <input value={settingsDraft.ollamaModel} onChange={(event) => setSettingsDraft((old) => ({ ...old, ollamaModel: event.target.value }))} placeholder="qwen3:1.7b" />
        </label>
        <label className={`startup-toggle ${settingsDraft.startupSupported ? "" : "disabled"}`}>
          <input type="checkbox" checked={settingsDraft.launchAtStartup} disabled={!settingsDraft.startupSupported || settingsBusy} onChange={(event) => setSettingsDraft((old) => ({ ...old, launchAtStartup: event.target.checked }))} />
          <span><strong>Launch Snoopy when Windows starts</strong><small>{settingsDraft.startupSupported ? "You can change this any time." : "Available after installing Snoopy."}</small></span>
        </label>
        <div className="settings-status" role="status">{settingsStatus || `Version ${settingsDraft.appVersion || "1.0.0"}`}</div>
        <div className="settings-actions">
          <button type="button" disabled={settingsBusy} onClick={testOllama}>Test Ollama</button>
          <button className="settings-save" type="button" disabled={settingsBusy} onClick={saveSettings}>Save</button>
        </div>
      </section> : <>
      <section className="chat-panel">
          <div className="chat-heading"><span>A little help from Snoopy</span><button className="project-picker" type="button" onClick={chooseProjectFolder} title={projectDirectory || "Choose a project folder"}>{projectDirectory ? "Project selected" : "Set project folder"}</button>{voiceEnabled
            ? <span className="mic-status"><span>Mic {voiceLevel}%</span><span className="mic-level"><i style={{ width: `${voiceLevel}%` }} /></span></span>
            : <span className="tiny-status">● ready to help</span>}</div>
        <div className="messages" ref={listRef}>
          {messages.map((m, i) => m.role === "action"
            ? <ActionCard key={i} action={m.action} onApprove={approve} onDismiss={dismiss} busy={busy} />
            : m.streaming && !m.content ? null : <div key={i} className={`message ${m.role}`}>{m.content}</div>)}
          {busy && !messages.some((m) => m.streaming && m.content) && <div className="message assistant typing">Snoopy is thinking<span> •••</span></div>}
        </div>
        {messages.length === 1 && <div className="starters">{starters.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={voiceEnabled ? "Speak or type to Snoopy…" : "Ask Snoopy anything…"} aria-label="Message Snoopy" />
          <button disabled={busy || !input.trim()} aria-label="Send message">➤</button>
        </form>
      </section>
      </>}
      <footer>Original robot-pup companion • actions need your approval</footer>
    </>}
  </main>;
}
