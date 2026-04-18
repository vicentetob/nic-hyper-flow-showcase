import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../controllers/settings_controller.dart';

class SettingsView extends StatelessWidget {
  const SettingsView({super.key});

  @override
  Widget build(BuildContext context) {
    final SettingsController controller = Get.find<SettingsController>();
    final TextEditingController terminalController = TextEditingController();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Configurações'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Get.back(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildSectionTitle('Controle Remoto'),
          const SizedBox(height: 12),
          ListTile(
            leading: const Icon(Icons.computer, color: Colors.blueAccent),
            title: const Text('Instâncias do VS Code'),
            subtitle: const Text('Selecionar qual computador controlar'),
            trailing: const Icon(Icons.arrow_forward_ios, size: 14),
            onTap: () => Get.toNamed('/sessions'),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
              side: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
            ),
          ),
          const SizedBox(height: 8),
          ListTile(
            leading: const Icon(Icons.folder_open, color: Colors.orangeAccent),
            title: const Text('Abrir Projeto'),
            subtitle: const Text('Trocar workspace remotamente'),
            trailing: const Icon(Icons.arrow_forward_ios, size: 14),
            onTap: () => Get.toNamed('/projects'),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
              side: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
            ),
          ),
          
          const SizedBox(height: 32),
          _buildSectionTitle('Modelo da conversa'),
          const SizedBox(height: 12),
          Obx(() {
            final models = controller.availableModels;
            final selected = controller.selectedModelId.value;

            if (models.isEmpty) {
              return const Text(
                'Nenhum modelo recebido da extensão ainda. Abra o chat no VS Code para sincronizar.',
                style: TextStyle(color: Colors.white70),
              );
            }

            return DropdownButtonFormField<String>(
              value: selected.isEmpty ? null : selected,
              items: models.map((m) {
                final id = (m['id'] as String?) ?? '';
                final name = (m['displayName'] as String?) ?? id;
                final provider = (m['providerName'] as String?) ?? (m['provider'] as String?) ?? '';
                return DropdownMenuItem<String>(
                  value: id,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      maxWidth: MediaQuery.of(context).size.width - 100,
                    ),
                    child: Text(
                      provider.isEmpty ? name : '$name  —  $provider',
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ),
                );
              }).toList(),
              onChanged: (val) {
                if (val != null) controller.setSelectedModel(val);
              },
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                labelText: 'Selecionar modelo',
              ),
            );
          }),

          const SizedBox(height: 32),
          _buildSectionTitle('Executar no Terminal'),
          const SizedBox(height: 8),
          const Text(
            'Isso dispara a tool run_command na extensão (pode pedir aprovação).',
            style: TextStyle(color: Colors.white70, fontSize: 12),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: terminalController,
            maxLines: 2,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: 'Ex: npm test',
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: () async {
                final cmd = terminalController.text;
                if (cmd.trim().isEmpty) return;
                await controller.runTerminalCommand(cmd);
                terminalController.clear();
                Get.showSnackbar(const GetSnackBar(
                  title: 'Enviado',
                  message: 'Comando enviado para o VS Code.',
                  snackPosition: SnackPosition.BOTTOM,
                  duration: Duration(seconds: 3),
                ));
              },
              icon: const Icon(Icons.terminal),
              label: const Text('Executar'),
            ),
          ),
          const SizedBox(height: 32),
          _buildSectionTitle('Conta'),
          const SizedBox(height: 12),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.redAccent),
            title: const Text('Desconectar da extensão'),
            subtitle: const Text('Sair da conta e voltar para o QR code'),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
              side: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
            ),
            onTap: () async {
              final confirm = await Get.dialog<bool>(
                AlertDialog(
                  title: const Text('Desconectar?'),
                  content: const Text(
                    'Você será desconectado e precisará escanear o QR code novamente para reconectar.',
                  ),
                  actions: [
                    TextButton(
                      onPressed: () => Get.back(result: false),
                      child: const Text('Cancelar'),
                    ),
                    TextButton(
                      onPressed: () => Get.back(result: true),
                      child: const Text(
                        'Desconectar',
                        style: TextStyle(color: Colors.redAccent),
                      ),
                    ),
                  ],
                ),
              );
              if (confirm == true) await controller.disconnect();
            },
          ),
        ],
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
    );
  }
}
