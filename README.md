# Snoopy — robot-puppy desktop companion

A Windows-first starter built with Electron, React, and Vite. Snoopy is a black-and-white robot pup with a round white face, ink-black floppy ears and eye patch, blush-pink cheeks, a tiny cyan chest display, and a star-tipped antenna. The character keeps an original robot-puppy silhouette and has eight sprite poses: idle, happy, thinking, speaking, working, walking, sleeping, and excited.

The app runs as a small transparent desktop companion. It stays above other windows and can be dragged anywhere. Chat runs through Ollama on your PC, so requests use the local model and do not use OpenAI API credits. Snoopy can open Chrome, Visual Studio Code, Command Prompt, Notepad, and Calculator; ask permission before closing those apps; prepare web searches; open a supplied website or selected Windows Settings pages; and save a text note in `Documents\Snoopy Companion Notes`. Choose a project folder with **Set project folder** to let Snoopy offer to open it in VS Code, launch Command Prompt there, or run its `npm test` script with approval and show the output. Snoopy displays progress and results in a speech bubble without speaking aloud. That silent behavior is intentional. Wake-word app-open requests launch directly; typed app and close requests show an approval card. The installed app bundles a Python runtime and the Vosk English (India) model for offline voice input.

This starter does not yet provide mouse/keyboard automation, screen understanding, arbitrary file access or editing, code patch generation, reminders, or to-do management. Add those as individual tools with visible previews, user approval, and safe cancellation. Snoopy does not speak responses aloud, following the requested silent voice interaction.

## Requirements

- Windows 10 or 11
- Node.js LTS (includes npm)
- [Ollama for Windows](https://ollama.com/download)
- The `qwen3:1.7b` model (about 1.4 GB; already installed on this PC)
- An internet connection when building, to download the bundled voice runtime and npm packages

## Run from source (PowerShell)

1. Open PowerShell in this project folder.
2. Install Ollama from [ollama.com/download](https://ollama.com/download) if it is not already installed. Make sure the Ollama app is running; Snoopy connects to its local API at `http://127.0.0.1:11434`.

3. Download the local model once:

   ```powershell
   ollama pull qwen3:1.7b
   ```

   The model runs on your computer after it is downloaded. Snoopy defaults to this smaller model for faster replies on this PC. You do not need to create an OpenAI API key or buy API credits.

4. Install Snoopy's app dependencies:

   ```powershell
   npm.cmd install
   ```

5. Start the desktop app:

   ```powershell
   npm.cmd run dev
   ```

6. Chat with Snoopy. For a web search, website, Settings page, app close, project launch, test run, or saved note, review the action card and press **Allow** or **Dismiss**. Open a chat and choose **Set project folder** before asking Snoopy to open your project, its terminal, or run `npm test`.
7. For voice input, run `npm.cmd run setup:voice` once. This installs a local Python speech runtime and downloads the 36 MB Vosk English (India) model. Then start Snoopy and press the 🎤 button. Recognition runs offline on the PC; press the mic button again to stop listening. Say “Hi Snoopy, open VS Code”, “Hi Snoopy, open Calculator”, or “Hi Snoopy, close Notepad”. Close commands show a chat approval card; app-open commands launch directly. Snoopy shows status messages in its cloud and never speaks aloud.

8. Make a production renderer build with:

   ```powershell
   npm.cmd run build
   npm.cmd start
   ```

`npm.cmd start` opens the app from the production build. If Snoopy says it cannot reach Ollama, launch Ollama from the Windows Start menu and try again.

## Build and install the Windows app

From PowerShell in the project folder, run:

```powershell
npm.cmd install
npm.cmd run pack:win
```

The build prepares a self-contained offline voice runtime, creates the production React build, then packages an NSIS installer and portable executable. The files appear in `release`:

- `release/Snoopy Setup 1.0.0.exe` — installer with desktop and Start menu shortcuts
- `release/Snoopy-1.0.0-portable.exe` — portable build

Install Snoopy and launch it from its shortcut. The installed app loads the packaged React build and does not need `npm run dev`. Closing the window hides Snoopy in the notification area. Right-click its tray icon for **Show Snoopy**, **Hide Snoopy**, **Settings**, or **Exit Snoopy**. The settings screen lets you test and change the local Ollama URL and model. Windows startup is disabled by default and can be enabled in the installed app's settings.

The installer is unsigned, so Windows SmartScreen may show a warning. The `pack:win` command builds x64 Windows outputs.

## Character sprites

The active transparent 4×2 sprite sheet is `public/character/snoopy-emotions.png`. `src/renderer/App.jsx` selects the matching cell from the sheet for each mood; CSS adds a small motion loop to each pose.

| State | Frames | Motion cue |
| --- | --- | --- |
| `idle` | 1 pose | Calm seated pose with gentle breathing |
| `happy` | 1 pose | Smiling and raising a paw |
| `thinking` | 1 pose | Head tilt and thoughtful paw |
| `speaking` | 1 pose | Open-mouth expression while Snoopy replies in text |
| `working` | 1 pose | Sitting beside a laptop during an approved task |
| `walking` | 1 pose | Trotting while an app launches |
| `sleeping` | 1 pose | Curled down with closed eyes after a minute idle |
| `excited` | 1 pose | Jumping with paws raised after a greeting or task |

- The existing sheet has eight equal cells, ordered left-to-right across the first row, then the second row.
- Palette: warm white fur `#FFFDF8`, charcoal patches `#252631`, cyan robot details `#A9DDF0`, soft blush `#F3A5B8`, and a pale lavender UI accent.
- Keep all future frames centered in the same cells so the CSS `background-position` map stays aligned.

## Project map

```text
src/main/main.cjs          Electron window, local Ollama chat, validated tools, approved actions
src/main/preload.cjs       Narrow, context-isolated renderer bridge
src/main/voice-listener.py Offline Vosk speech-to-text listener
setup-voice.ps1            One-time offline voice setup
src/renderer/App.jsx       Chat, puppy, action preview and approval UI
src/renderer/styles.css    Transparent window and emotion animations
public/character/snoopy-emotions.png Eight transparent sprite poses
.env.example               Local API configuration template
```

## Extend the agent safely

Add a tool schema in `src/main/main.cjs`, validate its arguments, and render its proposed action in the UI before execution. Keep side effects in the Electron main process, expose only the required IPC methods through the preload, and constrain file access to a dedicated folder. Do not pass model-generated shell commands to a terminal. Add cancellation, logs, and per-tool permissions before adding more consequential actions.
