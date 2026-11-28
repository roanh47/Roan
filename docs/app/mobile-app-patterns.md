# Mobile AI app patterns, 2026

Function inventory of the four reference apps as shipped on Android/iOS, the patterns that repeat, and a shortlist mapped onto files in this repo. Vendor help pages are the source; where a vendor documents nothing, that is stated. One UI-history article covers the stop button, which no vendor documents.

## 1. Per app

### Claude (iOS, Android)

**Shell.** The chat list is its own surface, not a permanent sidebar: you "open your chat list" and long-press a row to rename or delete (https://support.claude.com/en/articles/8230524-delete-or-rename-a-conversation). A Code tab reached from "the app's navigation" holds cloud sessions, projects, Remote Control and Dispatch (https://docs.claude.com/en/docs/claude-code/mobile). Settings sit behind your initials in the upper right, together with the speech-input language (https://support.claude.com/en/articles/10065434-use-dictation-on-claude-mobile).

**Composer.** "+" in the lower-left opens the command and tool menu (https://support.claude.com/en/articles/8114491-get-started-with-claude). Uploads allow 20 files per chat, 500 MB each (https://support.claude.com/en/articles/8241126-upload-files-to-claude). A microphone right of the input dictates into text, arrow sends, X cancels (https://support.claude.com/en/articles/10065434-use-dictation-on-claude-mobile). Voice mode is separate full duplex; its transcript is saved as text in history (https://support.claude.com/en/articles/11101966-use-voice-mode).

**Model picker.** On mobile the current model is shown at the top of the screen; tapping opens the selector (https://support.claude.com/en/articles/8114491-get-started-with-claude). Effort and thinking are separate controls, Low through Max (https://support.claude.com/en/articles/8664678-change-the-model-effort-and-thinking-settings).

**Tool calls.** Chat search is RAG and "will appear as tool calls during your conversations" (https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context).

**Connectors.** Web connectors run on Claude Mobile for iOS and Android; custom connectors are remote MCP servers Anthropic's cloud reaches (https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities).

**Background.** With Remote Control active the app pushes a notification when a long task finishes or needs a decision, and you may ask for one in the prompt (https://docs.claude.com/en/docs/claude-code/mobile).

### ChatGPT (iOS, Android)

**Shell.** A two-line menu icon opens a sidebar of recent chats, newest first, synced across signed-in devices; settings are behind the profile icon there (https://help.openai.com/en/articles/8142208-chatgpt-ios-and-android-app-faq). Sidebar search runs on iOS and Android with content filters (https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt).

**Composer.** Files and audio upload into a conversation (https://help.openai.com/en/articles/8555545-uploading-files-and-audio-to-chatgpt). "+" lists connected apps; @ also mentions one (https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt). Voice works in Chat on web, iOS and Android, modes chosen under Settings > Voice (https://help.openai.com/en/articles/20001274-chatgpt-voice). Send becomes a labelled stop glyph while tokens stream and cancels the request (https://interfacelineage.com/stop-generating-button-streaming).

**Model picker.** A model menu holds GPT-6 and earlier models plus a Thinking slider: Instant, Medium, High, Extra High, Pro (https://help.openai.com/en/articles/20001354-gpt-6-and-other-models-in-chatgpt).

**Tool calls.** Connected apps may ask for approval mid-chat; inside Voice that approval must be on screen, spoken approval is unsupported (https://help.openai.com/en/articles/20001274-chatgpt-voice).

**Connectors.** Apps install under Settings > Plugins and come from an app directory; custom MCP servers connect (https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt, https://help.openai.com/en/articles/6825453-chatgpt-release-notes).

**Background.** Task notifications are set at Settings > Notifications as Push, Email or both; push requires the task to have been created on the phone (https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt).

### Gemini (Android, iOS)

**Shell.** The drawer keeps New chat first, Library second, then only five items before a "More" expander; search moved to the top-right (https://9to5google.com/2026/10/23/gemini-settings-redesign-android/). Recent and pinned chats sit under "Recent" in that drawer, with search inside it and long-press to pin (https://support.google.com/gemini/answer/13666746?hl=en&co=GENIE.Platform%3DAndroid). Settings were consolidated into one page holding Notifications, Skills, Voice, Media and data controls (https://9to5google.com/2026/10/23/gemini-settings-redesign-android/).

**Composer.** "Add files" offers Photos, Camera, Files, Drive and Notebooks, ten files per prompt (https://support.google.com/gemini/answer/14903178?hl=en&co=GENIE.Platform%3DAndroid). Live starts from a bottom button or a left swipe and can stream camera video or share the screen (https://support.google.com/gemini/answer/15274899?hl=en&co=GENIE.Platform%3DAndroid).

**Model picker.** Flash-Lite, Flash, Pro and Argon by plan, with Low/Medium/High thinking and an auto-selection toggle that lets Gemini choose per prompt (https://support.google.com/gemini/answer/18648722?hl=en&co=GENIE.Platform%3DAndroid).

**Skills.** Custom Gems are created and saved as reusable assistants (https://support.google.com/gemini/answer/15235603?hl=en) and appear in the drawer list (https://9to5google.com/2026/10/23/gemini-settings-redesign-android/).

**Background.** Notifications are a top-level item on the consolidated settings page (https://9to5google.com/2026/10/23/gemini-settings-redesign-android/).

### opencode (Android, iOS beta)

**Shell.** The app is a remote for OpenCode on your computer: `opencode pair --remote` prints a one-time link and QR code that expire in five minutes, then your recent sessions open on the phone (https://opencode.ai/mobile). iOS is a public TestFlight beta; Android ships on Google Play (https://opencode.ai/mobile).

**Composer.** Voice rather than text first: call a session, say what you need, the agent answers aloud and the call reports what changed when the work is done (https://opencode.ai/mobile).

**Model picker.** `/connect` for a provider, then `/models` from the models.dev catalog (https://opencode.ai/docs/providers). No documented per-message switch.

**Tool calls.** Permissions are `allow`, `deny` or `ask`; `ask` "wait[s] for a decision from the client" (https://opencode.ai/docs/permissions).

**Connectors.** MCP servers live under `mcp.servers`, remote ones authenticate with OAuth, `/mcps` connects them (https://opencode.ai/docs/mcp-servers).

**Background.** Work keeps running on the computer; the phone shows sessions and steers them (https://opencode.ai/mobile).

## 2. Patterns in 3+ of 4

| Pattern | Claude | ChatGPT | Gemini | opencode |
|---|---|---|---|---|
| Chat list is a dedicated surface, one tap from the top bar | yes | yes | yes | yes |
| Settings consolidated behind account/avatar | yes | yes | yes | config file |
| Composer "+" opens an attach sheet | yes | yes | yes | no |
| Microphone in or beside the input | yes | yes | yes | yes (call) |
| Model plus effort chosen per conversation | yes | yes | yes | yes |
| Connector/MCP managed in settings, not chat | yes | yes | yes | yes |
| Tool calls visible with an approval moment | yes | yes | partial | yes |
| Push when a long task ends | yes | yes | yes | no |

## 3. Shortlist for Roan

Ordered by what is missing, not by what is easy.

1. **Bottom tab bar (Chats / Schedules / Files / Settings) under 900 px.** The only navigation today is ☰ in the titlebar opening the rail drawer — **M**, `web/src/App.tsx`, `web/src/layout.css`.
2. **Chat list as a full screen with search and long-press rename/delete.** The rail lists sessions with no search, and `ChainClient` has no rename — **M**, `web/src/App.tsx`, `web/src/chain.ts`.
3. **Stop that cancels an open turn and keeps the partial answer.** `Composer` disables itself while `turn !== null` and the protocol has no cancel frame — **L**, `web/src/components/Composer.tsx`, `web/src/chain.ts`.
4. **Attach sheet on the composer "+" (photo, file, camera).** The composer is a textarea and a send button — **L**, `web/src/components/Composer.tsx`.
5. **Model picker in the composer.** `providers_list`, `models_list` and `provider_pick` already exist; only the settings panel uses them — **S**, `web/src/components/Composer.tsx`, `web/src/panels/ProvidersPanel.tsx`.
6. **Inline tool cards with status, duration and collapsible I/O.** `Transcript.tsx` renders trace rows while `ToolCard.tsx` and `ToolTimeline.tsx` sit unused — **S**, `web/src/components/Transcript.tsx`, `web/src/components/ToolCard.tsx`.
7. **Approval card pinned above the composer** for `ask` decisions instead of a modal — **M**, `web/src/components/ToolApprovalCard.tsx`, `web/src/state.ts`.
8. **Streaming caret and "jump to latest".** `Transcript` renders completed events; pending state is only text in the placeholder — **S**, `web/src/components/Transcript.tsx`, `web/src/App.tsx`.
9. **Dictation mic in the composer**, assuming the shell exposes a speech bridge — **L**, `web/src/components/Composer.tsx`, `src-tauri/`.
10. **Editable session titles.** Titles come from the daemon; the app never sets one — **S**, `web/src/App.tsx`, `web/src/chain.ts`.
11. **Local notification when a turn finishes while backgrounded** — the Claude payoff without cloud — **L**, `src-tauri/`, `web/src/chain.ts`.
12. **Onboarding reduced to one primary action**, log behind a disclosure; `Onboarding.tsx` exists unused while `App.tsx` inlines the screen — **S**, `web/src/components/Onboarding.tsx`, `web/src/App.tsx`.

## 4. What not to copy

- **Account and subscription surfaces.** Claude sells Pro in the Android app (https://support.claude.com/en/articles/9612892-how-do-i-sign-up-for-claude-pro-on-claude-for-android), Gemini exposes plan management (https://support.google.com/gemini/answer/14517446?hl=en&co=GENIE.Platform%3DAndroid). Roan has no billing and no usage meter, so a plans screen is a paywall-shaped hole.
- **Cloud account sync as the history mechanism** (https://help.openai.com/en/articles/8142208-chatgpt-ios-and-android-app-faq). The chain already is the sync primitive; an account layer competes with invite codes.
- **Locked chats, PINs and archive folders** (https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt). Local data needs no second lock, and archive adds a second place to look.
- **Incognito chats** (https://support.claude.com/en/articles/12260368-use-incognito-chats). Every chain is device-local already; the toggle would imply normal mode leaves the device.
- **Full-duplex voice with camera and screen share** (https://support.google.com/gemini/answer/15274899?hl=en&co=GENIE.Platform%3DAndroid). Large native surface, no use case, and it makes the app read as a consumer assistant.
- **Auto model selection** (https://support.google.com/gemini/answer/18648722?hl=en&co=GENIE.Platform%3DAndroid). It hides which model answered, breaking the cost badge and the titlebar label.
- **"More" overflow in the drawer** (https://9to5google.com/2026/10/23/gemini-settings-redesign-android/). Four destinations need no disclosure.
- **App directories and marketplaces** (https://help.openai.com/en/articles/6825453-chatgpt-release-notes). A store implies review, listing and revocation machinery; the Workspace panel is the honest version.
- **Memory and RAG over past chats** (https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context). The chain already sends full history, so retrieval adds an index to keep in sync for no context gain.

## Sourced backing

The three reference apps now have full sourced inventories in `docs/research/features/`
(official help-centre URLs per row): `chatgpt.json` (58 features, 2 unverified),
`claude.json` (45, 1 unverified), `gemini.json` (51, 3 unverified). This document keeps
only the patterns Roan copies; the JSON files hold the complete checklists to test
against once a UI round claims parity.
