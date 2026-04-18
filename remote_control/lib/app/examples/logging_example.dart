// Exemplo de uso do LoggingService
//
// Este arquivo demonstra como usar o LoggingService para logar exceptions
// e mensagens de debug no console do desenvolvedor.

import '../services/logging_service.dart';

class LoggingExample {
  static void demonstrateLogging() {
    final logging = LoggingService.to;
    
    // Exemplo 1: Log de mensagens simples
    logging.logDebug('Esta é uma mensagem de debug');
    logging.logInfo('Esta é uma mensagem de informação');
    logging.logWarning('Esta é uma mensagem de warning');
    
    // Exemplo 2: Simulação de uma exception
    try {
      throw Exception('Exemplo de exception para logging');
    } catch (e, stackTrace) {
      logging.logException(e, stackTrace, 'demonstrateLogging');
    }
    
    // Exemplo 3: Log de erro sem stack trace
    logging.logError('Erro simulado sem stack trace');
  }
  
  static void demonstrateCloudFunctionError() {
    // Exemplo de como seria logado um erro de Cloud Function
    final logging = LoggingService.to;
    
    logging.logInfo('Iniciando chamada de Cloud Function...');
    
    try {
      // Simulação de erro em chamada de Cloud Function
      throw Exception('firebase_functions/unauthenticated: Token expirado');
    } catch (e, stackTrace) {
      logging.logException(e, stackTrace, 'CloudFunctionCall');
      logging.logError('Falha na chamada da Cloud Function - usuário precisa reautenticar');
    }
  }
}

// Para usar no app, você pode chamar:
// LoggingExample.demonstrateLogging();
// LoggingExample.demonstrateCloudFunctionError();