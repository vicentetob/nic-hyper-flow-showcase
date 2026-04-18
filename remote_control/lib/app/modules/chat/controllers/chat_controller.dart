import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:remote_control/app/services/device_session_service.dart';
import 'package:remote_control/app/services/ws_service.dart';
import 'package:remote_control/app/services/logging_service.dart';

import '../models/chat_model.dart';
import '../models/tool_status_model.dart';
import '../services/message_cache_service.dart';

class ChatController extends GetxController {
  // Main controller for chat interactions
  final ImagePicker _picker = ImagePicker();
  final RxList<XFile> selectedImages = <XFile>[].obs;
  final DeviceSessionService _session = DeviceSessionService.to;
  int _nextChatSequence = 1;

  // Text Editing
  final TextEditingController textController = TextEditingController();
  final RxString currentInputText = ''.obs;

  // Chat Management
  final RxList<Chat> chats = <Chat>[].obs;
  final RxString selectedChatId = ''.obs;

  // State
  final RxBool isStreaming = false.obs;
  final RxList<Map<String, dynamic>> messages = <Map<String, dynamic>>[].obs;
  final RxMap<String, dynamic> streamingMessage = <String, dynamic>{}.obs;
  final RxString selectedModelId = ''.obs;
  final RxString currentWorkspaceName = ''.obs;
  final RxString currentWorkspacePath = ''.obs;
  final RxString currentRepositoryName = ''.obs;
  final RxInt currentContextSize = 0.obs;
  final RxDouble currentChatCostUsd = 0.0.obs;
  final RxString currentReasoningEffort = 'medium'.obs;
  final RxBool isFocusedMode = false.obs;
  final RxBool isSummarizingContext = false.obs;

  // Tool Status Management
  final RxList<ToolStatus> toolStatuses = <ToolStatus>[].obs;
  final RxMap<String, ToolStatus> _streamingToolCalls = <String, ToolStatus>{}.obs;

  // Robust per-chat cache
  late final MessageCacheService _messageCache = MessageCacheService(
    maxChats: 40,
    maxMessagesPerChat: 400,
  );

  // Available models (populated from models/update)
  final RxList<Map<String, dynamic>> availableModels = <Map<String, dynamic>>[].obs;

  // Edit approval mode: 'apply_everything' | 'ask_before_apply'
  final RxString editApprovalMode = 'apply_everything'.obs;

  // Command authorization
  final RxMap<String, dynamic> pendingApproval = <String, dynamic>{}.obs;

  final WsService _ws = WsService.to;

  Timer? _debounceTimer;
  Timer? _chatMetadataRefreshTimer;
  // WebSocket subscriptions (real-time data)
  StreamSubscription? _wsStateSub;
  StreamSubscription? _wsStreamChunkSub;
  StreamSubscription? _wsStreamEndSub;
  StreamSubscription? _wsToolCallSub;
  StreamSubscription? _wsInputSub;
  StreamSubscription? _wsChatMessageSub;
  StreamSubscription? _wsChatHistorySub;
  StreamSubscription? _wsModelsUpdateSub;
  StreamSubscription? _wsChatListSub;
  StreamSubscription? _wsChatActiveSub;
  StreamSubscription? _wsChatUpdateSub;
  StreamSubscription? _wsChatMetricsSub;
  StreamSubscription? _wsChatTitleUpdateSub;
  // Firestore subscription (presence/root metadata only)
  StreamSubscription? _sessionRootSub;
  StreamSubscription? _wsApprovalRequestSub;
  StreamSubscription? _wsProjectsSub;

  final RxString agentStatus = ''.obs;

  @override
  void onInit() {
    super.onInit();
    
    // Ouvir mudança de device selecionado para reiniciar listeners
    ever(_session.selectedDeviceId, (_) {
      _cancelAllSubscriptions();
      if (_session.isConnected) {
        _setupListeners();
        loadChats();
      } else {
        chats.clear();
        messages.clear();
        streamingMessage.clear();
        toolStatuses.clear();
        _streamingToolCalls.clear();
      }
    });

    if (_session.isConnected) {
      _setupListeners();
      if (_ws.isConnected.value) {
        loadChats();
      }
    }

    ever(_ws.isConnected, (bool connected) {
      if (connected && _session.isConnected) {
        loadChats();
      }
    });
  }

  void _cancelAllSubscriptions() {
    // WebSocket
    _wsStateSub?.cancel();
    _wsStreamChunkSub?.cancel();
    _wsStreamEndSub?.cancel();
    _wsToolCallSub?.cancel();
    _wsInputSub?.cancel();
    _wsChatMessageSub?.cancel();
    _wsChatHistorySub?.cancel();
    _wsModelsUpdateSub?.cancel();
    _wsChatListSub?.cancel();
    _wsChatActiveSub?.cancel();
    _wsChatUpdateSub?.cancel();
    _wsChatMetricsSub?.cancel();
    _wsChatTitleUpdateSub?.cancel();
    _wsApprovalRequestSub?.cancel();
    _wsProjectsSub?.cancel();
    _sessionRootSub?.cancel();
    _chatMetadataRefreshTimer?.cancel();
  }

  int _extractChatSequence(String title) {
    final normalized = title.trim();
    const prefix = 'chat ';
    if (!normalized.toLowerCase().startsWith(prefix)) return 0;
    return int.tryParse(normalized.substring(prefix.length).trim()) ?? 0;
  }

  @override
  void onClose() {
    textController.dispose();
    _debounceTimer?.cancel();
    _cancelAllSubscriptions();
    super.onClose();
  }

  void _applyStatePayload(Map<String, dynamic> data) {
    isStreaming.value = data['isStreaming'] == true;
    isFocusedMode.value = data['focusedMode'] == true;
    final effort = data['reasoningEffort'] as String?;
    if (effort != null && effort.trim().isNotEmpty) {
      currentReasoningEffort.value = effort.trim();
    }
    final dynamic contextSize = data['contextSize'];
    if (contextSize is num) currentContextSize.value = contextSize.toInt();
    final dynamic chatCost = data['chatApiCostUsd'];
    if (chatCost is num) currentChatCostUsd.value = chatCost.toDouble();
    final mode = data['editApprovalMode'] as String?;
    if (mode == 'apply_everything' || mode == 'ask_before_apply') {
      editApprovalMode.value = mode!;
    }
  }

  void _setupListeners() {
    if (!_session.isConnected) return;

    _scheduleChatMetadataRefresh();

    // ── WebSocket listeners (zero-latency real-time data) ──────────────────

    // state/update — substitui o antigo doc extensionState; agora chega por WS
    _ws.on('status/update').listen((payload) {
      if (payload is Map<String, dynamic>) {
        agentStatus.value = (payload['text'] as String? ?? '').trim();
      }
    });

    _wsStateSub = _ws.on('state/update').listen((payload) {
      if (payload is Map<String, dynamic>) _applyStatePayload(payload);
    });

    // stream/chunk — substitui o antigo streamingResponse; agora chega por WS
    _wsStreamChunkSub = _ws.on('stream/chunk').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final chatId = payload['chatId'] as String? ?? '';
        if (selectedChatId.value.isEmpty || chatId == selectedChatId.value) {
          streamingMessage.value = {
            'id': payload['messageId'] ?? 'streaming',
            'content': payload['content'] ?? '',
            'role': payload['role'] ?? 'assistant',
            'timestamp': payload['timestamp'] ?? '',
            'source': 'vscode_extension',
            'chatId': chatId,
            'isStreaming': true,
          };
        }
      }
    });

    // stream/end — streaming finished; upsert final assistant message into cache
    _wsStreamEndSub = _ws.on('stream/end').listen((payload) {
      streamingMessage.clear();
      if (payload is Map<String, dynamic>) {
        final chatId = (payload['chatId'] as String?) ?? '';
        if (chatId.isNotEmpty) {
          _messageCache.upsertFromPlainData([payload]);
          if (chatId == selectedChatId.value) _rebuildMessagesFromCache();
        }
      }
    });

    // chat/message — nova mensagem viva; substitui o antigo espelhamento de messages no Firestore
    _wsChatMessageSub = _ws.on('chat/message').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final chatId = (payload['chatId'] as String?) ?? '';
        if (chatId.isNotEmpty) {
          _messageCache.upsertFromPlainData([payload]);
          if (chatId == selectedChatId.value) _rebuildMessagesFromCache();
        }
      }
    });

    // chat/history — response to chat/history/request
    _wsChatHistorySub = _ws.on('chat/history').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final chatId = (payload['chatId'] as String?) ?? '';
        final msgs = payload['messages'];
        if (chatId.isNotEmpty && msgs is List) {
          _messageCache.upsertFromPlainData(msgs.whereType<Map<String, dynamic>>());
          _messageCache.markHistoryLoaded(chatId);
          if (chatId == selectedChatId.value) _rebuildMessagesFromCache();
        }
      }
    });

    // stream/toolCall — substitui o antigo streamingToolCalls; agora chega por WS
    _wsToolCallSub = _ws.on('stream/toolCall').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final status = ToolStatus.fromFirestore({
          ...payload,
          'id': payload['toolCallId'] ?? '',
        });
        _upsertToolStatus(status);
      }
    });

    // input/update — substitui o antigo doc input no sentido extensão → mobile
    _wsInputSub = _ws.on('input/update').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final remoteText = payload['text'] as String? ?? '';
        final source = payload['source'] as String? ?? '';
        if (source == 'vscode_extension' && remoteText != textController.text) {
          textController.text = remoteText;
          textController.selection = TextSelection.fromPosition(
            TextPosition(offset: textController.text.length),
          );
        }
      }
    });

    // models/update — substitui os antigos docs selectedModel/models; agora chega por WS
    _wsModelsUpdateSub = _ws.on('models/update').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final modelId = (payload['selectedModelId'] as String?) ?? '';
        if (modelId.isNotEmpty) selectedModelId.value = modelId;
        final items = payload['items'];
        if (items is List) {
          availableModels.assignAll(items.whereType<Map<String, dynamic>>().toList());
        }
      }
    });

    // chat/list — full chat list pushed by extension on connect or on request
    _wsChatListSub = _ws.on('chat/list').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final raw = payload['chats'];
        if (raw is List) _applyRemoteChatList(raw.whereType<Map<String, dynamic>>().toList());
      }
    });

    // chat/active — extension changed active chat
    _wsChatActiveSub = _ws.on('chat/active').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final chatId = (payload['chatId'] as String? ?? '').trim();
        if (chatId.isEmpty) return;
        if (chatId == selectedChatId.value) {
          // Same chat (e.g. after reconnect): just refresh history if cache is empty
          if (_messageCache.shouldFetchHistory(chatId)) {
            _requestChatHistory(chatId);
          }
          return;
        }
        if (chats.any((c) => c.id == chatId)) {
          unawaited(selectChat(chatId));
        } else {
          selectedChatId.value = chatId;
          _rebuildMessagesFromCache();
          if (_messageCache.shouldFetchHistory(chatId) || !_messageCache.hasChat(chatId)) {
            _requestChatHistory(chatId);
          }
        }
      }
    });

    // chat/update — single chat metadata changed
    _wsChatUpdateSub = _ws.on('chat/update').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final chatId = (payload['chatId'] as String?) ?? '';
        if (chatId.isEmpty) return;
        final idx = chats.indexWhere((c) => c.id == chatId);
        final updated = Chat.fromFirestore({...payload, 'id': chatId});
        if (idx >= 0) {
          chats[idx] = updated;
        } else {
          chats.add(updated);
        }
        if (chatId == selectedChatId.value) {
          currentChatCostUsd.value = updated.apiCostUsd;
          currentContextSize.value = updated.contextSize;
        }
      }
    });

    // chat/metrics — cost/context update
    _wsChatMetricsSub = _ws.on('chat/metrics').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final chatId = (payload['chatId'] as String?) ?? '';
        final idx = chats.indexWhere((c) => c.id == chatId);
        if (idx < 0) return;
        final c = chats[idx];
        final newCost = (payload['apiCostUsd'] as num?)?.toDouble() ?? c.apiCostUsd;
        final newCtx = (payload['contextSize'] as num?)?.toInt() ?? c.contextSize;
        chats[idx] = c.copyWith(apiCostUsd: newCost, contextSize: newCtx);
        if (chatId == selectedChatId.value) {
          currentChatCostUsd.value = newCost;
          currentContextSize.value = newCtx;
        }
      }
    });

    // chat/titleUpdate — title changed
    _wsChatTitleUpdateSub = _ws.on('chat/titleUpdate').listen((payload) {
      if (payload is Map<String, dynamic>) {
        final chatId = (payload['chatId'] as String?) ?? '';
        final title = (payload['title'] as String?) ?? '';
        final idx = chats.indexWhere((c) => c.id == chatId);
        if (idx >= 0) chats[idx] = chats[idx].copyWith(title: title);
      }
    });

    // ── Firestore listeners (control-plane only) ───────────────────────────

    _sessionRootSub = _session.sessionRoot.snapshots().listen((snapshot) {
      if (!snapshot.exists) return;
      final data = snapshot.data();
      if (data == null) return;
      currentWorkspaceName.value = (data['currentWorkspace'] as String?) ?? '';
      currentWorkspacePath.value = (data['workspacePath'] as String?) ?? '';
      currentRepositoryName.value = (data['repoName'] as String?) ?? '';
    });

    _wsApprovalRequestSub = _ws.on('approvals/request').listen((payload) {
      if (payload is! Map<String, dynamic>) return;

      final id = payload['id'] as String? ?? '';
      final tool = payload['tool'] as String? ?? '';
      final command = payload['command'] as String? ?? '';
      final summary = payload['summary'] as String? ?? '';
      final rawFiles = payload['files'];
      final files = rawFiles is List ? List<String>.from(rawFiles.whereType<String>()) : <String>[];
      final source = payload['source'] as String? ?? '';
      final status = payload['status'] as String? ?? 'pending';

      if (source != 'vscode_extension') return;
      if (id.isEmpty || tool.isEmpty) return;
      if (status != 'pending') return;

      pendingApproval.value = {
        'id': id,
        'tool': tool,
        'command': command,
        'summary': summary,
        'files': files,
      };
    });

    _ws.on('approvals/clear').listen((_) {
      pendingApproval.clear();
    });

    _wsProjectsSub = _ws.on('projects/update').listen((payload) {
      if (payload is! Map<String, dynamic>) return;
      // Projeto vivo é consumido pela tela de projetos; este listener apenas mantém o estado quente.
    });
  }

  Future<void> approveRunCommand({required bool approved, bool alwaysAllow = false}) async {
    final id = pendingApproval['id'] as String? ?? '';
    if (id.isEmpty) return;
    final tool = pendingApproval['tool'] as String? ?? '';

    _ws.send('approvals/decision', {
      'requestId': id,
      'tool': tool,
      'approved': approved,
      'alwaysAllow': tool == 'edit_file' ? false : alwaysAllow,
      'source': 'mobile_app',
      'timestamp': DateTime.now().toIso8601String(),
    });
    pendingApproval.clear();
  }

  void onTextChanged(String val) {
    currentInputText.value = val;
    if (_debounceTimer?.isActive ?? false) _debounceTimer!.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 200), () {
      if (!_session.isConnected) return;
      final payload = {
        'text': val,
        'source': 'mobile_app',
        'updatedAt': DateTime.now().toIso8601String(),
      };
      _ws.send('input/update', payload);
    });
  }

  void _rebuildMessagesFromCache() {
    final currentChat = selectedChatId.value;
    if (currentChat.isEmpty) {
      messages.assignAll([]);
      return;
    }
    final rebuilt = _messageCache.getChatMessagesSorted(currentChat);
    messages.assignAll(rebuilt);
  }

  void _scheduleChatMetadataRefresh() {
    _chatMetadataRefreshTimer?.cancel();
    _chatMetadataRefreshTimer = Timer(const Duration(milliseconds: 500), () {
      if (_session.isConnected) {
        unawaited(loadChats(refreshFromServer: true));
      }
    });
  }

  void _upsertToolStatus(ToolStatus status) {
    if (status.source != 'vscode_extension') return;
    if (status.toolName.isEmpty) return;
    if (selectedChatId.value.isNotEmpty && status.chatId.isNotEmpty && status.chatId != selectedChatId.value) return;

    if (status.toolName == 'summarize_context') {
      isSummarizingContext.value = !status.isFinal;
    }

    final key = status.toolCallId.isNotEmpty ? status.toolCallId : status.id;
    if (key.isEmpty) return;

    if (!status.isFinal) _streamingToolCalls[key] = status;
    else _streamingToolCalls.remove(key);

    final existingIndex = toolStatuses.indexWhere((item) {
      final itemKey = item.toolCallId.isNotEmpty ? item.toolCallId : item.id;
      return itemKey == key;
    });

    if (existingIndex >= 0) toolStatuses[existingIndex] = status;
    else toolStatuses.add(status);

    toolStatuses.sort((a, b) => a.timestamp.compareTo(b.timestamp));
    if (toolStatuses.length > 40) toolStatuses.removeRange(0, toolStatuses.length - 40);
  }

  Future<void> onSendStopPressed() async {
    if (isStreaming.value) {
      try {
        _ws.send('command/stop');
      } catch (e, stackTrace) {
        LoggingService.to.logException(e, stackTrace, 'onSendStopPressed(STOP)');
        final msg = e.toString().replaceFirst('Exception: ', '');
        final short = msg.length > 120 ? '${msg.substring(0, 120)}…' : msg;
        Get.showSnackbar(GetSnackBar(
          title: 'Erro ao parar',
          message: short,
          duration: const Duration(seconds: 4),
          snackPosition: SnackPosition.BOTTOM,
        ));
      }
    } else {
      final text = textController.text;
      if (text.trim().isEmpty && selectedImages.isEmpty) return;

      final List<Map<String, dynamic>> attachments = [];
      for (var file in selectedImages) {
        final bytes = await file.readAsBytes();
        final base64Image = base64Encode(bytes);
        final ext = file.name.split('.').last.toLowerCase();
        final mime = switch (ext) {
          'jpg' || 'jpeg' => 'image/jpeg',
          'png' => 'image/png',
          'webp' => 'image/webp',
          'gif' => 'image/gif',
          _ => 'image/png',
        };
        final dataUrl = 'data:$mime;base64,$base64Image';
        attachments.add({'type': 'image', 'mimeType': mime, 'data': dataUrl, 'name': file.name});
      }

      final capturedText = text;
      final capturedChatId = selectedChatId.value;
      textController.clear();
      selectedImages.clear();
      onTextChanged('');

      try {
        _ws.send('command/send', {
          'text': capturedText,
          'attachments': attachments,
          'chatId': capturedChatId,
        });
      } catch (e, stackTrace) {
        LoggingService.to.logException(e, stackTrace, 'onSendStopPressed(SEND)');
        final msg = e.toString().replaceFirst('Exception: ', '');
        final short = msg.length > 120 ? '${msg.substring(0, 120)}…' : msg;
        Get.showSnackbar(GetSnackBar(
          title: 'Erro ao enviar',
          message: short,
          duration: const Duration(seconds: 4),
          snackPosition: SnackPosition.BOTTOM,
        ));
      }
    }
  }
  
  Future<void> createNewChat() async {
    if (!_session.isConnected) return;
    final newChatId = DateTime.now().millisecondsSinceEpoch.toString();
    final chatNumber = _nextChatSequence++;
    final newChat = Chat(
      id: newChatId,
      title: 'Chat $chatNumber',
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      isActive: true,
    );

    for (var i = 0; i < chats.length; i++) {
      if (chats[i].isActive) chats[i] = chats[i].copyWith(isActive: false);
    }

    chats.add(newChat);
    selectedChatId.value = newChatId;
    messages.assignAll([]);

    // Tell the extension via WebSocket — it creates the chat in SQLite and
    // broadcasts chat/active back to confirm.
    _ws.send('chat/switch', {
      'chatId': newChatId,
      'title': newChat.title,
    });
  }
  
  Future<void> selectChat(String chatId) async {
    if (!_session.isConnected) return;
    if (selectedChatId.value == chatId) {
      if (_messageCache.shouldFetchHistory(chatId)) {
        _requestChatHistory(chatId);
      }
      return;
    }

    selectedChatId.value = chatId;
    toolStatuses.clear();
    _streamingToolCalls.clear();

    for (var i = 0; i < chats.length; i++) {
      final chat = chats[i];
      if (chat.id == chatId) chats[i] = chat.copyWith(isActive: true);
      else if (chat.isActive) chats[i] = chat.copyWith(isActive: false);
    }
    
    messages.assignAll([]);
    _rebuildMessagesFromCache();
    if (_messageCache.shouldFetchHistory(chatId) || !_messageCache.hasChat(chatId)) {
      _requestChatHistory(chatId);
    }

    final selectedChat = chats.firstWhere((chat) => chat.id == chatId);
    currentChatCostUsd.value = selectedChat.apiCostUsd;
    currentContextSize.value = selectedChat.contextSize;

    _ws.send('chat/switch', {
      'chatId': chatId,
      'title': selectedChat.title,
    });
  }
  
  Future<void> loadChats({bool refreshFromServer = false}) async {
    if (!_session.isConnected) return;
    // Request chat list via WebSocket — extension responds with chat/list event
    _ws.send('chat/list/request');
  }

  void _applyRemoteChatList(List<Map<String, dynamic>> rawChats) {
    final loadedChats = rawChats.map((d) => Chat.fromFirestore({...d, 'id': d['chatId'] ?? ''})).toList();

    final selected = loadedChats.where((c) => c.id == selectedChatId.value).firstOrNull;
    if (selected != null) {
      currentChatCostUsd.value = selected.apiCostUsd;
      currentContextSize.value = selected.contextSize;
    }

    var maxSequence = 0;
    for (final chat in loadedChats) {
      final value = _extractChatSequence(chat.title);
      if (value > maxSequence) maxSequence = value;
    }
    _nextChatSequence = maxSequence + 1;

    chats.assignAll(loadedChats);

    if (loadedChats.isEmpty) {
      createNewChat();
    } else if (selectedChatId.value.isEmpty) {
      // First connect: pick the chat the extension has active (isActive=true),
      // fall back to most-recently-updated (first in list, sorted DESC).
      final activeChat = loadedChats.where((c) => c.isActive).firstOrNull ?? loadedChats.first;
      _syncWithExtensionChat(activeChat.id);
    } else if (!loadedChats.any((c) => c.id == selectedChatId.value)) {
      // Previously selected chat no longer exists — switch to active or first
      final activeChat = loadedChats.where((c) => c.isActive).firstOrNull ?? loadedChats.first;
      unawaited(selectChat(activeChat.id));
    } else {
      // Reconnect: selected chat still valid — refresh history if cache was cleared
      if (_messageCache.shouldFetchHistory(selectedChatId.value)) {
        _requestChatHistory(selectedChatId.value);
      }
    }
  }
  
  void _syncWithExtensionChat(String chatId) {
    selectedChatId.value = chatId;
    toolStatuses.clear();
    _streamingToolCalls.clear();
    for (var i = 0; i < chats.length; i++) {
      final chat = chats[i];
      if (chat.id == chatId) {
        chats[i] = chat.copyWith(isActive: true);
        currentChatCostUsd.value = chat.apiCostUsd;
        currentContextSize.value = chat.contextSize;
      } else if (chat.isActive) {
        chats[i] = chat.copyWith(isActive: false);
      }
    }
    _rebuildMessagesFromCache();
    if (_messageCache.shouldFetchHistory(chatId) || !_messageCache.hasChat(chatId)) {
      _requestChatHistory(chatId);
    }
  }

  void _requestChatHistory(String chatId) {
    if (chatId.isEmpty) return;
    _ws.send('chat/history/request', {'chatId': chatId, 'limit': 80});
  }

  Future<void> pickImages() async {
    final List<XFile> images = await _picker.pickMultiImage();
    if (images.isNotEmpty) selectedImages.addAll(images);
  }

  void removeImage(int index) => selectedImages.removeAt(index);

  Future<void> saveAssets() async {
    if (selectedImages.isEmpty || !_session.isConnected) return;
    final List<Map<String, dynamic>> attachments = [];
    for (var file in selectedImages) {
      final bytes = await file.readAsBytes();
      final base64Image = base64Encode(bytes);
      final ext = file.name.split('.').last.toLowerCase();
      final mime = switch (ext) {
        'jpg' || 'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp',
        'gif' => 'image/gif',
        _ => 'image/png',
      };
      attachments.add({'type': 'image', 'mimeType': mime, 'data': 'data:$mime;base64,$base64Image', 'name': file.name});
    }
    if (attachments.isNotEmpty) {
      _ws.send('assets/save', {
        'attachments': attachments,
        'source': 'mobile_app',
      });
      selectedImages.clear();
    }
  }

  Future<void> toggleFocusedMode() async {
    if (!_session.isConnected) return;
    final next = !isFocusedMode.value;
    isFocusedMode.value = next;
    _ws.send('state/update', {
      'focusedMode': next,
      'source': 'mobile_app',
      'updatedAt': DateTime.now().toIso8601String(),
    });
  }

  Future<void> setReasoningEffort(String effort) async {
    final normalized = effort.trim().toLowerCase();
    if (!_session.isConnected || normalized.isEmpty) return;
    currentReasoningEffort.value = normalized;
    _ws.send('state/update', {
      'reasoningEffort': normalized,
      'source': 'mobile_app',
      'updatedAt': DateTime.now().toIso8601String(),
    });
  }

  Future<void> changeModel(String modelId) async {
    if (!_session.isConnected || modelId.trim().isEmpty) return;
    selectedModelId.value = modelId.trim();
    _ws.send('models/select', {
      'modelId': modelId.trim(),
      'chatId': selectedChatId.value,
      'source': 'mobile_app',
      'updatedAt': DateTime.now().toIso8601String(),
    });
  }

  Future<void> setEditApprovalMode(String mode) async {
    if (!_session.isConnected) return;
    if (mode != 'apply_everything' && mode != 'ask_before_apply') return;
    editApprovalMode.value = mode;
    _ws.send('state/update', {
      'editApprovalMode': mode,
      'source': 'mobile_app',
      'updatedAt': DateTime.now().toIso8601String(),
    });
  }

  Future<void> summarizeContext() async {
    if (!_session.isConnected || selectedChatId.value.trim().isEmpty || isSummarizingContext.value) return;
    isSummarizingContext.value = true;
    try {
      _ws.send('chat/summarize', {
        'chatId': selectedChatId.value.trim(),
        'source': 'mobile_app',
      });
    } catch (e, stackTrace) {
      LoggingService.to.logException(e, stackTrace, 'summarizeContext');
      isSummarizingContext.value = false;
      rethrow;
    }
  }
}
