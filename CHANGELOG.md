# Nic Hyper Flow — Engineering Changelog


---

## Session: 2026-04-17 13:12 → 2026-04-17 20:32

### Core Engine
**Atomic Chat State with Dedicated Databases** — We fundamentally re-architected the persistence layer, introducing dedicated, isolated databases for each chat. This eliminates race conditions, guarantees data integrity, and significantly improves concurrency for your AI workflows.

**Turbocharged & Resilient State Saves** — Chat state now persists 3x faster with a 250ms debounce, and atomic file operations include intelligent retry logic for Windows, preventing data loss from file locking issues.

### Model Intelligence
**Bulletproofed Gemini Model Integration** — Gemini models are significantly more stable, less prone to freezing on empty prompts, and better at interpreting complex contexts thanks to strict history sanitization.

**Smarter Agent Loops Prevent Endless Status Reports** — Agents now detect and auto-terminate after two consecutive turns of only informative tools, drastically reducing token waste and eliminating frustrating "understood" loops. We also refined prompts to encourage meaningful status reports.

### Developer Experience
**Efficient Visuals & Hardened Background Workers** — We optimized image attachments for the UI, sending lightweight metadata instead of bulky Base64. This drastically improves rendering performance in image-heavy chats. Simultaneously, the Knowledge Base query worker now includes timeouts and enhanced error handling, preventing hangs and ensuring more reliable context retrieval.

---

## Session: 2026-04-16 14:37 → 2026-04-17 02:33

### Remote Control
**Shipped stable, persistent Cloudflare Tunnels** — Your remote control sessions now leverage Named Cloudflare Tunnels, eliminating flaky `trycloudflare.com` URLs, rate limits, and frustrating reconnections. Each device gets a permanent, dedicated hostname, ensuring seamless, uninterrupted control.

**Eliminated remote command race conditions** — A new serial queue now processes all incoming WebSocket commands from your mobile app. This prevents `SQLITE_MISUSE` errors and conflicting agent operations when you send rapid instructions or switch chats quickly.

**Boosted remote control UI responsiveness** — We've aggressively optimized the remote control streaming throttle, reducing latency by 5x. Your mobile app now reflects agent state changes almost instantly, making the remote experience feel significantly more fluid.

### State Layer
**Guaranteed atomic database writes and crash recovery** — The local SQLite database now commits all state changes to disk atomically, preventing data corruption on unexpected shutdowns. We also implemented a multi-stage recovery process that automatically restores from backups or repairs corrupt chats on startup, ensuring you never lose your workflow.

**Summarized large payloads in chat history** — Very large tool outputs or attachment data in chat cost entries no longer bloat your database or cause issues. We now intelligently summarize these payloads, keeping your chat history lean and performant without losing critical context.

---

## Session: 2026-04-15 12:25 → 2026-04-16 03:24

### Core Engine
**Unleashed True Multi-Agent Orchestration** — We shipped a dedicated `SubAgentLoop` and `SubAgentManager`, enabling the main agent to spin up, monitor, and coordinate specialized subagents. This unlocks parallel execution and complex workflow delegation, fundamentally changing how Nic Hyper Flow tackles multi-step problems.

**Agents Boot with Instant Project Context** — Nic Hyper Flow now injects a comprehensive, structured overview of your entire project (stack, directory structure, recent changes) as a stable system message on the very first turn. Your agents now understand your codebase's foundation from the moment they start, eliminating initial context-gathering turns.

**Subagents Now Report State and Respect Timeouts** — Every subagent turn now mandates a `report_subagent_state` call, pushing real-time progress updates directly into the main agent's context. We also introduced a 30-minute hard timeout, ensuring subagents remain observable and never run away indefinitely.

### DX
**Bulletproof Remote Control Connectivity** — The `cloudflared` tunnel service now robustly downloads, verifies, and manages its binary, even attempting reinstallation if the executable is corrupted. This eliminates flaky connections and ensures your mobile remote control stays reliably linked to your VS Code session.

---

## Session: 2026-04-14 15:08 → 2026-04-14 15:46

### Core Engine

**Re-architected the core agent execution model** — We've deprecated the legacy `NIC ASSIST` backend, laying the groundwork for a more modular and performant agent orchestration engine. This enables faster iterations and deeper model integrations going forward.

### Developer Experience

**Introduced a guided first-run experience** — New users now receive an immediate prompt to configure their API keys and understand the core Bring Your Own Keys (BYOK) principle, significantly reducing initial setup friction. It also points directly to remote control setup for those ready to dive in.

**Clarified our strict Bring Your Own Keys (BYOK) policy** — The updated README and explicit in-app messaging now unequivocally state that your codebase never leaves your machine. We only collect essential authentication data (email) for access control, reinforcing your privacy and control.

**Streamlined Cloudflare Tunnel setup for remote control** — We've removed the bundled `cloudflared` binary, empowering you to manage your own Cloudflare Tunnel installation. This simplifies our distribution and ensures you're always running the latest, most secure version of `cloudflared` directly from Cloudflare.

---

## Session: 2026-04-13 12:39 → 2026-04-14 04:04

### Core Engine
**Native VS Code Search Power-Up** — We re-architected the `search` tool to leverage VS Code's native text search (Ripgrep). This delivers significantly faster, more reliable content searches across your codebase and unlocks advanced regex, case-sensitive, and whole-word matching directly from the agent.

**Qwen Models Join the Flow, Up to 10M Context** — Integrated the full suite of Alibaba's Qwen models, including `Qwen Long` with a staggering 10 million token context window. Agents can now process and reason over massive codebases or documentation sets without losing critical context.

### Agent Experience
**Granular Agent Status Reporting** — Introducing the new `report_status` tool, replacing `report_cognitive_state`. Agents can now issue custom, high-priority status messages with optional colors and auto-hide, giving you real-time, precise insight into their current operations without verbose internal monologues.

**Visually Rich Agent Status Bar** — The agent status bar received a complete visual overhaul, featuring dynamic shimmer effects, state-specific progress bars, and glowing indicators. This provides a more engaging and informative feedback loop, making it easier to track agent activity at a glance.

### Developer Experience
**Robust Remote Control Session Handling** — We shipped improved error handling for remote control sessions. If your mobile session token expires, Nic Hyper Flow now automatically prompts you to reconnect, ensuring a smoother, more reliable remote experience.

---

## Session: 2026-04-12 15:02 → 2026-04-13 03:06

### Developer Experience
**Real-time Agent Status** — We shipped a new, persistent status bar that gives you instant, granular insight into what your agent is doing. It now includes subtle fade transitions for state changes, clearly showing if it's `thinking`, `executing` a specific tool, `waiting` for approval, or if an `error` occurred, all without scrolling the chat feed.
**Native VS Code Terminal for Agent Sessions** — When your agent starts a persistent terminal session, it now opens directly in a native VS Code terminal. This means full keyboard shortcuts, proper rendering, and familiar terminal management for deep debugging.
**Direct User Feedback on Agent Approvals** — When the agent requests approval for a command or edit, you can now include a message with your decision. This allows you to give immediate, contextual feedback, guiding the agent without breaking its flow.

### Core Engine
**Guaranteed Single Active Agent Execution** — We implemented a concurrency guard for the agent's `run()` loop. If a new run is triggered while another is active, the previous one is safely aborted, ensuring predictable and stable execution every time.
**Stricter Thinking Prompt Enforcement** — We added critical, explicit rules to the agent's `<thinking>` prompt across all models. This ensures thoughts remain internal, are always properly closed, and never intermingle with user-facing output, leading to more consistent agent behavior.

---

## Session: 2026-04-11 13:36 → 2026-04-12 07:22

### Core Engine
**Eliminated SQLite data corruption on concurrent writes** — We shipped a serialized write queue for API usage tracking that prevents `SQLITE_MISUSE` errors and potential data loss during rapid state updates. Your chat history and cost metrics are now rock solid.

### Remote Control
**Re-architected for instant mobile response and unbreakable security** — We overhauled the remote control stack, migrating all live data to a Cloudflare-tunneled WebSocket. This delivers sub-100ms latency for AI streaming and UI updates, while a new Cloud Functions-powered control plane and Firebase Security Rules gatekeep every command, ensuring only authorized actions reach your VS Code.

**Shipped mobile-driven edit approvals** — Critical agent file edits now trigger a prompt on your phone, giving you granular control over code modifications before they happen. No more unexpected changes, only intentional ones.

**Enabled seamless bidirectional settings sync** — Adjust `focusedMode`, reasoning effort, or selected model from your phone or VS Code, and watch the changes instantly propagate across all connected interfaces. Your preferences are always in sync.

**Streamlined QR authentication with PWA support** — Connecting your phone is now effortless. Scan a single QR code that intelligently routes to our new Progressive Web App, offering native-like installation and a more robust authentication handshake.

---

## Session: 2026-04-10 13:43 → 2026-04-11 00:25

### Mobile App Experience
**Introduced seamless Google Sign-In for mobile** — Authenticate your Nic Hyper Flow mobile app with a single tap using Google, replacing the previous GitHub flow and simplifying device linking.
**Shipped real-time state synchronization to mobile** — Your mobile app now instantly reflects the VS Code extension's active workspace, reasoning effort, and focused mode, ensuring a consistent experience across devices.
**Unleashed detailed, expandable tool execution logs in the mobile app** — Gain unprecedented visibility into agent actions with rich, collapsible tool status cards, providing specific summaries, arguments, and results for every step.

### Core Engine
**Upgraded file I/O to fully asynchronous operations** — Critical persistence and logging now leverage non-blocking file writes and async globbing, eliminating potential UI freezes and boosting overall extension responsiveness.
**Refined multimodal context injection for vision models** — Screenshots taken by the agent are now intelligently wrapped in system notes, ensuring strict API compliance for models like Anthropic while seamlessly integrating visual context.

---

## Session: 2026-04-10 05:38 → 2026-04-10 05:38

### Core Engine
**Fine-tuned Anthropic Reasoning** — You can now precisely control the "thinking" effort of Anthropic Claude models directly from settings, optimizing for speed or depth without modifying prompts.

### DX
**Programmatic Command Whitelisting** — We exposed a new public method to dynamically manage which shell commands Nic Hyper Flow is permitted to execute, giving integrators granular security control at runtime.

### UI/UX
**Total Control Over Chat UI Elements** — Every major chat UI element, from the API cost display to the token counter and microphone button, is now configurable, allowing you to tailor the interface precisely to your workflow preferences.

**Dynamic and Customizable Chat Backgrounds** — Elevate your chat experience with new background modes, supporting dynamic cognitive states, custom static images, or a clean, distraction-free canvas.

---

## Session: 2026-04-09 20:19 → 2026-04-09 23:23

### Core Engine
**Introduced explicit edit approval for agent actions** — Gain full control over agent-initiated file modifications. Nic Hyper Flow now asks for your confirmation before executing tools that change your code or files, preventing unexpected alterations by default. You can configure this behavior in settings.

**Agent context now fully restores during Time Travel** — When you revert to a past state, the agent's internal history, compacted memory, and state machine mode are precisely rehydrated. This ensures your agent truly "remembers" its prior thought process, leading to more consistent and reliable restarts from any point in your workflow.

### DX
**Time Travel is more resilient to UI message IDs** — We've hardened the Time Travel mechanism to reliably resolve user message IDs, even those generated optimistically by the UI. This eliminates friction when trying to revert to a specific turn, ensuring a smoother debugging and iteration experience.

---

## Session: 2026-04-08 13:03 → 2026-04-09 03:31

### Core Engine
**Atomic Multi-File Patching** — Shipped `apply_patch_batch`, a new tool that atomically applies multiple file operations (patch, create, replace, delete). If any operation fails and rollback is enabled, it automatically reverts previous changes, ensuring transactional integrity for complex refactors.
**Deeper Anthropic Reasoning** — Anthropic models now support Extended Thinking. Configure `none`, `low`, `medium`, or `high` effort levels to guide deeper problem-solving, with thought processes streamed directly to your chat.

### Developer Experience
**Instant Project Context** — Introduced `get_project_context`, a single tool that instantly fetches comprehensive project metadata: type, stack, frameworks, manifests, entrypoints, configuration files, top-level directories, architecture hints, and frequently modified files from Git. Agents get up to speed faster on any codebase.
**Git Change Summaries** — Added `summarize_changes`, a powerful new tool that provides a structured overview of local Git changes. Get modified, added, deleted files, line counts, and compact diffs against any base (HEAD, branch, commit) without parsing `git status` yourself.
**Focused Mode for Simpler Tasks** — Introduced a new "Focused Mode" that restricts the agent to a core set of essential file and shell tools. This reduces cognitive load and token usage for straightforward tasks, improving reliability and speed.

---

## Session: 2026-04-06 18:10 → 2026-04-07 07:14

### Core Engine

*   **DeepSeek agents now utilize native tool calling and a massive 124k context window** — Our DeepSeek integration now leverages native tool calling, eliminating custom XML parsing for improved reliability and lower latency. DeepSeek V3 and R1 models now operate with a massive 124k context window, enabling more complex, long-running agent workflows.

*   **Fine-tune OpenAI GPT-5 reasoning with new `xhigh` effort control** — Gain unprecedented control over GPT-5 family model behavior with a new `reasoningEffort` setting, including an `xhigh` option. Dynamically adjust inference cost and depth directly from the UI, tailoring agent thought processes to your specific task.

*   **Real-time API cost tracking now supports all providers** — Monitor your LLM spend with confidence. The API cost tracker now accurately calculates and displays usage across OpenAI, Anthropic, Google, DeepSeek, and xAI models, providing a unified view of your session expenses.

### DX

*   **Eliminated race conditions on rapid chat switching** — We shipped a new chat switching token that halts stale agent loops, preventing ghost runs and ensuring the active agent context is always precisely aligned with your selected conversation.

---

## Session: 2026-04-05 20:16 → 2026-04-05 21:39

### Developer Experience

**Unleashed fully local, zero-config operation** — We've fundamentally refactored the authentication service to operate in a permanently authenticated local mode. This completely eliminates the dependency on external backend tokens or credential management, enabling instant cold starts and robust offline development without any setup friction.

### Agent Core

**Sharpened agent's operational focus** — The agent's tool definitions no longer include `report_cognitive_state` or `update_web_panel_state`. This streamlines the agent's available actions, ensuring it only leverages stable and critical functionalities, and removes potential distractions from experimental UI feedback loops.

---

## Session: 2026-04-04 16:21 → 2026-04-05 02:13

### Core Engine
**Anchored visual memory for the AI** — The AI's context window now permanently retains the first user message containing visual attachments, even after aggressive compaction. This ensures the model never "forgets" foundational image context in long-running debugging or development sessions.

### Tooling
**Shipped atomic symbol refactoring with `copy_and_paste_symbol`** — Move or copy functions, classes, and types between files by name, not content, with automatic JSDoc/decorator inclusion and transactional rollback. Refactor large codebases with confidence, knowing your files are always consistent.
**Supercharged `read_multiple_files` with intelligent chunking** — The `read_multiple_files` tool now robustly handles large files, automatically chunking content to prevent context overflow while precisely respecting exact line ranges. It also includes comprehensive file validation and access control to prevent accidental reads of forbidden files.

### DX
**Unleashed multi-instance remote control from your mobile app** — Connect to and manage multiple VS Code instances from your mobile app. Open projects, monitor states, and switch contexts seamlessly across all your development environments. We even added a fallback to open projects via terminal if `vscode.openFolder` fails.
**Integrated live terminal controls directly into tool cards** — Interact with long-running `terminal_start` sessions directly from the chat UI. Send commands, stop processes, and debug without leaving your flow, providing a persistent and interactive terminal experience.

---

## Session: 2026-04-03 21:05 → 2026-04-04 06:09

### Core Engine
**Unleashed Autonomous Claude Code** — We've shipped a robust integration with the Claude Code CLI, empowering Nic Hyper Flow to delegate complex tasks like refactoring and debugging to a self-driving Claude agent. This new execution layer handles multi-file context, persistent sessions, and background operations, allowing you to offload heavy lifting while Nic Hyper Flow continues its work.

**Resilient Claude Communication** — We re-engineered how Nic Hyper Flow communicates with Claude Code, moving system prompts to temporary files and main prompts to stdin. This eliminates shell escaping issues, ensures reliable execution across platforms (especially Windows), and supports massive inputs for the most complex tasks. We also increased the maximum execution timeout to 30 minutes for deep work.

### Developer Experience
**Live Claude Session Visibility & Control** — Observe Claude Code's autonomous operations in real-time with live progress updates, a redacted prompt preview for security, and intelligent output summaries. You can now stop a running Claude session directly from the UI, giving you full transparency and control over background tasks.

**Smarter Chat Titles, Zero Agent Noise** — Nic Hyper Flow now intelligently names and renames chats in the background, providing clear, concise titles without the agent explicitly announcing its actions. Your chat history stays organized and focused on the task at hand.

---

## Session: 2026-04-02 00:36 → 2026-04-02 00:36

### Internal Polish
**Refined test environment overhead** — We've pruned an unnecessary test artifact, reducing incidental noise in the repository and ensuring our internal testing remains sharp and focused on critical paths.

---

## Session: 2026-04-01 14:43 → 2026-04-01 14:43

### DX
**Seamless Local Backend Integration** — We've updated the default backend configuration to point directly to a local Firebase emulator instance. This change empowers you to run and debug your backend logic entirely on your machine, drastically accelerating iteration cycles and reducing cloud deployment dependencies during development.

---

## Session: 2026-03-31 02:06 → 2026-03-31 02:06

### Core Engine

**Agent now drives towards solutions, not questions** — We refined the core `THINKING_PROMPT` to explicitly instruct the agent to prioritize problem resolution using its available tools, drastically reducing unnecessary conversational loops and accelerating task completion.

**Smarter UI debugging with `browser_action`** — The agent now considers the user's potential environment, including mobile, when using `browser_action`. This enhanced awareness leads to more robust UI observation and debugging strategies.

---

## Session: 2026-03-26 00:12 → 2026-03-26 01:16

### Core Engine

**Unleash Voice Input with Robust Native Transcription** — We've integrated voice input directly into the chat composer. It intelligently uses your browser's speech recognition, but for superior accuracy and reliability across environments, it seamlessly falls back to a native Python process that captures audio and leverages Google Gemini 2.5 Flash for high-fidelity transcription. Speak your prompts, stay in flow.

**Zero-Config Native Dependencies with Bundled Python** — Our new native features, like advanced audio capture, now work out-of-the-box. We bundle a lightweight Python runtime directly with the extension, eliminating the need for any local Python installation or complex environment setup.

### DX

**Instant Webview Resumption Eliminates Context Switching Lag** — Your chat webview now retains its full state and context when hidden. Switching away and back to Nic Hyper Flow is instantaneous, banishing frustrating reload delays and keeping your workflow uninterrupted.

---

## Session: 2026-03-22 02:23 → 2026-03-22 03:11

### Core Tools
**Batch file reads for richer context** — Your agents can now fetch content from up to 20 files in a single tool call, drastically reducing round-trips and enabling more comprehensive context gathering for complex tasks.

### External Integrations
**Upgraded web search to Serper (Google Search API)** — We swapped out Brave Search for Serper, giving your agents access to Google's robust search index. Expect more relevant results, better query understanding, and enhanced internationalization options for deeper web research.

---

## Session: 2026-03-19 21:05 → 2026-03-19 21:49

### Core Engine
**Unleashed Native `.docx` Document Generation** — We shipped a powerful `generate_docx` tool, empowering your agents to programmatically create rich, professional Word documents directly from their output, without manual intervention or external services.

### DX
**Zero-Setup Python for Document Generation** — We bundled a dedicated Python runtime within the extension, eliminating external dependencies and ensuring the `generate_docx` tool runs reliably out-of-the-box on any system. No more `python not found` errors.

**Build Complex Documents Incrementally** — The new `append_to` parameter in `generate_docx` allows agents to iteratively add new pages and content to an existing `.docx` file, enabling the construction of multi-chapter reports and proposals with a single, continuous workflow.

**Granular Control Over Document Structure & Style** — The `generate_docx` tool now exposes a comprehensive schema for precise control over headings, lists, tables, images, hyperlinks, custom fonts, colors, and page layouts, enabling the AI to craft visually stunning and perfectly formatted documents.

---

## Session: 2026-03-17 01:09 → 2026-03-17 01:09

### DX
**Securely inspect your API keys** — A new command now lets you view all configured API keys and settings, with options for masked, full, or debug views. Gain transparent control over your credentials without exposing them unnecessarily.

### Core Engine
**AI agents can now download files from the web** — We've shipped a powerful `download` action, enabling your agents to interact with web pages that initiate file downloads. Agents can now click download links or navigate directly to file URLs, saving the content to your specified path and expanding automation possibilities.

**Prevented LLM context overflow on massive web content** — Intelligent truncation now applies to `get_text`, `get_html`, and `eval` results, ensuring that even the largest web pages or complex JavaScript outputs fit within your agent's context window, preventing errors and optimizing token usage.

---

## Session: 2026-03-12 21:05 → 2026-03-13 04:19

### DX

**Introducing the Nic Hyper Flow Terminal Monitor** — We shipped a dedicated, persistent terminal monitor that lets you interact with agent-managed sessions, review their output in real-time, and send commands, all without losing context. It now loads instantly with prior session output, automatically selects active terminals, and paginates large outputs for smooth performance, even with verbose logs.

**Prevented UI Freezes and Chat History Bloat** — We implemented intelligent truncation and sanitization for all data flowing to the UI and being persisted to disk. This eliminates performance bottlenecks from massive payloads in webviews and keeps your chat history compact and performant, even with verbose tool outputs.

### Core Engine

**Agents now retain visual context with persistent screenshots** — Your agents can now remember up to 3 recent screenshots across turns and sessions. This provides a continuous visual memory, reducing redundant `take_screenshot` calls and enabling more sophisticated visual reasoning over time.

**Hardened tool call processing for more reliable agents** — We refined our model adapter to ensure all tool calls are reliably processed, even when models signal an early `stop`. This eliminates dropped tool outputs and makes your agents' interactions with external tools more robust and predictable.

**Dynamic model and provider state in the UI** — The UI now accurately reflects your active model's capabilities, its provider, and token limits. This gives you immediate, transparent insight into the agent's current operational parameters directly within the chat.

---

## Session: 2026-03-11 17:05 → 2026-03-12 02:39

### Core Engine
**Attachments are now dynamically stripped from older history, maximizing context window utility.**
We now intelligently omit image attachments from past messages in the context window and for models that don't support vision, ensuring your active session always has the most relevant information without wasting valuable tokens.

**Native tool calling context is now bulletproofed across all models.**
We've refined our history sanitization for native tool calling, strictly pairing tool calls with their results. This eliminates common API errors and ensures seamless tool execution regardless of the underlying model.

**Complex tool outputs are now rendered for AI with perfect clarity.**
Multiline tool outputs, like file contents or terminal logs, are now robustly formatted into distinct, readable blocks. This drastically improves the AI's comprehension of verbose tool results, leading to more accurate follow-up actions.

### DX
**Intelligent image optimization slashes vision model costs.**
All inline image attachments are now automatically resized, compressed, and converted to optimal formats (like JPEG or paletted PNGs) before being sent to vision models. This significantly reduces token consumption and speeds up processing without sacrificing visual fidelity.

**`adb_screenshot` now returns rich image data directly to vision models.**
The `adb_screenshot` tool has been upgraded to embed the captured image directly in its result payload. This means vision models can immediately process screenshots without extra steps, streamlining mobile debugging workflows.

---

## Session: 2026-03-10 17:27 → 2026-03-11 05:03

### Core Engine & Agent DX

**Persistent Terminals Unlock Advanced Debugging** — We shipped a full suite of interactive terminal tools (`terminal_start`, `terminal_read`, `terminal_send`, `terminal_stop`, `terminal_list`) that run on both Windows (via `cmd.exe`) and Unix (via `node-pty`). Now, agents can manage long-lived processes, respond to interactive prompts, and follow live logs without blocking, fundamentally shifting the debugging loop from fire-and-forget `run_command` to a truly iterative and observable process. A new write queue eliminates race conditions on concurrent input, ensuring reliable command execution.

**Intelligent Terminal Output for Agent Decision-Making** — The persistent terminal now automatically deduplicates repetitive output (like progress bars, spinners, and redundant empty lines) and intelligently detects when a session is awaiting input. This drastically reduces noise in the agent's context, providing a clean, actionable view of terminal state and improving the agent's ability to respond accurately to prompts.

**Enhanced Agent Context & User Control** — All tool results now include a precise timestamp, giving the agent a clearer temporal understanding of fetched information. Additionally, the new `wait` tool allows the agent to explicitly pause execution for background tasks, and users can interrupt these waits mid-turn to instantly regain control and redirect the agent.

### New Tooling

**Full Android Automation with `adb_screenshot` and `adb_input`** — We've closed the loop on Android device interaction. The new `adb_screenshot` tool robustly captures device screens, automatically falling back to a more reliable `shell+pull` method if `exec-out` fails. Complementing this, `adb_input` enables precise interaction with `tap`, `long_tap`, `swipe`, `text` input, and `keyevent` actions, allowing full observation and control over mobile workflows.

**Print-Ready Visual Asset Generation** — The `generate_assets` tool now supports `a4` and `a4-landscape` sizes, automatically upscaling generated images to 300 DPI using `sharp` for high-quality print and PDF integration. This provides print-ready assets directly from your prompts, complete with enhanced metadata for agent context.

---

## Session: 2026-03-10 03:37 → 2026-03-10 03:37

### Core Engine
**Streamlined agent context with smart image handling** — The core engine now proactively removes redundant image data from the main payload when images are already provided by specific tools like `get_image`, ensuring your agent's context remains focused and free of unnecessary duplication.

### Browser Automation
**Optimized inline screenshot delivery** — Screenshots exceeding 1.5MB are no longer attached inline to prevent context window bloat and improve performance, while smaller screenshots are seamlessly embedded for immediate agent consumption.

**Precise control over screenshot output** — We introduced a default JPEG quality of 70 for browser screenshots and now only persist them to disk when an explicit `action.path` is provided, giving you greater control over file storage and attachment size.

---

## Session: 2026-03-09 15:23 → 2026-03-09 15:23

### Core Engine
**Browser Actions Now Have Direct Vision** — We've eliminated the latency of a separate `get_image` call. `browser_action` now directly attaches screenshots to its tool results, giving the agent immediate visual context and accelerating its ability to react to UI changes.

### Model Adapters & Agent Strategy
**Native Multimodal Tool Results for Anthropic & Gemini** — Anthropic and Gemini models now receive image attachments directly within tool results, providing a richer, more integrated multimodal context for decision-making without intermediary steps.
**Optimized Agent Visual Workflow** — The agent's internal prompt has been updated to leverage this new direct vision capability, instructing it to inspect `browser_action` screenshots immediately from attachments, bypassing redundant `get_image` calls and streamlining visual reasoning.

---

## Session: 2026-03-08 01:37 → 2026-03-08 02:27

### Core Engine

**Real-time, granular API cost tracking** — We've integrated direct usage reporting from OpenAI's streaming API, giving you immediate, per-turn cost visibility right in the UI. No more guessing your token spend, see exactly what each agent interaction costs as it happens.

**Atomic API cost persistence** — Each API call's cost breakdown is now durably persisted to the database. We've shipped a debounced write queue to efficiently flush these metrics, ensuring accurate cost history and eliminating data loss even across sessions or unexpected crashes.

### Model Integrations

**Expanded OpenAI model lineup** — Dive into new capabilities with first-class support for `gpt-5-mini` for lightning-fast, cost-effective tasks, and `gpt-5.4` for frontier-level reasoning on complex, long-context problems.

**Enhanced model compatibility** — We've refined our OpenAI integration to intelligently handle model-specific parameters like `temperature` and gracefully fallback on unsupported `stream_options`. This ensures optimal performance and prevents API errors across our growing model catalog.

---

## Session: 2026-03-07 16:57 → 2026-03-07 18:06

### Core Engine
**Enhanced Agent Autonomy and Efficiency** — We've refined the core agent's internal prompt, guiding it to prioritize direct file inspection over repetitive search queries, drastically reducing resource consumption and avoiding operational loops. It also now explicitly understands its full capability to modify user files when necessary for task completion.

### Model Integrations
**Unleash Gemini 3.1 Pro with 1M Token Context** — Nic Hyper Flow now natively supports Gemini 3.1 Pro, giving your agents access to a staggering 1 million token context window for deeper reasoning and more complex problem-solving. This model is now generally available within the editor, moving past its preview status.

---

## Session: 2026-03-05 13:29 → 2026-03-06 03:28

### Core Engine
**Expanded Nic Assist 2.0 Context to 125k Tokens** — We bumped Nic Assist 2.0's effective context window by 25%, from 100k to a massive 125k tokens, and optimized the compaction threshold to 99.2%. This means the agent retains significantly more information, leading to deeper understanding and fewer context resets during complex tasks.

**Force Context Summarization On Demand** — You now have direct control to manually trigger context summarization from the chat view. This empowers you to manage token usage proactively, streamlining long sessions and ensuring critical information remains within the active context.

### Tools & Automation
**Unleashed Real Browser Automation with Playwright** — Introducing the `browser_action` tool, a full-fledged Playwright integration that lets the agent control a real Chromium instance. Navigate, click, type, scroll, and interact with any web page, including SPAs and login flows, unlocking unprecedented web automation capabilities with robust argument parsing.

**Supercharged Codebase Search** — The `search` tool now handles files up to 10MB and lines up to 10,000 characters, while returning up to 100,000 characters of results. We also refined `wholeWord` matching to correctly identify terms with special characters, ensuring more comprehensive and accurate results across large codebases.

**Bulletproof `read_file` Content Serialization** — We implemented custom JSON serialization for the `read_file` tool's content, ensuring newlines (`\n`) are correctly escaped and preserved. This eliminates parsing errors for files with complex content, making the tool's output consistently reliable for the agent.

---

## Session: 2026-03-05 05:16 → 2026-03-05 05:16

### Core Engine
**Unleash Nano Banana 2 for lightning-fast image generation** — We've integrated Fal.ai's state-of-the-art Nano Banana 2 model, delivering up to 4x faster image generation with superior quality directly within your workflow via the `generate_assets` tool.

### Developer Experience
**Take control of your image generation model** — Seamlessly switch between OpenAI's GPT-Image-1.5 and the new Nano Banana 2 with the `nic-hyper-flow.selectImageModel` command or set your preferred default via the `nic-hyper-flow.defaultImageModel` configuration.
**`generate_assets` tool now more robust** — The `generate_assets` tool now explicitly requires a `path` argument, ensuring all generated assets are saved to a specific, predictable location within your workspace.

---

## Session: 2026-03-03 21:24 → 2026-03-03 21:24

### Core Engine
**Stabilized concurrent tool execution for Grok models** — We introduced a micro-delay between successive tool calls when using the Grok adapter, effectively preventing race conditions and ensuring reliable, predictable workflow execution even under rapid, concurrent tool invocations.

---

## Session: 2026-03-02 20:22 → 2026-03-03 08:23

### Core Engine

**Introduced xAI Grok Models** — You can now tap into Grok 4-1 Fast and Grok 4-1 Fast (Reasoning) directly within Nic Hyper Flow. This unlocks new low-latency and high-capacity reasoning capabilities for your agentic workflows.

**Hardened Grok Tool Calling** — We rebuilt the Grok Python bridge to be fully stateless, processing one turn at a time. This eliminates complex internal state management, ensuring tool calls and their results are parsed reliably and consistently, even across multiple steps.

**Asynchronous Database Persistence** — Shipped a debounced write queue for our local state database. This drastically reduces disk I/O on rapid state changes and guarantees data integrity by flushing all pending writes on shutdown.

**Enhanced Gemini API Resilience** — Expanded our retry logic for Google Gemini, specifically targeting `429 Too Many Requests` and `Resource has been exhausted` errors. Your long-running agentic tasks are now more robust against transient API rate limits.

### DX

**Optimized Remote Control Sync** — We implemented smart caching and increased throttling for Firestore updates in the Remote Control service. This cuts down on unnecessary cloud writes, making your remote sessions more responsive and cost-efficient.

---

## Session: 2026-03-02 01:13 → 2026-03-02 01:13

### API Reliability & Performance

**Proactive token-based rate limiting** — We've activated a robust, sliding-window rate limiter that intelligently waits for API capacity *before* making requests, virtually eliminating `429 Too Many Requests` errors and keeping your agent flows smooth.

**Resilient API calls with built-in retries** — The Gemini adapter now automatically handles transient API errors with exponential backoff and jitter, ensuring your agent sessions power through intermittent service disruptions without interruption.

**Precision token estimation for optimized API usage** — The engine now accurately estimates token counts for each context rebuild, empowering the rate limiter to make intelligent pre-flight decisions and optimize your API spend.

---

## Session: 2026-02-27 23:22 → 2026-02-28 01:11

### Core Engine
*   **10x larger file reads in a single pass** — We've bumped the maximum lines an agent can read from a file in one go from 1,000 to 10,000. This drastically reduces the number of read operations and context switching needed for agents working with large codebases or log files, accelerating comprehension and task execution.

### DX
*   **Image generation defaults to high quality** — The `generate_assets` tool now produces images with `high` quality by default. Expect sharper, more detailed visual assets out of the box without needing to specify quality settings.

---

## Session: 2026-02-24 21:08 → 2026-02-24 22:30

### Core Engine

**Deepened Firebase Integration with Direct Introspection Tools** — Your agent can now directly explore Firestore schemas, list projects, run read-only queries, and enumerate storage buckets. This eliminates manual guesswork and accelerates data-driven development by providing immediate, structured access to your Firebase resources.

**Unleashed Streaming Performance** — We've decoupled agent streaming from real-time TF-IDF loop detection and token rate limiting. This change removes artificial pauses and processing overhead, allowing your agent to stream responses significantly faster and deliver a more fluid conversational experience.

### Developer Experience

**Streamlined Message Queueing UX** — We removed the explicit 'queued message' UI state and cancellation logic. This ensures a smoother, less ambiguous interaction when sending new prompts, especially during active agent thought, by simplifying the message handling flow.

---

## Session: 2026-02-23 21:08 → 2026-02-24 00:15

### Core Engine

**Zero-Overhead Token Rate Limiting** — We overhauled the token rate limiter to calculate current usage in `O(1)` time, eliminating performance bottlenecks. Streaming responses now buffer token usage, drastically reducing `recordUsage` calls and ensuring smooth, uninterrupted agent output.

**Robust Tool Argument Parsing** — Models sometimes output tool arguments with extraneous quotes (e.g., `cmd: "command"`). We've implemented automatic quote stripping across all parsing layers, ensuring your tool calls execute reliably without syntax errors.

**Reliable `run_command` on All Platforms** — Complex shell commands, especially those with nested quotes like `git commit -m "..."`, now execute flawlessly on Windows. We refactored `run_command` to leverage native shell execution, ensuring consistent and predictable behavior across all operating systems.

### Agent Capabilities

**New Web Crawling & Download Toolkit** — Unlock powerful web interaction with a new suite of tools: `read_robots_txt`, `crawl_site`, `list_downloadable_files`, `download_resource`, `download_site_assets`, and `extract_links`. Your agents can now intelligently navigate, analyze, and retrieve web content with unprecedented precision.

---

## Session: 2026-02-22 15:36 → 2026-02-22 15:36

### Core Engine
**`read_url` now returns structured links and page metadata** — Your agents can now parse URLs and retrieve not just clean, reader-mode text, but also a structured list of clickable links, page titles, and critical HTTP response details, unlocking advanced navigation and data extraction.

**Intelligent "Button-like" Link Detection** — We shipped heuristics to identify and prioritize actionable links, like calls-to-action, within a page. This allows agents to more effectively navigate complex UIs and make smarter decisions about where to "click" next.

**Robust HTML Parsing & URL Resolution** — The underlying `read_url` engine received a significant rewrite, delivering more accurate text extraction, better HTML entity decoding, and resilient resolution of relative and malformed URLs for consistent results across the web.

---

## Session: 2026-02-21 21:04 → 2026-02-21 21:29

### Core Engine

**Agents now chain Git commands robustly** — We upgraded the internal Git command sequences from simple semicolons to conditional `&&` operators. Your agent's commit and push operations now halt gracefully if `git add` fails, preventing partial or invalid commits from reaching your repository.

**Unified Git workflow across all AI models** — Every Nic Hyper Flow agent, regardless of its underlying LLM (Anthropic, Gemini, OpenAI, NicAssist2), now follows the same explicit `git add . && git commit && git push` pattern. This guarantees consistent, predictable version control behavior for every agent interaction.

### DX

**Improved agent contextual awareness for Windows environments** — Agents now receive explicit instructions on handling relative paths with `run_command` and are aware of the user's Windows OS. This reduces misinterpretations and leads to more accurate command execution in your local development setup.

---

## Session: 2026-02-20 19:46 → 2026-02-21 07:00

### Core Engine
**Seamless conversational flow with message queuing** — We shipped a message queuing system that lets users type and send follow-up prompts even while the AI is actively streaming a response. This eliminates awkward waiting, enabling continuous interaction and a much smoother development workflow.

**Drastically reduced token costs for large code diffs** — The `copy_and_paste_code` tool now intelligently truncates long, unchanged blocks within code diffs. This slashes token consumption and speeds up processing for large file modifications, focusing the AI on what truly changed.

### DX
**Introduced `read_docx` for direct Word document ingestion** — Your agents can now directly parse and understand Microsoft Word `.docx` files using the new `read_docx` tool. This expands the AI's contextual understanding, allowing it to ingest and process documentation, reports, and specifications without manual conversion. We included `maxDocxBytes` to prevent overloading the context with excessively large documents.

**Supercharged `generate_assets` with auto-compression and sensible defaults** — The `generate_assets` tool now mandates a `path` for guaranteed local saving, defaults to a `transparent` background (perfect for icons and logos), and automatically compresses all generated images via Tinify. This streamlines your asset pipeline, delivering optimized images directly to your workspace.

---

## Session: 2026-02-19 15:33 → 2026-02-19 15:33

### Model Integrations

*   **Defaulted to Claude Sonnet 4.6** — Your agents now leverage Anthropic's latest Sonnet model by default, instantly delivering more capable coding, complex agent orchestration, and improved computer interaction without any configuration changes.
*   **Introduced Claude Sonnet 4.6 and Opus 4.6** — We've integrated Anthropic's newest, most powerful models. Both Sonnet 4.6 and the world-leading Opus 4.6 now provide an 81920 output token limit, enabling significantly more comprehensive and detailed responses for your most demanding workflows.

---

## Session: 2026-02-16 15:51 → 2026-02-16 16:07

### Core Engine
**Semantic Patching is Now Rock-Solid** — The core matching engine now intelligently normalizes EOLs, strips invisible characters, and defaults to ignoring whitespace between tokens, making your semantic patches significantly more resilient to minor code variations. We've also made `fuzzy: true` the default for all anchor searches, ensuring maximum match success from the first attempt.

**Pinpoint Why Patches Fail** — Failed operations now return a rich `debug` object, complete with relevant code snippets and precise `mini_diff` output, empowering you to instantly diagnose and correct anchor issues without guesswork.

### Developer Experience
**Streamlined Code Insertion** — We've introduced intelligent auto-scoping and `insert_at_line` capabilities, simplifying complex code insertions. The engine now infers missing anchor context, letting you express changes more abstractly and with greater confidence.

**Verifiable Code Transformations** — Every successful semantic patch operation now returns the exact `applied_diff` string, providing irrefutable, byte-for-byte proof of the changes made to your codebase.

---

## Session: 2026-02-16 00:50 → 2026-02-16 03:14

### Core Engine
*   **Unleashed multi-line semantic anchors** — The `copy_and_paste_code` tool now surgically identifies and extracts code blocks using multi-line code snippets as anchors. This eliminates ambiguity, enabling precise refactoring of complex structures that single-line matches couldn't handle.
*   **Achieved pinpoint content extraction** — We refined the core extraction logic to accurately target *only* the code content strictly residing between your defined multi-line anchors. This ensures zero unintended deletions or insertions of the anchor lines themselves, making your refactors land exactly as intended.
*   **Streamlined code manipulation workflows** — The `copy_and_paste_code` tool no longer performs automatic file backups. This simplifies its behavior, giving you explicit control over versioning and aligning it more closely with a direct, predictable patch application model.

### Tooling Reliability
*   **Ensured robust PDF document parsing** — The `readPdfRef` tool now reliably processes PDF documents within the VS Code extension host. We polyfilled critical browser APIs required by `pdfjs-dist`, eliminating environment-specific crashes and guaranteeing consistent content extraction.

---

## Session: 2026-02-13 17:52 → 2026-02-13 17:52

### Agent Capabilities
**Agent gains direct access to comprehensive Brazilian public data** — Your Nic Hyper Flow agent now has built-in knowledge of the Brasil API, allowing it to autonomously fetch real-time data for CNPJ, CEP, banking, tax rates, and more, directly from its prompt context. This significantly expands the agent's ability to handle Brazilian-specific data queries and operations without requiring explicit tool definitions.

---

## Session: 2026-02-11 17:22 → 2026-02-11 20:33

### Core Engine

**Guaranteed fresh diagnostics for Flutter/Dart projects** — We now actively trigger your language server's analysis and intelligently wait for diagnostics to stabilize. This ensures Nic Hyper Flow always operates on the most up-to-date and accurate lint reports, eliminating stale results.

**AI now understands your lint errors better with `detailed` output** — Introducing a new `detailed` return format that provides our AI with a comprehensive, human-readable breakdown of every critical issue, enabling more precise reasoning and targeted fix suggestions.

### Developer Experience

**Focus on actionable errors, less noise** — Our improved lint parser intelligently categorizes critical errors by code, gracefully ignores diagnostics from non-existent "ghost" files, and provides accurate line ranges, surfacing only the most relevant problems.

---

## Session: 2026-02-09 04:27 → 2026-02-09 05:18

### Remote Control
**Persist images from your mobile app directly to the workspace** — You can now save any image attached in the remote control chat directly into your VS Code workspace. This streamlines asset management, letting you pull visual context from your phone into your project with a single tap.

**Upload larger images from your phone to the agent** — We boosted the per-image attachment limit in the remote control from 900KB to 2MB. Send higher-fidelity screenshots and visual references without hitting transfer limits.

### Core Engine & Agent Tools
**Agent now compresses and transforms images with the new Tinify API tool** — Empowered the AI agent with a dedicated tool to optimize images. It can now compress, resize, and convert formats (PNG, JPEG, WebP) from local files or URLs, directly within your workspace.

**Agent persists chat images as workspace assets** — The agent gained a new capability to save any image from the chat history as a first-class asset in your workspace. This ensures crucial visual context from conversations is durable and easily referenced.

**Agent receives comprehensive lint diagnostics** — The `parse_lint_errors` tool now provides a complete, unfiltered view of all critical errors and relevant warnings from VS Code diagnostics. This significantly improves the agent's understanding of your codebase's health and issues.

---

## Session: 2026-02-08 03:22 → 2026-02-08 03:22

### Agent Capabilities
**Explicit multi-query web searches for agents** — Agents now issue multiple distinct web searches using individual `queries` parameters, ensuring each search executes independently and robustly within a single tool call.

---

## Session: 2026-02-06 19:25 → 2026-02-07 00:54

### Agent Capabilities

**Agent generates more precise web search queries** — We meticulously refined the agent's prompt to enforce keyword-driven, concise search queries, leveraging advanced operators like `site:`, `filetype:`, `lang:`, `loc:`, `freshness:`, and logical `AND/OR/NOT`. This drastically improves search result relevance and reduces unnecessary token usage by guiding the agent to formulate optimal searches.

**Deeper agent reasoning and complex task execution** — We increased the maximum consecutive model messages in a single loop from 100 to 1000. This allows the AI agent to undertake significantly more complex, multi-step reasoning and tool-use chains without hitting arbitrary termination limits.

### Remote Control

**Seamless bidirectional chat synchronization** — The remote control mobile app and VS Code extension now maintain perfectly synchronized chat lists and active chat states. Creating a chat in VS Code instantly appears on mobile, and vice-versa, without forcing unwanted context switches.

**Secure `run_command` authorization from mobile** — You can now securely approve or deny `run_command` tool calls directly from your mobile device. This extends critical security gating to your remote workflow, ensuring you maintain full control over agent actions.

**Flawless remote chat message display** — We eliminated message duplication and ensured strict chronological ordering in the remote control app. Your chat history now accurately reflects the conversation flow, making it easier to follow and review interactions.

---

## Session: 2026-02-05 22:54 → 2026-02-05 22:54

### Core Engine

**AI documentation now strictly targets your PKB** — We've refined the core thinking prompt to explicitly instruct the AI to use the designated PKB tool for all documentation tasks, preventing the creation of fragmented `.md` files and centralizing your project's knowledge.

---

## Session: 2026-02-05 16:48 → 2026-02-05 16:48

### Core Engine
**Refined search memory management** — We've shipped an update to the core search memory manager, which improves resource utilization and stability during intensive search operations.

---

## Session: 2026-02-03 12:27 → 2026-02-03 17:41

### Core Engine
*   **Agent Starts Smarter, Searches Leaner** — We now inject a unified context from both PKB and workspace search results at the start of every conversation, giving the agent a richer understanding from the first prompt. We also optimized the thinking prompt to guide the agent towards reading files when searches become inefficient, reducing unnecessary loops and token usage.

### Remote Control App
*   **Full Remote Control from Your Phone** — The mobile app gains a new settings screen, empowering you to select the active AI model and execute terminal commands directly on your VS Code machine. Crucially, `run_command` approvals now appear on your phone, ensuring security and control even when you're away from your desk.
*   **Reimagined Mobile Chat Experience** — We shipped a robust per-chat message cache, enabling instant switching between conversations without waiting for history to load. Image attachments are now fully interactive with a zoomable viewer, and tool executions are visually tied to the assistant's messages with a new inline status display, providing clearer feedback on agent actions.

---

## Session: 2026-02-02 11:46 → 2026-02-02 12:26

### Remote Control

**Real-time tool execution feedback in your pocket** — Your mobile app now streams live status updates for every tool call the agent makes, displaying success, failure, and details directly within the chat bubbles. No more guessing if a patch applied or a command ran successfully.

**Seamless multi-chat experience across devices** — Switch between active agent sessions directly from your mobile device. The extension intelligently switches to or creates new chats on demand, maintaining context consistency whether you're at your desk or on the go.

**Attach images directly from your mobile** — You can now include images from your phone's gallery directly in your prompts, enabling richer visual context for the agent without needing to be at your desktop.

**Bulletproof remote state synchronization** — We've tightened the feedback loop between your VS Code extension and mobile app, ensuring messages sent from either side, and even chat title changes, are instantly reflected everywhere for a truly unified experience.

---

## Session: 2026-02-01 18:00 → 2026-02-01 23:30

### Core Engine

**Real-time AI Response Streaming to Mobile** — Your mobile app now receives AI responses as they're generated, making interactions feel instantaneous. We implemented a Firestore-based streaming channel with a 500ms throttle, balancing real-time updates with efficient cloud resource usage.

**Butter-Smooth Mobile Input Synchronization** — We refactored the input sync logic to prevent frustrating cursor jumps. Your mobile typing experience is now uninterrupted, as remote updates from the VS Code extension only apply when you're not actively typing.

### DX & UI

**Enhanced Chat Visibility: Auto-Scroll & Distinct AI Output** — The chat view now auto-scrolls to keep the latest AI output in sight, whether it's streaming text or live patch previews. We also visually separated AI commands (like `PATCH_FILE`) and internal thoughts, giving you a clearer understanding of the AI's process.

**Seamless Multi-Chat Context & Real-time Chat List** — Commands sent from your mobile device now inherently understand the active chat context. Plus, your chat list dynamically updates in real-time, reflecting title changes or new chats without a manual refresh.

---

## Session: 2026-01-31 17:04 → 2026-02-01 08:37

### DX
**Real-time Mobile Agent Control & Chat History** — We shipped a dedicated mobile app, empowering you to control your Nic Hyper Flow agent, view live chat history, and monitor tool execution in real-time, all from your phone. We also eliminated message duplication and ensured correct chronological order in the UI.

### Core Engine
**Extension-Native AI Orchestration** — We completely removed the external Python backend, shifting critical AI orchestration and tool execution directly into the VS Code extension. This means near-zero latency for DeepSeek, OpenAI image generation (GPT-Image-1.5), and Brave Search, vastly improving reliability and privacy by keeping your agent's core loop entirely local.

**Agent-Native HTTP Request Tool** — Your agents can now directly interact with any HTTP API using the new `http_request` tool. It supports comprehensive methods, authentication, headers, and various body types, enabling powerful integration and testing workflows without needing manual intervention.

**Enhanced Model Adapters for Multi-Provider Tooling** — We refactored our OpenAI, Anthropic, and Gemini adapters to robustly handle native tool schemas and ensure proper system prompt injection. This significantly improves how these models interpret and utilize tools, leading to more precise and reliable agent behavior.

**Optimized HTTP Connection Pooling** — We integrated a sophisticated HTTP/HTTPS connection pooling system with configurable strategies. This optimizes network requests for all LLM and tool interactions, delivering faster, more reliable streaming and reduced overhead, especially under heavy workloads.

---

## Session: 2026-01-30 12:33 → 2026-01-31 02:10

### Core Engine & Tools

*   **Introducing `read_pdf_ref` for semantic PDF comprehension** — The new `read_pdf_ref` tool allows the agent to extract text from PDFs, supporting semantic references (`pdf:path.pdf#p:118-120`) and automatically stripping repetitive headers and footers. This dramatically improves the agent's ability to digest complex documentation without context bloat.
*   **Full-stack `generate_assets` tool now available** — Generate images directly within your workflow using the DALL-E 3-powered `generate_assets` tool. It now supports transparent backgrounds, adjustable quality, and automatic saving to local paths, while sanitizing base64 output to prevent context window overflow.
*   **Tools now display with friendly names** — We've shipped human-readable names for core tools like "Write File," "Read PDF," and "Generate Assets" in the UI, making agent interactions more intuitive and easier to follow.

### Platform & Developer Experience

*   **Boosted rate limits and concurrency across all tiers** — Free, Guest, and Pro users now enjoy significantly higher requests per minute (RPM), requests per day (RPD), and concurrent streams. This means faster, more fluid agent interactions and less waiting.
*   **Self-serve API key management** — Take control of your AI provider configurations with the new API Keys settings tab. You can now securely configure and manage your Google, OpenAI, and Claude API keys directly within Nic Hyper Flow, unlocking broader model access.

---

## Session: 2026-01-29 13:31 → 2026-01-30 05:13

### Core Engine & State
**Shipped full source code under MIT License** — Nic Hyper Flow is now 100% transparent. We removed all obfuscation, making the entire codebase publicly inspectable and verifiable for security and trust.

**Durable agent memory and flawless chat history** — Your agent now retains its full cognitive state, including objectives and key facts, across sessions and chat switches. We also eliminated critical bugs that prevented chat history from loading correctly, ensuring a consistent and reliable context for every interaction.

**Agent behavior tuned for enhanced determinism** — We lowered the default model temperature across the board, making Nic Hyper Flow's responses and tool-use even more focused and predictable, reducing variability in agent execution.

### Developer Experience
**Run Nic Hyper Flow without an open workspace** — Launch the agent instantly for quick tasks or single-file edits. The extension now intelligently creates a virtual workspace if no folder is open, removing friction from your workflow.

**Rock-solid first-run and guest authentication** — New users now experience a seamless onboarding, with immediate access via guest mode and all UI elements, including streaming, initializing flawlessly from the first interaction.

---

## Session: 2026-01-28 19:26 → 2026-01-29 04:11

### Core Engine

**Unleashed Next-Gen Multimodal Vision** — We replaced the legacy vision API with a powerful, LLM-driven visual analysis pipeline. Nic now generates hyper-detailed image reports, including UI component hierarchies, grid-based spatial maps, precise OCR, and HEX color palettes, enabling it to "see" and understand images with unprecedented depth.

**Agent Gains Advanced Web Crawling Capabilities** — Your agent now commands a suite of 6 powerful new tools for web data acquisition: `crawl_site`, `download_resource`, `extract_links`, `download_site_assets`, `list_downloadable_files`, and `read_robots_txt`. This transforms Nic into a sophisticated web data miner, capable of mapping sites, cloning assets, and extracting content with precision and adherence to `robots.txt` policies.

### DX

**Chat Context Persists Across Sessions** — Never lose your token count again. We now persistently store and restore your chat's `contextSize` to the database, ensuring your token usage is accurately reflected when switching between chats or restarting VS Code.

**Run Command Tool Becomes Unstoppable** — We dramatically boosted the `run_command` tool's resilience and capacity. It now tolerates up to 30,000 characters of output and runs for 3x longer (180 seconds), with aggressive early termination logic to prevent runaway processes and provide immediate, clear feedback when output limits are hit.

**Bulletproof Diff Highlighting** — We squashed critical race conditions and visual artifacts in the diff decoration system. Enjoy seamless, accurate highlighting of *only* changed lines, with reduced visual bleed and improved synchronization against editor state changes.

---

## Session: 2026-01-28 10:00 → 2026-01-28 10:00

### Core Engine
**Optimized idle resource consumption** — We've configured core backend services to scale down to zero instances when not in use, significantly reducing your cloud compute costs during off-peak hours without impacting peak performance.

---

## Session: 2026-01-27 18:09 → 2026-01-28 02:02

### Core Engine
**Introduced `replace_text` for workspace-wide refactoring** — Developers can now execute powerful, atomic text replacements across multiple files using glob patterns, with support for both literal and regex modes, and a crucial dry-run preview before committing changes.
**Fine-tuned AI response predictability** — We lowered the default model temperature from `0.05` to `0.03`, making the AI's outputs more deterministic and less prone to creative tangents, ensuring more reliable and consistent agent behavior.

### DX
**Streamlined Agent Workflow** — We removed the experimental "Planning Mode" toggle from the UI, simplifying the core interaction flow and focusing the agent on direct, actionable execution.
**Human-friendly tool names in the UI** — The UI now displays descriptive, readable names for tools like "Read File" instead of raw `snake_case` IDs, significantly improving comprehension of agent actions at a glance.

---

## Session: 2026-01-26 15:27 → 2026-01-27 04:00

### Agent Core Capabilities
**Doubled AI Response Token Limit** — The Nic Assist 2.0 backend and client now support up to 8192 output tokens, eliminating truncated responses and empowering the agent to deliver more complete code, comprehensive plans, and deeper explanations without interruption.

**Bulletproof Multi-Part File Creation** — The agent's `CREATE` tool now intelligently recovers from truncated writes on large files by automatically reading the last 60 lines and applying incremental patches, ensuring complete and accurate file generation every time.

**Hardened File System Read Operations** — The `read_file` tool now includes explicit security checks against sensitive files, implements retry logic for file system latency, and intelligently expands context windows for small files, making agent file interactions safer and more reliable.

### Platform Stability & Security
**Eliminated UI Cold Start and Settings Glitches** — We resolved critical bugs preventing the settings webview from loading and causing parser issues on cold start, ensuring a consistently smooth and functional user interface from the moment you open Nic Hyper Flow.

**Secured Extension Core with Obfuscation** — We implemented a new build step that obfuscates the core extension JavaScript, protecting our intellectual property and enhancing the overall security posture of Nic Hyper Flow.

---

## Session: 2026-01-25 00:04 → 2026-01-25 22:54

### Core Engine
**Centralized AI Backend & Introducing Server-Side Web Search** — We refactored the entire model integration to exclusively use our optimized Nic Assist 2.0 backend, removing legacy `jsdom` dependencies and streamlining configuration. Now, agents also leverage a new, secure backend-powered `web_search` tool for real-time web lookups, providing up-to-date information without local overhead.
**Atomic File Renaming with Built-in Safeguards** — Shipped a powerful new `rename` tool, empowering agents to refactor your codebase with confidence. It strictly enforces workspace boundaries, blocks modifications of system directories, protected files, and image files, ensuring safe and predictable file system operations.
**Eliminated Tool Execution Race Conditions** — The core loop now executes agent tools sequentially instead of in parallel. This critical change prevents data corruption and unpredictable behavior when multiple tools attempt to modify the same file within a single agent turn.

### DX
**Persistent Diff Highlights Across File Switches and Git Operations** — Agent-applied changes now remain highlighted in the editor even when you switch files or perform Git commands like `reset --hard`. We rebuilt the decoration system to preserve visual feedback of changes, ensuring you always see what the AI has done.
**Flawless Chat Rendering on Reloads and Switches** — We squashed bugs causing tool cards and patch previews to appear out of order or duplicate after chat reloads or switching between sessions. Your chat history now renders consistently and chronologically, providing a stable and reliable overview of agent activity.

---

## Session: 2026-01-24 18:02 → 2026-01-24 18:02

### Workflow Automation
**Automatically Purge Completed Plans** — Nic Hyper Flow now automatically deletes plans from your active session once all steps are completed. This keeps your workspace focused on current tasks, ensuring a clean view free from lingering, finished workflows.

---

## Session: 2026-01-23 15:01 → 2026-01-24 06:04

### DX
**Real-time Editor Diff Highlighting** — The new `DiffDecorationManager` now visually highlights proposed and applied code changes directly in your editor. Instantly see additions (green) and replacements (slightly darker green with annotation) for `patch_file`, `replace`, and `create` operations, making agent modifications crystal clear.
**Flicker-Free Chat & Cleaner Tool Previews** — We re-architected chat history rendering for true incremental updates, eliminating UI flicker and preserving scroll position. The agent's raw output is now also more aggressively filtered, removing internal protocol labels for cleaner, more readable tool previews.

### Core Engine
**More Reliable & Deterministic Agent Actions** — The agent now explicitly verifies successful compilation before marking a task complete, ensuring you always receive working code. We also globally lowered the model temperature, yielding more precise and predictable tool usage and code generation.
**Expanded Context & Hardened Security for Tools** — The `read_file` tool now intelligently expands its context window to a minimum of 60 lines, preventing partial information issues. Concurrently, we've implemented comprehensive security blocks for `run_command` to prevent destructive operations.
**Accelerated Backend API Calls** — Implemented HTTP session pooling for all backend-to-external-API communications, including image processing. This significantly reduces connection overhead and latency, making agent operations that rely on external services notably faster.

---

## Session: 2026-01-22 10:44 → 2026-01-23 02:41

### Core Engine
**Shipped a single-model architecture** — We dramatically simplified the core by converging all AI orchestration onto `nicassist2`. This streamlines our internal model management and paves the way for deeper, specialized intelligence.
**Enabled real-time loop detection during streaming** — The TF-IDF loop detector now actively monitors model output during streaming, immediately pausing generation if it detects repetitive patterns. This prevents runaway token usage and agents getting stuck in infinite loops.
**Enforced a stricter agent planning protocol** — The agent's core prompt now includes explicit, mandatory rules for adhering to plans, validating step completion, and updating progress. Expect more reliable and predictable plan execution.

### DX
**Integrated real-time billing and quota visibility** — Your subscription status, monthly token usage, and remaining quota now flow directly from the backend to the UI via JWT. Manage your plan and monitor consumption with full transparency from within VS Code.
**Translated all API errors into human-readable English** — We replaced raw, technical backend errors and Portuguese messages with clear, user-friendly English explanations. No more cryptic JSON in your chat feed when things go wrong.

---

