import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:remote_control/app/services/ws_service.dart';

import '../../services/device_session_service.dart';

class ProjectPickerController extends GetxController {
  final DeviceSessionService _session = DeviceSessionService.to;
  final WsService _ws = WsService.to;
  final RxList<Map<String, dynamic>> projects = <Map<String, dynamic>>[].obs;

  StreamSubscription? _projectsSub;

  @override
  void onInit() {
    super.onInit();
    ever(_session.selectedDeviceId, (_) => _listenToProjects());
    _listenToProjects();
  }

  void _listenToProjects() {
    _projectsSub?.cancel();

    if (!_session.isConnected) {
      projects.clear();
      return;
    }

    _projectsSub = _ws.on('projects/update').listen((payload) {
      if (payload is! Map<String, dynamic>) {
        projects.clear();
        return;
      }

      final rawItems = payload['items'];
      if (rawItems is! List) {
        projects.clear();
        return;
      }

      final items = rawItems
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
      projects.assignAll(items);
    });
  }

  String get suggestedBasePath {
    for (final project in projects) {
      final projectPath = (project['path'] as String? ?? '').trim();
      if (projectPath.isEmpty) continue;
      final normalized = projectPath.replaceAll('\\', '/');
      final parts = normalized.split('/');
      if (parts.length >= 3) {
        return parts.take(3).join('/');
      }
      return normalized;
    }
    return 'C:/Users/tobia';
  }

  Future<void> promptAddProject() async {
    if (!_session.isConnected) return;

    final controller = TextEditingController(text: suggestedBasePath);
    final result = await Get.dialog<String>(
      AlertDialog(
        backgroundColor: const Color(0xFF12151C),
        title: const Text('Adicionar projeto'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Informe o caminho do projeto para salvar como favorito remoto.',
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              decoration: InputDecoration(
                hintText: suggestedBasePath,
                helperText: 'Exemplo sugerido com base nos projetos já vistos.',
                border: const OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Get.back(),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () => Get.back(result: controller.text.trim()),
            child: const Text('Salvar'),
          ),
        ],
      ),
      barrierDismissible: true,
    );

    final projectPath = result?.trim() ?? '';
    if (projectPath.isEmpty) return;

    _ws.send('projects/addFavorite', {
      'projectPath': projectPath,
      'source': 'mobile_app',
    });

    Get.showSnackbar(const GetSnackBar(
      title: 'Projeto adicionado',
      message: 'Favorito remoto salvo. Ele aparecerá na lista desta instância.',
      snackPosition: SnackPosition.BOTTOM,
      duration: Duration(seconds: 3),
    ));
  }

  Future<void> openProjectInPlace(String projectPath) async {
    await _sendProjectCommand('OPEN_PROJECT_IN_PLACE', projectPath,
        successMessage: 'Projeto será aberto na instância selecionada.');
  }

  Future<void> openProjectInNewWindow(String projectPath) async {
    await _sendProjectCommand('OPEN_PROJECT_NEW_WINDOW', projectPath,
        successMessage: 'Nova janela do VS Code será aberta com esse projeto.');
  }

  Future<void> closeCurrentWindow() async {
    if (!_session.isConnected) return;
    _ws.send('workspace/close', {
      'source': 'mobile_app',
    });
    Get.back();
    Get.showSnackbar(const GetSnackBar(
      title: 'Instância',
      message: 'Solicitação de fechamento enviada para o VS Code.',
      snackPosition: SnackPosition.BOTTOM,
      duration: Duration(seconds: 3),
    ));
  }

  Future<void> _sendProjectCommand(String action, String projectPath,
      {required String successMessage}) async {
    if (!_session.isConnected) return;
    _ws.send('projects/open', {
      'projectPath': projectPath,
      'openInNewWindow': action == 'OPEN_PROJECT_NEW_WINDOW',
      'source': 'mobile_app',
    });

    Get.back();
    Get.showSnackbar(GetSnackBar(
      title: 'Projeto',
      message: successMessage,
      snackPosition: SnackPosition.BOTTOM,
      duration: const Duration(seconds: 3),
    ));
  }

  @override
  void onClose() {
    _projectsSub?.cancel();
    super.onClose();
  }
}

class ProjectPickerView extends StatelessWidget {
  const ProjectPickerView({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(ProjectPickerController());

    return Scaffold(
      backgroundColor: const Color(0xFF0B0D12),
      appBar: AppBar(
        title: const Text('Projetos da Instância'),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Adicionar projeto',
            onPressed: controller.promptAddProject,
            icon: const Icon(Icons.add),
          ),
          IconButton(
            tooltip: 'Fechar instância atual',
            onPressed: controller.closeCurrentWindow,
            icon: const Icon(Icons.close),
          ),
        ],
      ),
      body: Obx(() {
        if (controller.projects.isEmpty) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Nenhum projeto recente encontrado.\nAbra um projeto no VS Code para ele aparecer aqui.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white54),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton.icon(
                    onPressed: controller.promptAddProject,
                    icon: const Icon(Icons.add),
                    label: const Text('Adicionar projeto'),
                  ),
                ],
              ),
            ),
          );
        }

        return ListView.builder(
          itemCount: controller.projects.length,
          itemBuilder: (context, index) {
            final project = controller.projects[index];
            final isCurrent = project['isCurrent'] == true;
            final projectPath = project['path'] as String? ?? '';

            return Card(
              color: const Color(0xFF12151C),
              margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: ListTile(
                leading: Icon(
                  Icons.folder,
                  color: isCurrent ? Colors.blueAccent : Colors.white70,
                ),
                title: Text(
                  project['name'] ?? 'Sem nome',
                  style: TextStyle(
                    color: isCurrent ? Colors.blueAccent : Colors.white,
                    fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
                subtitle: Text(
                  projectPath,
                  style: const TextStyle(color: Colors.white38, fontSize: 12),
                ),
                trailing: PopupMenuButton<String>(
                  onSelected: (value) {
                    if (value == 'in_place') {
                      controller.openProjectInPlace(projectPath);
                    } else if (value == 'new_window') {
                      controller.openProjectInNewWindow(projectPath);
                    }
                  },
                  itemBuilder: (context) => const [
                    PopupMenuItem(
                      value: 'in_place',
                      child: Text('Abrir nesta instância'),
                    ),
                    PopupMenuItem(
                      value: 'new_window',
                      child: Text('Abrir em nova janela'),
                    ),
                  ],
                ),
                onTap: () => controller.openProjectInPlace(projectPath),
              ),
            );
          },
        );
      }),
    );
  }
}
