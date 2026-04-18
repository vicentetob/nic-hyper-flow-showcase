import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:get/get.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'app/modules/auth/auth_controller.dart';
import 'app/modules/auth/auth_view.dart';
import 'app/modules/chat/views/chat_view.dart';
import 'app/modules/chat/bindings/chat_binding.dart';
import 'app/modules/settings/views/settings_view.dart';
import 'app/modules/settings/bindings/settings_binding.dart';
import 'app/services/auth_service.dart';
import 'app/services/device_session_service.dart';
import 'app/services/ws_service.dart';
import 'app/services/logging_service.dart';
import 'app/modules/sessions/device_picker_view.dart';
import 'app/modules/projects/project_picker_view.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: Color(0xFF0A0A0F),
    systemNavigationBarIconBrightness: Brightness.light,
    systemNavigationBarDividerColor: Colors.transparent,
  ));

  // Configura handler global para capturar todas as exceptions não tratadas
  FlutterError.onError = (FlutterErrorDetails details) {
    // Loga no console
    print('[FLUTTER ERROR] ${details.exception}');
    print('[FLUTTER ERROR] Stack trace: ${details.stack}');
    
    // Se o LoggingService já estiver inicializado, usa ele também
    if (Get.isRegistered<LoggingService>()) {
      LoggingService.to.logError(details.exception.toString(), 'FlutterError');
    }
  };
  
  // Handler para exceptions não capturadas pelo Flutter
  PlatformDispatcher.instance.onError = (error, stack) {
    print('[PLATFORM ERROR] $error');
    print('[PLATFORM ERROR] Stack trace: $stack');
    
    if (Get.isRegistered<LoggingService>()) {
      LoggingService.to.logError(error.toString(), 'PlatformError');
    }
    
    return true; // Impede que o app crash
  };

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  FirebaseFirestore.instance.settings = const Settings(
    persistenceEnabled: true,
    cacheSizeBytes: Settings.CACHE_SIZE_UNLIMITED,
  );

  // Registra serviços
  await Get.putAsync(() => LoggingService().init());
  await Get.putAsync(() => AuthService().init());
  await Get.putAsync(() => DeviceSessionService().init());
  await Get.putAsync(() => WsService().init());

  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Rota inicial depende de estar autenticado ou não
    final initialRoute =
        FirebaseAuth.instance.currentUser != null ? '/chat' : '/auth';

    return GetMaterialApp(
      title: 'Nic Remote Control',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFF0A0A0F),
      ),
      darkTheme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF0A0A0F),
      ),
      themeMode: ThemeMode.dark,
      initialRoute: initialRoute,
      getPages: [
        GetPage(
          name: '/auth',
          page: () => const AuthView(),
          binding: BindingsBuilder.put(() => AuthController()),
        ),
        GetPage(
          name: '/chat',
          page: () => const ChatView(),
          binding: ChatBinding(),
        ),
        GetPage(
          name: '/settings',
          page: () => const SettingsView(),
          binding: SettingsBinding(),
        ),
        GetPage(
          name: '/sessions',
          page: () => const DevicePickerView(),
        ),
        GetPage(
          name: '/projects',
          page: () => const ProjectPickerView(),
        ),
      ],
      debugShowCheckedModeBanner: false,
    );
  }
}
