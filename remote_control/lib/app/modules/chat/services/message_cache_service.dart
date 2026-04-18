/// Robust message cache for the Remote Control chat.
///
/// Keeps an in-memory per-chat map of messages received via WebSocket.
/// History is loaded on-demand via chat/history/request WebSocket messages.
class MessageCacheService {
  // chatId -> messageId -> message map
  final Map<String, Map<String, Map<String, dynamic>>> _byChat = {};

  // LRU tracking for chats
  final List<String> _chatLru = [];

  // Track whether history has been loaded per chat
  final Map<String, bool> _hasLoadedHistory = {};

  // Limits
  final int maxChats;
  final int maxMessagesPerChat;

  static const int _defaultMaxChats = 30;
  static const int _defaultMaxMessagesPerChat = 250;

  MessageCacheService({
    this.maxChats = _defaultMaxChats,
    this.maxMessagesPerChat = _defaultMaxMessagesPerChat,
  });

  void touchChat(String chatId) {
    _chatLru.remove(chatId);
    _chatLru.add(chatId);

    // Evict old chats
    while (_chatLru.length > maxChats) {
      final evict = _chatLru.removeAt(0);
      _byChat.remove(evict);
      _hasLoadedHistory.remove(evict);
    }
  }

  void upsertFromPlainData(Iterable<Map<String, dynamic>> docs) {
    for (final data in docs) {
      final rawId = data['messageId'] ?? data['id'];
      final fallbackId = DateTime.now().microsecondsSinceEpoch.toString();
      _upsertRawMessage(rawId?.toString() ?? fallbackId, data);
    }
  }

  void _upsertRawMessage(String fallbackId, Map<String, dynamic> data) {
    final chatId = (data['chatId'] as String?) ?? '';
    if (chatId.isEmpty) return;

    final messageId = (data['messageId'] as String?) ?? (data['id'] as String?) ?? fallbackId;

    final msg = <String, dynamic>{
      'id': messageId,
      'content': data['content'] ?? '',
      'timestamp': data['timestamp'] ?? '',
      'source': data['source'] ?? 'vscode_extension',
      'role': data['role'] ?? 'user',
      'chatId': chatId,
      'attachments': data['attachments'],
    };

    final bucket = _byChat.putIfAbsent(chatId, () => {});
    bucket[messageId] = msg;
    touchChat(chatId);

    // Bound per-chat memory
    if (bucket.length > maxMessagesPerChat) {
      final entries = bucket.entries.toList();
      entries.sort((a, b) => _compareTimestamp(a.value['timestamp'], b.value['timestamp']));
      final toRemove = entries.take(bucket.length - maxMessagesPerChat);
      for (final e in toRemove) {
        bucket.remove(e.key);
      }
    }
  }

  List<Map<String, dynamic>> getChatMessagesSorted(String chatId) {
    final bucket = _byChat[chatId];
    if (bucket == null) return const [];

    final list = bucket.values.toList();
    list.sort((a, b) => _compareTimestamp(b['timestamp'], a['timestamp']));
    return list;
  }

  bool hasChat(String chatId) => _byChat.containsKey(chatId) && _byChat[chatId]!.isNotEmpty;

  bool shouldFetchHistory(String chatId) => !(_hasLoadedHistory[chatId] ?? false);

  void markHistoryLoaded(String chatId) {
    _hasLoadedHistory[chatId] = true;
    touchChat(chatId);
  }

  void clearChat(String chatId) {
    _byChat.remove(chatId);
    _hasLoadedHistory.remove(chatId);
    _chatLru.remove(chatId);
  }

  int _compareTimestamp(dynamic a, dynamic b) {
    final da = _parseTimestamp(a);
    final db = _parseTimestamp(b);
    if (da == null && db == null) return 0;
    if (da == null) return -1;
    if (db == null) return 1;
    return da.compareTo(db);
  }

  DateTime? _parseTimestamp(dynamic v) {
    if (v is DateTime) return v;
    if (v is String) {
      if (v.isEmpty) return null;
      try {
        return DateTime.parse(v);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

}
