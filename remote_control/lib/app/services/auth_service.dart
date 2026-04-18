/**
 * AuthService — Google Sign-In + Firebase Auth + link ao auth_pending
 *
 * Fluxo:
 *  1. App escaneia QR code → obtém authCode
 *  2. Dispara Google Sign-In → obtém uid
 *  3. Escreve em auth_pending/{authCode} com uid, displayName, email, photoUrl
 *  4. Extensão detecta e fecha o fluxo
 *  5. A partir daí, todos os dados vão em remote_control/{uid}/
 *
 * Plataforma:
 *  - Android/nativo: usa google_sign_in (fluxo nativo)
 *  - Web/PWA       : usa FirebaseAuth.signInWithPopup (sem dependência nativa)
 */

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'logging_service.dart';

class AuthService extends GetxService {
  // ID do servidor OAuth — usado no fluxo nativo para gerar idToken.
  // Substitua pelo seu próprio Web Client ID do Firebase Console
  // (Authentication → Sign-in method → Google → Web Client ID).
  static const String _serverClientId =
      'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  // Só inicializado no mobile; na web usamos signInWithPopup diretamente
  late final GoogleSignIn _googleSignIn;

  final Rx<User?> currentUser = Rx<User?>(null);
  final RxBool isAuthenticated = false.obs;

  static AuthService get to => Get.find();

  Future<AuthService> init() async {
    return this;
  }

  @override
  void onInit() {
    super.onInit();

    if (!kIsWeb) {
      _googleSignIn = GoogleSignIn(serverClientId: _serverClientId);
    }

    _auth.authStateChanges().listen((user) {
      currentUser.value = user;
      isAuthenticated.value = user != null;
    });
  }

  String? get uid => _auth.currentUser?.uid;
  String? get displayName => _auth.currentUser?.displayName;
  String? get email => _auth.currentUser?.email;
  String? get photoUrl => _auth.currentUser?.photoURL;

  /// Faz Google Sign-In e vincula ao auth_pending/{authCode}.
  Future<void> signInWithGoogleAndLink(String authCode) async {
    try {
      final User user = await _signInWithGoogle();

      LoggingService.to.logInfo(
          'Usuário autenticado: ${user.uid}, finalizando pareamento — authCode: $authCode');

      final callable = _functions.httpsCallable('remote_control_complete_auth');
      await callable.call({
        'authCode': authCode,
        'uid': user.uid,
        'displayName': user.displayName ?? '',
        'email': user.email ?? '',
        'photoUrl': user.photoURL ?? '',
      });

      LoggingService.to
          .logInfo('Pareamento concluído com sucesso para authCode: $authCode');
    } catch (e, stackTrace) {
      LoggingService.to
          .logException(e, stackTrace, 'signInWithGoogleAndLink');
      rethrow;
    }
  }

  /// Faz Google Sign-In sem precisar de QR code.
  /// Retorna true se a sessão da extensão foi encontrada no Firestore.
  Future<bool> signInWithGoogleOnly() async {
    try {
      final User user = await _signInWithGoogle();

      LoggingService.to.logInfo(
          'Usuário autenticado: ${user.uid}, verificando sessão no Firestore');

      final sessionDoc = await _firestore
          .collection('remote_control')
          .doc(user.uid)
          .get();

      final exists = sessionDoc.exists;
      LoggingService.to.logInfo(
          'Sessão ${exists ? "encontrada" : "não encontrada"} para uid: ${user.uid}');

      return exists;
    } catch (e, stackTrace) {
      LoggingService.to.logException(e, stackTrace, 'signInWithGoogleOnly');
      rethrow;
    }
  }

  /// Sign-out completo (Firebase + Google).
  Future<void> signOut() async {
    if (!kIsWeb) await _googleSignIn.signOut();
    await _auth.signOut();
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  /// Realiza o Sign-In com Google de forma agnóstica à plataforma.
  /// Na web usa signInWithPopup; no mobile usa o package google_sign_in.
  Future<User> _signInWithGoogle() async {
    if (kIsWeb) {
      final provider = GoogleAuthProvider();
      final result = await _auth.signInWithPopup(provider);
      final user = result.user;
      if (user == null) {
        LoggingService.to
            .logError('Firebase Auth (web popup) retornou null', '_signInWithGoogle');
        throw Exception('Firebase Auth falhou');
      }
      return user;
    }

    // Mobile: usa google_sign_in para obter idToken e acessToken
    final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
    if (googleUser == null) {
      LoggingService.to
          .logError('Login cancelado pelo usuário', '_signInWithGoogle');
      throw Exception('Login cancelado pelo usuário');
    }

    final GoogleSignInAuthentication googleAuth =
        await googleUser.authentication;
    final credential = GoogleAuthProvider.credential(
      accessToken: googleAuth.accessToken,
      idToken: googleAuth.idToken,
    );

    final userCredential = await _auth.signInWithCredential(credential);
    final user = userCredential.user;
    if (user == null) {
      LoggingService.to
          .logError('Firebase Auth falhou - usuário nulo', '_signInWithGoogle');
      throw Exception('Firebase Auth falhou');
    }
    return user;
  }
}
