// WsService — WebSocket client for real-time communication with the VSCode extension.
//
// Architecture:
//   1. Reads remote_control/{uid}.wsUrl from Firestore root doc.
//   2. Connects to that WebSocket URL with the session token embedded in the URL.
//   3. Emits a stream of typed WsEvent objects for controllers to listen to.
//   4. Auto-reconnects with exponential backoff on disconnect.
//
// The WsService is a GetxService; register it in AppBinding before ChatController.

import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:get/get.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'logging_service.dart';

class WsEvent {
  final String type;
  final dynamic payload;
  const WsEvent(this.type, this.payload);
}

class WsService extends GetxService {
  static WsService get to => Get.find();

  final _eventController = StreamController<WsEvent>.broadcast();
  Stream<WsEvent> get events => _eventController.stream;

  final RxBool isConnected = false.obs;
  final RxString wsUrl = ''.obs;

  WebSocketChannel? _channel;
  StreamSubscription? _channelSub;
  StreamSubscription? _firestoreUrlSub;
  Timer? _retryTimer;
  bool _disposed = false;
  int _retryDelay = 2; // seconds

  static const int _maxRetryDelay = 60;

  StreamSubscription<User?>? _authSub;
  String _currentWatchedUid = '';

  Future<WsService> init() async {
    _authSub = FirebaseAuth.instance.authStateChanges().listen((user) {
      final uid = user?.uid;
      if (uid != null && uid.isNotEmpty) {
        if (_currentWatchedUid != uid) {
          _currentWatchedUid = uid;
          _watchWsUrl(uid);
        }
      } else {
        _currentWatchedUid = '';
        _disconnect();
        _firestoreUrlSub?.cancel();
        _firestoreUrlSub = null;
        wsUrl.value = '';
      }
    });
    
    // Fallback inicial caso o listener demore e já estejamos logados
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid != null && uid.isNotEmpty && _currentWatchedUid != uid) {
      _currentWatchedUid = uid;
      _watchWsUrl(uid);
    }
    
    return this;
  }

  // ── URL discovery via Firestore ─────────────────────────────────────────────

  void _watchWsUrl(String uid) {
    _firestoreUrlSub?.cancel();

    _firestoreUrlSub = FirebaseFirestore.instance
        .collection('remote_control')
        .doc(uid)
        .snapshots()
        .listen((snap) {
      if (!snap.exists) return;
      final url = snap.data()?['wsUrl'] as String?;
      if (url != null && url.isNotEmpty && url != wsUrl.value) {
        wsUrl.value = url;
        LoggingService.to.logDebug('[WsService] wsUrl recebido do Firestore: $url');
        _reconnect(url);
      }
    });
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  void _reconnect(String url) {
    _disconnect();
    _connect(url);
  }

  void _connect(String url) {
    if (_disposed) return;
    try {
      LoggingService.to.logDebug('Conectando WebSocket: $url');
      final uri = Uri.parse(url);
      _channel = WebSocketChannel.connect(uri);
      _channelSub = _channel!.stream.listen(
        _onData,
        onError: (e) {
          LoggingService.to.logError('WebSocket error: $e', '_connect');
          _scheduleRetry();
        },
        onDone: () {
          LoggingService.to.logDebug('WebSocket connection closed');
          isConnected.value = false;
          _scheduleRetry();
        },
      );
      // Await handshake: the server sends connection/ack on first connect
      isConnected.value = true;
      _retryDelay = 2;
      LoggingService.to.logDebug('WebSocket conectado com sucesso');
    } catch (e, stackTrace) {
      LoggingService.to.logException(e, stackTrace, '_connect');
      _scheduleRetry();
    }
  }

  void _disconnect() {
    _retryTimer?.cancel();
    _retryTimer = null;
    _channelSub?.cancel();
    _channel?.sink.close();
    _channelSub = null;
    _channel = null;
    isConnected.value = false;
  }

  void _scheduleRetry() {
    if (_disposed) return;
    
    _retryTimer?.cancel();
    final delay = _retryDelay;
    _retryDelay = (_retryDelay * 2).clamp(2, _maxRetryDelay);
    
    _retryTimer = Timer(Duration(seconds: delay), () async {
      if (_disposed) return;
      
      // Antes de cada tentativa de reconexão, consultamos o Firestore 
      // para garantir que temos a URL mais recente do tunnel (caso tenha mudado).
      final uid = _currentWatchedUid;
      if (uid.isNotEmpty) {
        try {
          LoggingService.to.logDebug('[WsService] Consultando Firestore no retry para $uid...');
          final snap = await FirebaseFirestore.instance
              .collection('remote_control')
              .doc(uid)
              .get();
          
          if (snap.exists) {
            final url = snap.data()?['wsUrl'] as String?;
            if (url != null && url.isNotEmpty) {
              if (url != wsUrl.value) {
                LoggingService.to.logDebug('[WsService] Nova URL detectada no retry: $url');
                wsUrl.value = url;
              }
            }
          }
        } catch (e) {
          LoggingService.to.logError('Erro ao buscar URL atualizada no Firestore: $e', '_scheduleRetry');
        }
      }

      if (!_disposed && wsUrl.value.isNotEmpty) {
        _connect(wsUrl.value);
      }
    });
  }

  // ── Incoming message handling ───────────────────────────────────────────────

  void _onData(dynamic raw) {
    try {
      final map = jsonDecode(raw as String) as Map<String, dynamic>;
      final type = map['type'] as String? ?? '';
      final payload = map['payload'];
      if (type == 'connection/ack') {
        isConnected.value = true;
        _retryDelay = 2;
        LoggingService.to.logDebug('WebSocket connection/ack recebido');
      }
      _eventController.add(WsEvent(type, payload));
    } catch (e, stackTrace) {
      LoggingService.to.logException(e, stackTrace, '_onData');
    }
  }

  // ── Outgoing messages ───────────────────────────────────────────────────────

  void send(String type, [dynamic payload]) {
    if (_channel == null) return;
    try {
      final message = jsonEncode({'type': type, 'payload': payload});
      _channel!.sink.add(message);
      LoggingService.to.logDebug('WebSocket enviado: $type');
    } catch (e, stackTrace) {
      LoggingService.to.logException(e, stackTrace, 'send($type)');
    }
  }

  // ── Helpers for controllers ─────────────────────────────────────────────────

  /// Returns a filtered stream for a single event type.
  Stream<dynamic> on(String type) =>
      events.where((e) => e.type == type).map((e) => e.payload);

  @override
  void onClose() {
    _disposed = true;
    _disconnect();
    _firestoreUrlSub?.cancel();
    _authSub?.cancel();
    _eventController.close();
    super.onClose();
  }
}
