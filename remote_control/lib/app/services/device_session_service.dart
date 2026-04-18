// DeviceSessionService — acesso ao Firestore isolado por uid
//
// Após o refactor de autenticação, cada usuário tem seus dados em:
//   remote_control/{uid}/docs/{docName}
//   remote_control/{uid}/{collectionName}/{id}
//
// O uid vem do Firebase Auth (Google Sign-In via AuthService).
// Não há mais seleção de dispositivo — o usuário se conecta à
// própria sessão automaticamente ao autenticar.
//
// A propriedade `selectedDeviceId` é mantida como observable derivado
// do uid do Firebase Auth para compatibilidade com os controllers
// que usam `ever(_session.selectedDeviceId, ...)`.

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:get/get.dart';

class DeviceSessionService extends GetxService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  // Observable que espelha o uid do Firebase Auth.
  // Usado pelos controllers para reagir a mudanças de sessão.
  final RxString selectedDeviceId = ''.obs;

  // Mantido para compatibilidade com DevicePickerView (agora obsoleto).
  final RxList<Map<String, dynamic>> availableSessions =
      <Map<String, dynamic>>[].obs;
  final RxBool showHistoricalSessions = false.obs;

  StreamSubscription<User?>? _authSub;

  static DeviceSessionService get to => Get.find();

  Future<DeviceSessionService> init() async {
    // Sincroniza selectedDeviceId com o uid do Firebase Auth
    _authSub = FirebaseAuth.instance.authStateChanges().listen((user) {
      final uid = user?.uid ?? '';
      if (selectedDeviceId.value != uid) {
        selectedDeviceId.value = uid;
      }
    });

    // Valor inicial
    selectedDeviceId.value = FirebaseAuth.instance.currentUser?.uid ?? '';
    return this;
  }

  // ── Path helpers ────────────────────────────────────────────────────────────

  String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  bool get isConnected => _uid != null && _uid!.isNotEmpty;

  DocumentReference<Map<String, dynamic>> get _userRoot {
    final uid = _uid;
    if (uid == null || uid.isEmpty) throw StateError('Usuário não autenticado');
    return _firestore.collection('remote_control').doc(uid);
  }

  // Alias público para uso em listeners que precisam do doc raiz do usuário
  DocumentReference<Map<String, dynamic>> get sessionRoot => _userRoot;

  DocumentReference<Map<String, dynamic>> sessionDoc(String name) =>
      _userRoot.collection('docs').doc(name);

  CollectionReference<Map<String, dynamic>> sessionCollection(String name) =>
      _userRoot.collection(name);

  // ── Stubs de compatibilidade (DevicePickerView — a ser removido futuramente) ─

  Future<void> selectDevice(String deviceId) async {
    // No-op: seleção de dispositivo não é mais necessária com auth por uid.
  }

  Future<void> clearSelectedDevice() async {
    // No-op.
  }

  void toggleShowHistoricalSessions(bool value) {
    showHistoricalSessions.value = value;
  }


  @override
  void onClose() {
    _authSub?.cancel();
    super.onClose();
  }
}
