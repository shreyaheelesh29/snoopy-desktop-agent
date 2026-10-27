const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("snoopyAPI", {
  chat: (history, requestId) => ipcRenderer.invoke("snoopy:chat", history, requestId),
  onChatChunk: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("snoopy:chatChunk", listener);
    return () => ipcRenderer.removeListener("snoopy:chatChunk", listener);
  },
  approveAction: (action) => ipcRenderer.invoke("snoopy:approveAction", action),
  voiceCommand: (command) => ipcRenderer.invoke("snoopy:voiceCommand", command),
  startVoiceListener: (sessionId) => ipcRenderer.invoke("snoopy:startVoiceListener", sessionId),
  stopVoiceListener: (sessionId) => ipcRenderer.invoke("snoopy:stopVoiceListener", sessionId),
  onVoiceTranscript: (callback) => {
    const listener = (_event, transcript) => callback(transcript);
    ipcRenderer.on("snoopy:voiceTranscript", listener);
    return () => ipcRenderer.removeListener("snoopy:voiceTranscript", listener);
  },
  onVoicePartial: (callback) => {
    const listener = (_event, transcript) => callback(transcript);
    ipcRenderer.on("snoopy:voicePartial", listener);
    return () => ipcRenderer.removeListener("snoopy:voicePartial", listener);
  },
  onVoiceLevel: (callback) => {
    const listener = (_event, level) => callback(level);
    ipcRenderer.on("snoopy:voiceLevel", listener);
    return () => ipcRenderer.removeListener("snoopy:voiceLevel", listener);
  },
  onVoiceStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("snoopy:voiceStatus", listener);
    return () => ipcRenderer.removeListener("snoopy:voiceStatus", listener);
  },
  windowAction: (action) => ipcRenderer.invoke("snoopy:window", action),
  setWindowMode: (expanded) => ipcRenderer.invoke("snoopy:windowMode", expanded),
  beginWindowDrag: () => ipcRenderer.invoke("snoopy:beginWindowDrag"),
  endWindowDrag: () => ipcRenderer.invoke("snoopy:endWindowDrag"),
  hopWindow: () => ipcRenderer.invoke("snoopy:hopWindow"),
  chooseProjectFolder: () => ipcRenderer.invoke("snoopy:chooseProjectFolder"),
  getSettings: () => ipcRenderer.invoke("snoopy:getSettings"),
  saveSettings: (settings) => ipcRenderer.invoke("snoopy:saveSettings", settings),
  testOllama: (settings) => ipcRenderer.invoke("snoopy:testOllama", settings),
  onOpenSettings: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("snoopy:showSettings", listener);
    return () => ipcRenderer.removeListener("snoopy:showSettings", listener);
  }
});
