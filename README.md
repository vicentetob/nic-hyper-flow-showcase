# 🧠 Nic Hyper Flow

> A local multi-agent AI orchestration engine living inside your VS Code, controllable via a mobile app.

[![VS Code Marketplace](https://img.shields.io/badge/Available%20on-Marketplace-blue.svg)](https://marketplace.visualstudio.com/items?itemName=NicHyperFlow.nic-hyper-flow-alpha2) [![Flutter Remote](https://img.shields.io/badge/Companion_App-Flutter-02569B.svg)](https://github.com/vicentetob/nic-hyper-flow-showcase/tree/master/remote_control)

Nic Hyper Flow is a persistent cognitive architecture built for VS Code. It doesn't just autocomplete code; it reads files, edits in batches, manages persistent terminal sessions (`node-pty`), controls headless browsers (`playwright`), and reasons through a 64-state machine before acting.

## 🏗️ The Engineering

Most AI extensions are simple API wrappers. Nic is built as a distributed system with a local core:

* **Remote Control via Reverse Tunnels:** Control the VS Code agent from your smartphone. The extension boots a local WebSocket server, exposes it via an ephemeral `cloudflared` tunnel, and pairs with the Flutter app via a secure QR code handshake. [Read the Architecture Doc](./docs/remote_control_public_architecture.md).
* **Local Persistence (SQLite):** Chat history, context memory, and cognitive time-travel are stored locally using `sql.js`, ensuring zero latency and total privacy for your data.
* **Single Source of Truth State Sync:** Instant bidirectional state synchronization between the VS Code UI (React/Webviews) and the Flutter Mobile app using VS Code's native configuration API as the central event bus.
* **Multi-Provider Adapter:** Seamlessly hot-swaps between Claude 3.5 Sonnet, DeepSeek, OpenAI GPT-4o, Gemini, and local `Ollama` models based on the cognitive load of the task.

## 🛠️ The Toolbelt (60+ Native Actions)

The agent operates directly on your machine through secure tool interfaces:
* `apply_patch_batch`: Atomic file edits with automatic rollback on failure.
* `terminal_start` / `terminal_send`: Spawns and interacts with persistent shell sessions.
* `browser_action`: Playwright integration to visually debug web apps.
* `adb_input` / `adb_screenshot`: Native Android device control for mobile UI debugging.
* *And over 50 more native tools.*

## 📂 About this Repository (Showcase)

**This is a showcase repository.** 
The cognitive orchestration loop, state machine, and context chunking algorithms are proprietary and closed-source. However, this repository exposes the architectural boundaries, the tool implementations (`src/tools/`), the VS Code UI configuration, and the complete source code of the Flutter Remote Control app (`remote_control/`) to demonstrate the engineering standards.

## 🚀 Get Nic Hyper Flow

Ready to upgrade your development environment?
[👉 Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=NicHyperFlow.nic-hyper-flow-alpha2)