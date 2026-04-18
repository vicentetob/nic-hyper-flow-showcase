import 'dart:async';

import 'package:get/get.dart';
import 'package:remote_control/app/services/auth_service.dart';
import 'package:remote_control/app/services/device_session_service.dart';
import 'package:remote_control/app/services/ws_service.dart';

class SettingsController extends GetxController {
  final DeviceSessionService _session = DeviceSessionService.to;
  final WsService _ws = WsService.to;

  // Models (now sourced from WebSocket; Firestore remains only for writing
  // coordinated settings updates from mobile to extension)
  final RxList<Map<String, dynamic>> availableModels = <Map<String, dynamic>>[].obs;
  final RxString selectedModelId = ''.obs;

  StreamSubscription? _modelsSub;

  @override
  void onInit() {
    super.onInit();
    ever(_session.selectedDeviceId, (_) => _listenModels());
    _listenModels();
  }

  void _listenModels() {
    _modelsSub?.cancel();

    if (!_session.isConnected) {
      availableModels.clear();
      selectedModelId.value = '';
      return;
    }

    _modelsSub = _ws.on('models/update').listen((payload) {
      if (payload is! Map<String, dynamic>) return;

      final rawItems = payload['items'];
      if (rawItems is List) {
        final parsed = rawItems
            .whereType<Map>()
            .map((m) => Map<String, dynamic>.from(m))
            .where((m) => (m['id'] as String? ?? '').isNotEmpty)
            .toList();
        availableModels.assignAll(parsed);
      }

      final modelId = (payload['selectedModelId'] as String?) ?? '';
      if (modelId.isNotEmpty) {
        selectedModelId.value = modelId;
      }
    });
  }

  Future<void> setSelectedModel(String modelId) async {
    if (modelId.isEmpty || !_session.isConnected) return;

    _ws.send('models/select', {
      'modelId': modelId,
      'source': 'mobile_app',
      'updatedAt': DateTime.now().toIso8601String(),
    });
  }

  Future<void> runTerminalCommand(String cmd) async {
    final command = cmd.trim();
    if (command.isEmpty || !_session.isConnected) return;

    _ws.send('command/send', {
      'text': '<<<NHF:CMD:TOB>>>\nTOOL run_command\ncmd: $command\n<<<NHF:END:TOB>>>',
      'attachments': const [],
      'chatId': '',
    });
  }

  /// Faz sign-out completo e volta para a tela de auth.
  Future<void> disconnect() async {
    await AuthService.to.signOut();
    Get.offAllNamed('/auth');
  }

  @override
  void onClose() {
    _modelsSub?.cancel();
    super.onClose();
  }
}
