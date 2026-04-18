import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:remote_control/app/services/auth_service.dart';
import 'package:remote_control/app/services/logging_service.dart';

enum AuthStep { welcome, scanning, signingIn, reconnecting, success, error }

class AuthController extends GetxController {
  final AuthService _authService = AuthService.to;

  final Rx<AuthStep> step = AuthStep.welcome.obs;
  final RxString errorMessage = ''.obs;
  final RxString scannedCode = ''.obs;

  @override
  void onReady() {
    super.onReady();
    // Na web, verifica se o app foi aberto com ?auth=<code> na URL
    // (usuário veio da página /connect após escanear o QR com a câmera)
    if (kIsWeb) {
      final uri = Uri.base;
      final authCode = uri.queryParameters['auth'];
      if (authCode != null && authCode.isNotEmpty) {
        _processAuthCodeFromUrl(authCode);
      }
    }
  }

  /// Processa um authCode que veio como query param da URL (fluxo web/PWA).
  Future<void> _processAuthCodeFromUrl(String authCode) async {
    scannedCode.value = authCode;
    step.value = AuthStep.signingIn;
    try {
      await _authService.signInWithGoogleAndLink(authCode);
      step.value = AuthStep.success;
      await Future.delayed(const Duration(milliseconds: 800));
      Get.offAllNamed('/chat');
    } catch (e, stackTrace) {
      LoggingService.to.logException(e, stackTrace, '_processAuthCodeFromUrl');
      errorMessage.value = e.toString().replaceFirst('Exception: ', '');
      step.value = AuthStep.error;
    }
  }

  /// Extrai o authCode de uma string que pode ser:
  ///   - Uma URL como https://nic-hyper-flow.web.app/connect?auth=<code>
  ///   - Diretamente o authCode (formato legado / testes)
  static String _extractAuthCode(String raw) {
    final trimmed = raw.trim();
    final uri = Uri.tryParse(trimmed);
    if (uri != null && uri.queryParameters.containsKey('auth')) {
      return uri.queryParameters['auth']!;
    }
    return trimmed;
  }

  void startConnection() {
    step.value = AuthStep.welcome;
  }

  void goToScanner() {
    step.value = AuthStep.scanning;
  }

  /// Chamado pelo scanner quando um QR é detectado.
  Future<void> onQrDetected(String code) async {
    if (step.value != AuthStep.scanning) return;
    if (code.trim().isEmpty) return;

    // O QR agora encoda uma URL; extrai só o authCode
    final authCode = _extractAuthCode(code);
    scannedCode.value = authCode;
    step.value = AuthStep.signingIn;

    try {
      await _authService.signInWithGoogleAndLink(authCode);
      step.value = AuthStep.success;

      await Future.delayed(const Duration(milliseconds: 800));
      Get.offAllNamed('/chat');
    } catch (e, stackTrace) {
      LoggingService.to.logException(e, stackTrace, 'onQrDetected');
      errorMessage.value = e.toString().replaceFirst('Exception: ', '');
      step.value = AuthStep.error;
    }
  }

  /// Chamado quando o usuário toca em "Entrar com Google" (sem QR).
  /// Usado após reinstalar o app — o pareamento já existe no Firestore.
  Future<void> onSignInWithGoogle() async {
    if (step.value != AuthStep.scanning) return;
    step.value = AuthStep.reconnecting;

    try {
      final sessionExists = await _authService.signInWithGoogleOnly();

      if (sessionExists) {
        step.value = AuthStep.success;
        await Future.delayed(const Duration(milliseconds: 600));
        Get.offAllNamed('/chat');
      } else {
        // Conta não está pareada com nenhuma extensão — precisa escanear QR
        errorMessage.value =
            'Nenhuma sessão encontrada para esta conta.\nAbra a extensão no VS Code e escaneie o QR code.';
        step.value = AuthStep.error;
      }
    } catch (e, stackTrace) {
      LoggingService.to.logException(e, stackTrace, 'onSignInWithGoogle');
      errorMessage.value = e.toString().replaceFirst('Exception: ', '');
      step.value = AuthStep.error;
    }
  }

  void retry() {
    scannedCode.value = '';
    errorMessage.value = '';
    step.value = AuthStep.scanning;
  }
}
