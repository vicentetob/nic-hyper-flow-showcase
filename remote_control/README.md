# 📱 Nic Hyper Flow - Remote Control

> The Flutter companion app that turns your smartphone into a secure, real-time command center for your VS Code AI agent.

This directory contains the complete source code for the **Nic Hyper Flow Remote Control** application, built with Flutter.

## 🎯 Why a Mobile App for a VS Code Extension?

AI agents executing code, running terminal commands, and modifying files locally shouldn't chain you to your desk. This companion app allows developers to:
- 🚶‍♂️ Step away from the keyboard while the AI reasons through and executes complex multi-step workflows.
- 👁️ Monitor the agent's cognitive states, token streams, and output in real-time.
- 🛡️ Remotely approve or reject file edits and terminal commands (`Edit Approval Mode`).
- ⚡ Switch AI models, project contexts, and toggle the `Focused Mode` from anywhere.

## 🏗️ Architecture & Engineering

This is not a standard REST-based CRUD app. It's a low-latency, real-time event consumer hooked directly into a local VS Code instance.

* **State Management:** Powered by `GetX` for reactive UI updates and dependency injection.
* **Real-time Engine:** Uses `web_socket_channel` to maintain a persistent connection with the VS Code extension via ephemeral Cloudflare reverse tunnels. Zero database polling for chat streams.
* **Security & Auth:** Pairing is done out-of-band via secure QR code scanning (`mobile_scanner`). The app connects directly to the encrypted tunnel without exposing the developer's local network ports.
* **Resilience:** Implements a robust, centralized logging service catching global Dart exceptions and Platform Dispatcher errors. (See [LOGGING_IMPLEMENTATION.md](./LOGGING_IMPLEMENTATION.md)).
* **Single Source of Truth:** Bidirectional state synchronization ensures that changes made on the mobile app instantly reflect on the VS Code Webview UI, and vice versa.

## 📂 Structure Highlights

- `lib/app/modules/` - Feature-based architecture (Auth, Chat, Settings, Sessions).
- `lib/app/services/` - Core infrastructure (WsService, AuthService, LoggingService).
- `lib/app/modules/chat/widgets/` - Granular UI components for rendering AI reasoning, tool approvals, and markdown streams.

## ⚠️ Showcase Note

This is part of the **Nic Hyper Flow Showcase Repository**. 
For security reasons, actual Firebase credentials, `google-services.json`, and API keys have been stripped and replaced with generic placeholders in `firebase_options.dart`. 

## 🚀 Running Locally

If you want to explore the UI or compile the app locally:

1. Ensure you have the Flutter SDK (`^3.10.4`) installed.
2. Run `flutter pub get`
3. *Note:* To achieve a fully functional build, you will need to link your own Firebase project using the `flutterfire configure` CLI, replacing the placeholder data.
4. Run `flutter run`
