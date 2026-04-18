import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../../services/device_session_service.dart';

class DevicePickerView extends StatelessWidget {
  const DevicePickerView({super.key});

  @override
  Widget build(BuildContext context) {
    final session = DeviceSessionService.to;

    return Scaffold(
      backgroundColor: const Color(0xFF0B0D12),
      appBar: AppBar(
        title: const Text('Selecionar Instância'),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: Column(
        children: [
          Obx(() => SwitchListTile.adaptive(
                value: session.showHistoricalSessions.value,
                onChanged: session.toggleShowHistoricalSessions,
                title: const Text('Mostrar histórico'),
                subtitle: const Text('Exibe sessões offline/órfãs além das ativas'),
                activeColor: Colors.blueAccent,
              )),
          Expanded(
            child: Obx(() {
              if (session.availableSessions.isEmpty) {
                return Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.computer_outlined, color: Colors.white24, size: 42),
                      const SizedBox(height: 16),
                      Text(
                        session.showHistoricalSessions.value
                            ? 'Nenhuma sessão encontrada.'
                            : 'Nenhuma instância online encontrada.',
                        style: const TextStyle(color: Colors.white54),
                      ),
                    ],
                  ),
                );
              }

              return ListView.builder(
                itemCount: session.availableSessions.length,
                itemBuilder: (context, index) {
                  final dev = session.availableSessions[index];
                  final id = dev['id'] as String;
                  final status = (dev['status'] as String? ?? 'offline').toLowerCase();
                  final currentWorkspace = dev['currentWorkspace'] as String? ?? 'Desconhecido';
                  final version = dev['version'] as String? ?? '';
                  final versionLabel = version.trim().isEmpty || version == 'unknown' ? '' : ' ($version)';
                  final machineId = dev['machineId'] as String? ?? '';
                  final lastSeenRaw = dev['lastSeen'];
                  final expiresAtRaw = dev['expiresAt'];
                  final now = DateTime.now();
                  DateTime? parseSessionDate(dynamic value) {
                    if (value == null) return null;
                    if (value is DateTime) return value;
                    if (value is String && value.isNotEmpty) return DateTime.tryParse(value)?.toLocal();
                    try {
                      return value.toDate() as DateTime?;
                    } catch (_) {
                      return null;
                    }
                  }

                  final lastSeen = parseSessionDate(lastSeenRaw);
                  final expiresAt = parseSessionDate(expiresAtRaw);
                  final isFresh = lastSeen != null && now.difference(lastSeen) <= const Duration(seconds: 75);
                  final isNotExpired = expiresAt == null || expiresAt.isAfter(now);
                  final isOnline = status == 'online' && isFresh && isNotExpired;
                  final statusColor = isOnline ? Colors.greenAccent : Colors.orangeAccent;
                  final statusLabel = isOnline ? 'online' : 'stale';

                  return Obx(() {
                    final isCurrentNow = session.selectedDeviceId.value == id;
                    return Card(
                      color: isCurrentNow
                          ? const Color(0xFF1A2035)
                          : const Color(0xFF12151C),
                      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      shape: isCurrentNow
                          ? RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                              side: const BorderSide(color: Colors.blueAccent, width: 1.5),
                            )
                          : null,
                      child: ListTile(
                        leading: Icon(Icons.computer, color: statusColor),
                        title: Text(
                          currentWorkspace,
                          style: TextStyle(
                            color: isCurrentNow ? Colors.blueAccent : Colors.white,
                            fontWeight: isCurrentNow ? FontWeight.bold : FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          'Sessão: ${id.length > 8 ? id.substring(0, 8) : id} • $statusLabel$versionLabel\n'
                          'Máquina: ${machineId.isEmpty ? 'n/d' : machineId.substring(0, machineId.length > 8 ? 8 : machineId.length)}',
                          style: const TextStyle(color: Colors.white54, fontSize: 12),
                        ),
                        trailing: isCurrentNow
                            ? const Icon(Icons.check_circle, color: Colors.blueAccent, size: 22)
                            : const Icon(Icons.arrow_forward_ios, color: Colors.white24, size: 16),
                        onTap: () async {
                          await session.selectDevice(id);
                          Get.showSnackbar(GetSnackBar(
                            title: 'Sessão Alterada',
                            message: 'Agora controlando a instância $currentWorkspace',
                            snackPosition: SnackPosition.BOTTOM,
                            duration: const Duration(seconds: 3),
                          ));
                        },
                      ),
                    );
                  });
                },
              );
            }),
          ),
        ],
      ),
    );
  }
}
