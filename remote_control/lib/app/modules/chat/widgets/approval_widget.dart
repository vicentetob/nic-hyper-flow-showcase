import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../controllers/chat_controller.dart';

class ApprovalWidget extends StatelessWidget {
  final ChatController controller;

  const ApprovalWidget({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      if (controller.pendingApproval.isEmpty) return const SizedBox.shrink();

      final tool = controller.pendingApproval['tool'] as String? ?? '';
      final command = controller.pendingApproval['command'] as String? ?? '';
      final summary = controller.pendingApproval['summary'] as String? ?? '';
      final rawFiles = controller.pendingApproval['files'];
      final files = rawFiles is List
          ? rawFiles.whereType<String>().toList()
          : <String>[];

      final isEditApproval = tool == 'edit_file';

      final title = isEditApproval
          ? 'Authorize file edit'
          : 'Authorize command execution';

      final displayText = isEditApproval
          ? (summary.isNotEmpty ? summary : command)
          : command;

      return Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.35),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.white.withOpacity(0.12)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        isEditApproval ? Icons.edit_document : Icons.security,
                        color: isEditApproval ? Colors.lightBlueAccent : Colors.amberAccent,
                        size: 18,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          title,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 12,
                            letterSpacing: 0.2,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (displayText.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.25),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.white.withOpacity(0.08)),
                      ),
                      child: Text(
                        displayText,
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.9),
                          fontFamily: isEditApproval ? null : 'monospace',
                          fontSize: 12,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                  if (isEditApproval && files.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: files
                          .map((f) => Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: Colors.lightBlueAccent.withOpacity(0.10),
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(color: Colors.lightBlueAccent.withOpacity(0.25)),
                                ),
                                child: Text(
                                  f.split('/').last.split('\\').last,
                                  style: const TextStyle(
                                    color: Colors.lightBlueAccent,
                                    fontSize: 10,
                                    fontFamily: 'monospace',
                                  ),
                                ),
                              ))
                          .toList(),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => controller.approveRunCommand(approved: false),
                          style: OutlinedButton.styleFrom(
                            side: BorderSide(color: Colors.redAccent.withOpacity(0.7)),
                            foregroundColor: Colors.redAccent,
                            padding: const EdgeInsets.symmetric(vertical: 10),
                          ),
                          child: const Text('Deny'),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () => controller.approveRunCommand(approved: true),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.greenAccent.withOpacity(0.9),
                            foregroundColor: Colors.black,
                            padding: const EdgeInsets.symmetric(vertical: 10),
                          ),
                          child: const Text('Allow'),
                        ),
                      ),
                    ],
                  ),
                  if (!isEditApproval) ...[
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: TextButton(
                        onPressed: () => controller.approveRunCommand(approved: true, alwaysAllow: true),
                        child: Text(
                          'Allow always',
                          style: TextStyle(color: Colors.white.withOpacity(0.85), fontWeight: FontWeight.w700),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    });
  }
}
