// LoggingService — serviço centralizado para logging de exceptions e debug
//
// Este serviço fornece métodos para logar exceptions de forma consistente,
// incluindo stack traces completos para facilitar o debugging.
// 
// Uso:
//   try {
//     await someOperation();
//   } catch (e, stackTrace) {
//     LoggingService.to.logException(e, stackTrace, 'someOperation');
//     rethrow; // ou tratar
//   }

import 'package:get/get.dart';

class LoggingService extends GetxService {
  static LoggingService get to => Get.find();

  Future<LoggingService> init() async {
    print('[LoggingService] Inicializado');
    return this;
  }

  /// Loga uma exception com stack trace e contexto opcional
  void logException(Object exception, StackTrace stackTrace, [String? context]) {
    final contextPrefix = context != null ? '[$context] ' : '';
    print('${contextPrefix}EXCEPTION: $exception');
    print('${contextPrefix}STACK TRACE:');
    print(stackTrace.toString());
  }

  /// Loga uma exception sem stack trace (para casos onde não está disponível)
  void logError(Object error, [String? context]) {
    final contextPrefix = context != null ? '[$context] ' : '';
    print('${contextPrefix}ERROR: $error');
  }

  /// Loga uma mensagem de debug
  void logDebug(String message, [String? context]) {
    final contextPrefix = context != null ? '[$context] ' : '';
    print('${contextPrefix}DEBUG: $message');
  }

  /// Loga uma mensagem de info
  void logInfo(String message, [String? context]) {
    final contextPrefix = context != null ? '[$context] ' : '';
    print('${contextPrefix}INFO: $message');
  }

  /// Loga uma mensagem de warning
  void logWarning(String message, [String? context]) {
    final contextPrefix = context != null ? '[$context] ' : '';
    print('${contextPrefix}WARNING: $message');
  }
}