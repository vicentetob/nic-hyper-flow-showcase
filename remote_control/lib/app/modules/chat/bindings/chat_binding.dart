import 'package:get/get.dart';
import '../controllers/chat_controller.dart';

class ChatBinding extends Bindings {
  @override
  void dependencies() {
    // fenix: true — recria o controller se foi dispose, não lança "improper use"
    // quando a rota /chat é empurrada mais de uma vez.
    Get.lazyPut<ChatController>(() => ChatController(), fenix: true);
  }
}
