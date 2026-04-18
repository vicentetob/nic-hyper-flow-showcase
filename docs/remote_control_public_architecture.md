# Remote Control — Architecture Overview

This document provides a high-level overview of how the Nic Hyper Flow VS Code extension communicates securely with the Flutter Mobile companion app in real-time.

---

## 🏗️ System Topology

The remote control system is designed to provide ultra-low latency real-time control over the VS Code agent without exposing the local machine to the open web or relying on heavy database polling.

It operates on a three-tier architecture:

| Tier | Responsibility |
|------|-----------------|
| **Signaling Backend** | Out-of-band QR pairing, ephemeral session publishing, and tunnel discovery. |
| **Encrypted WebSocket Tunnel** | All real-time live traffic (agent state, streaming, tool approvals, user input). |
| **Local Persistence Engine** | The extension's internal SQLite database acts as the strict Source of Truth for chat history. |

---

## 🔐 Secure Connection Flow (Abstract)

To ensure the local VS Code instance remains secure, Nic Hyper Flow never exposes local ports directly. Instead, it uses an ephemeral reverse tunnel topology:

1. **Out-of-Band Auth:** The extension generates a secure, time-sensitive QR code paired with a signaling backend.
2. **Mobile Handshake:** The Flutter app scans the QR code, authenticates via OAuth, and completes the pairing with the backend.
3. **Ephemeral Tunnel:** The extension boots a local WebSocket server bound strictly to `localhost` and initiates a secure reverse tunnel (via Cloudflare infrastructure).
4. **Session Discovery:** The extension securely publishes the encrypted, ephemeral tunnel URL to the signaling backend.
5. **Direct WSS Connection:** The mobile app retrieves the tunnel URL and establishes a direct WebSocket connection to the extension using a secure session token.

Once the handshake is complete, the signaling backend steps out of the way. All heavy traffic (token streaming, agent reasoning, UI updates) flows directly through the encrypted WebSocket tunnel.

---

## ⚡ Real-Time Traffic & State Sync

The mobile app does **not** rely on database snapshots or polling. Everything is event-driven via the WebSocket connection.

### Bidirectional State Synchronization
To guarantee that a state change (e.g., toggling `Focused Mode` or `Reasoning Effort`) reflects instantly on both the VS Code UI and the mobile app, Nic uses **VS Code's Native Configuration API as the Single Source of Truth**.

1. **Mobile Trigger:** The app sends a state update payload via WebSocket.
2. **Extension Handler:** The extension receives the payload and updates the global VS Code configuration workspace.
3. **Event Bus:** VS Code fires `onDidChangeConfiguration`. The extension listens to this native event.
4. **Re-broadcast:** The extension broadcasts the new state back to the Webview UIs and sends a confirmation sync back to the Flutter app.

This loop prevents double-renders and ensures the VS Code configuration file always remains the ultimate master state.

---

## 💾 Local-First Persistence

While the remote control feels like a cloud app, your code and conversation data never live on our servers. 

When the mobile app requests chat history, it sends a `history/request` packet via WebSocket. The VS Code extension queries its local SQLite database (`better-sqlite3` / `sql.js`) and streams the data back to the phone. Your IP and source code context remain safely within your local environment.