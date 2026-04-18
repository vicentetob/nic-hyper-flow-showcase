// ChatView.dart
import 'dart:ui';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:get/get.dart';

import '../controllers/chat_controller.dart';
import '../models/chat_model.dart';
import '../models/tool_status_model.dart';
import '../widgets/chat_command_widgets.dart';
import '../widgets/chat_glass_widgets.dart';
import '../widgets/approval_widget.dart';
import 'package:remote_control/app/services/device_session_service.dart';
import 'package:remote_control/app/services/ws_service.dart';

class ChatView extends StatefulWidget {
  const ChatView({super.key});

  @override
  State<ChatView> createState() => _ChatViewState();
}

class _ChatViewState extends State<ChatView> {
  late final ChatController controller;
  final DeviceSessionService session = DeviceSessionService.to;

  final ScrollController _scrollController = ScrollController();
  bool _showJumpToBottom = false;
  bool _stickToBottom = true;
  double _lastBottomInset = 0;

  @override
  void initState() {
    super.initState();
    controller = Get.find<ChatController>();

    _scrollController.addListener(() {
      if (!_scrollController.hasClients) return;
      final pos = _scrollController.position;
      final atBottom = pos.pixels >= (pos.maxScrollExtent - 80);
      _stickToBottom = atBottom;
      final shouldShow = !atBottom;
      if (shouldShow != _showJumpToBottom) setState(() => _showJumpToBottom = shouldShow);
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scheduleAutoScroll({bool animated = true, bool force = false}) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!_scrollController.hasClients) return;
      if (!force && !_stickToBottom) return;
      final target = _scrollController.position.maxScrollExtent;
      if (animated) {
        _scrollController.animateTo(target, duration: const Duration(milliseconds: 220), curve: Curves.easeOut);
      } else {
        _scrollController.jumpTo(target);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    if (bottomInset != _lastBottomInset) {
      final wasClosed = _lastBottomInset == 0;
      _lastBottomInset = bottomInset;
      if (wasClosed && bottomInset > 0) {
        // Teclado acabou de subir
        _scheduleAutoScroll(force: true, animated: true);
      }
    }

    final theme = Theme.of(context);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        systemNavigationBarColor: Color(0xFF0A0A0F),
        systemNavigationBarIconBrightness: Brightness.light,
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarDividerColor: Colors.transparent,
      ),
      child: Scaffold(
        extendBodyBehindAppBar: true,
        backgroundColor: const Color(0xFF0A0A0F),
        appBar: PreferredSize(
        preferredSize: const Size.fromHeight(kToolbarHeight),
        child: GlassBar(
          child: AppBar(
            leading: IconButton(
              icon: const Icon(Icons.settings, color: Colors.white),
              tooltip: 'Settings',
              onPressed: () => Get.toNamed('/settings'),
            ),
            title: Obx(() {
              if (controller.chats.isEmpty) {
                return const Text('Nic Remote', style: TextStyle(color: Colors.white));
              }

              final uniqueChats = <String, Chat>{
                for (final chat in controller.chats) chat.id: chat,
              }.values.toList();
              final selectedValue = controller.selectedChatId.value;
              final hasSelectedValue = selectedValue.isNotEmpty &&
                  uniqueChats.where((chat) => chat.id == selectedValue).length == 1;

              return SizedBox(
                width: 180,
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: hasSelectedValue ? selectedValue : null,
                  icon: const Icon(Icons.arrow_drop_down, color: Colors.white),
                  dropdownColor: const Color(0xFF0F1116),
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                  underline: Container(height: 0),
                  onChanged: (String? newValue) {
                    if (newValue != null) {
                      controller.selectChat(newValue);
                      _scheduleAutoScroll(animated: false, force: true);
                    }
                  },
                  items: uniqueChats.map<DropdownMenuItem<String>>((Chat chat) {
                    return DropdownMenuItem<String>(
                      value: chat.id,
                      child: Text(
                        chat.title,
                        style: TextStyle(
                          color: chat.isActive ? Colors.lightBlueAccent : Colors.white,
                          fontWeight: chat.isActive ? FontWeight.bold : FontWeight.normal,
                        ),
                        overflow: TextOverflow.ellipsis,
                        maxLines: 1,
                        textAlign: TextAlign.center,
                      ),
                    );
                  }).toList(),
                ),
              );
            }),
            centerTitle: true,
            elevation: 0,
            backgroundColor: Colors.transparent,
            actions: [
              IconButton(
                icon: const Icon(Icons.add, color: Colors.white),
                onPressed: () {
                  controller.createNewChat();
                  _scheduleAutoScroll(animated: false, force: true);
                },
                tooltip: 'New chat',
              ),
            ],
          ),
        ),
      ),
      body: Stack(
        children: [
          const GlassBackground(),
          SafeArea(
            child: Obx(() {
              if (session.selectedDeviceId.value.isEmpty) {
                return const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.link_off, color: Colors.white24, size: 48),
                      SizedBox(height: 16),
                      Text(
                        'No session connected.\nSelect a VS Code instance in Settings.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.white54),
                      ),
                    ],
                  ),
                );
              }

              return Column(
                children: [
                  Obx(() {
                    if (WsService.to.isConnected.value) return const SizedBox.shrink();
                    return Container(
                      width: double.infinity,
                      color: Colors.orange.withValues(alpha: 0.15),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      child: Row(
                        children: [
                          const Icon(Icons.wifi_off, size: 14, color: Colors.orangeAccent),
                          const SizedBox(width: 8),
                          const Expanded(
                            child: Text(
                              'Tunnel disconnected — reconnecting...',
                              style: TextStyle(color: Colors.orangeAccent, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                  _ChatRuntimeHeader(controller: controller),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(2, 6, 2, 8),
                      child: Obx(() {
                        final messageList = controller.messages.reversed.toList();
                        final streaming = controller.streamingMessage;
                        final displayMessages = <dynamic>[...messageList];
                        if (streaming.isNotEmpty) {
                          final alreadyInList = displayMessages.any((m) => m['id'] == streaming['id']);
                          if (!alreadyInList) displayMessages.add(streaming);
                        }

                        final selectedChatId = controller.selectedChatId.value.trim();
                        final unassignedToolStatuses = controller.toolStatuses.where((s) {
                          final statusChatId = s.chatId.trim();
                          final sameChat = statusChatId.isEmpty || selectedChatId.isEmpty || statusChatId == selectedChatId;
                          if (!sameChat) return false;
                          final hasExplicitMessage = (s.messageId ?? '').trim().isNotEmpty;
                          return !hasExplicitMessage;
                        }).toList();

                        _scheduleAutoScroll(animated: true);

                        if (displayMessages.isEmpty) {
                          if (unassignedToolStatuses.isNotEmpty) {
                            return Align(
                              alignment: Alignment.topLeft,
                              child: Padding(
                                padding: const EdgeInsets.fromLTRB(8, 14, 8, 14),
                                child: ConstrainedBox(
                                  constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.86),
                                  child: GlassBubble(isAssistant: true, child: _ToolCallsInlineList(statuses: unassignedToolStatuses)),
                                ),
                              ),
                            );
                          }
                          return const Center(
                            child: Text(
                              'Nic Hyper Flow\nRemote Connected',
                              textAlign: TextAlign.center,
                              style: TextStyle(color: Colors.white54, height: 1.4),
                            ),
                          );
                        }

                        return Stack(
                          children: [
                            ListView.builder(
                              controller: _scrollController,
                              padding: const EdgeInsets.fromLTRB(4, 10, 4, 14),
                              itemCount: displayMessages.length,
                              itemBuilder: (context, index) {
                                final message = displayMessages[index] as Map;
                                final content = (message['content'] as String?) ?? '';
                                final role = (message['role'] as String?) ?? 'assistant';
                                final messageId = message['id'] as String? ?? '';
                                final normalizedContent = content.trim().toLowerCase();
                                final isToolPlaceholderMessage = role == 'assistant' && (normalizedContent == '' || normalizedContent == '');

                                final hasAssignedToolsForThisMessage = isToolPlaceholderMessage && messageId.isNotEmpty && controller.toolStatuses.any((s) {
                                  final sid = (s.messageId ?? '').trim();
                                  if (sid.isEmpty || sid != messageId) return false;
                                  final sChatId = s.chatId.trim();
                                  return sChatId.isEmpty || selectedChatId.isEmpty || sChatId == selectedChatId;
                                });

                                final shouldRenderPlaceholderAsToolBubble = isToolPlaceholderMessage && (unassignedToolStatuses.isNotEmpty || hasAssignedToolsForThisMessage);
                                if (isToolPlaceholderMessage && !shouldRenderPlaceholderAsToolBubble) return const SizedBox.shrink();

                                final isStreamingMsg = controller.isStreaming.value && controller.streamingMessage.isNotEmpty && (message['id'] == controller.streamingMessage['id']);
                                final isAssistantMessage = role == 'assistant';
                                final isLastAssistantInDisplay = isAssistantMessage && index == displayMessages.length - 1;

                                final msgToolStatuses = isAssistantMessage ? controller.toolStatuses.where((s) {
                                  if (s.toolName == 'report_status') return false;
                                  final statusChatId = s.chatId.trim();
                                  final sameChat = statusChatId.isEmpty || selectedChatId.isEmpty || statusChatId == selectedChatId;
                                  if (!sameChat) return false;
                                  final statusMessageId = (s.messageId ?? '').trim();
                                  if (statusMessageId.isNotEmpty) return statusMessageId == messageId;
                                  if (shouldRenderPlaceholderAsToolBubble) return true;
                                  return isLastAssistantInDisplay && unassignedToolStatuses.isNotEmpty;
                                }).toList() : const <ToolStatus>[];

                                return _MessageBubble(
                                  role: role, content: content, attachments: message['attachments'], toolStatuses: msgToolStatuses,
                                  isStreaming: isStreamingMsg, markdownStyle: _markdownStyle(theme, role),
                                );
                              },
                            ),
                            Positioned(
                              right: 12, bottom: 12,
                              child: AnimatedOpacity(
                                opacity: _showJumpToBottom ? 1 : 0, duration: const Duration(milliseconds: 180),
                                child: IgnorePointer(
                                  ignoring: !_showJumpToBottom,
                                  child: GlassButton(onTap: () => _scheduleAutoScroll(animated: true, force: true), child: const Icon(Icons.arrow_downward, color: Colors.white)),
                                ),
                              ),
                            ),
                          ],
                        );
                      }),
                    ),
                  ),
                  ApprovalWidget(controller: controller),
                  _ChatInputBar(controller: controller, onSend: () => _scheduleAutoScroll(animated: true, force: true)),
                ],
              );
            }),
          ),
        ],
      ),
    ),
    );
  }

  MarkdownStyleSheet _markdownStyle(ThemeData theme, String role) {
    final base = MarkdownStyleSheet.fromTheme(theme);
    final textColor = role == 'assistant' ? Colors.white.withOpacity(0.92) : Colors.white;
    return base.copyWith(
      textAlign: WrapAlignment.start,
      p: base.p?.copyWith(color: textColor, fontSize: 14, height: 1.35),
      a: base.a?.copyWith(color: Colors.lightBlueAccent),
      code: base.code?.copyWith(color: Colors.white.withOpacity(0.95), fontSize: 13, fontFamily: 'monospace'),
      codeblockPadding: const EdgeInsets.all(12),
      codeblockDecoration: BoxDecoration(color: Colors.black.withOpacity(0.25), borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.white.withOpacity(0.10))),
      blockquotePadding: const EdgeInsets.all(12),
      blockquoteDecoration: BoxDecoration(color: Colors.white.withOpacity(0.06), borderRadius: BorderRadius.circular(12), border: Border(left: BorderSide(color: Colors.white.withOpacity(0.18), width: 3))),
      listBullet: base.listBullet?.copyWith(color: textColor),
      strong: base.strong?.copyWith(color: textColor, fontWeight: FontWeight.w700),
      em: base.em?.copyWith(color: textColor, fontStyle: FontStyle.italic),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime Header — compact by default, expands on tap
// ─────────────────────────────────────────────────────────────────────────────

class _ChatRuntimeHeader extends StatefulWidget {
  final ChatController controller;
  const _ChatRuntimeHeader({required this.controller});

  @override
  State<_ChatRuntimeHeader> createState() => _ChatRuntimeHeaderState();
}

class _ChatRuntimeHeaderState extends State<_ChatRuntimeHeader> {

  String _formatUsd(double value) {
    final normalized = value.isFinite ? value : 0.0;
    return '\$${normalized.toStringAsFixed(2)}';
  }

  String _formatModelName(String model) {
    if (model.isEmpty) return model;
    final parts = model.split(':');
    return parts.isNotEmpty ? parts.last.trim() : model;
  }

  double _resolveContextProgress(int contextSize, String model) {
    final normalizedModel = model.toLowerCase();
    int maxContext = 200000;

    if (normalizedModel.contains('gpt-5.4') ||
        normalizedModel.contains('gemini-2.5-flash') ||
        normalizedModel.contains('gemini-2.5-pro') ||
        normalizedModel.contains('gemini-3') ||
        normalizedModel.contains('gpt-4.1-mini')) {
      maxContext = 1000000;
    } else if (normalizedModel.contains('gpt-5.2-codex') ||
        normalizedModel.contains('gpt-5.2')) {
      maxContext = 262144;
    } else if (normalizedModel.contains('gpt-5-mini')) {
      maxContext = 128000;
    }

    if (maxContext <= 0) return 0;
    return (contextSize / maxContext).clamp(0.0, 1.0);
  }

  Future<void> _confirmSummarizeContext(BuildContext context) async {
    if (widget.controller.isSummarizingContext.value) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: const Color(0xFF11151D),
        title: const Text('Confirm action', style: TextStyle(color: Colors.white)),
        content: const Text(
          'Are you sure you want to summarize the context?',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Summarize'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await widget.controller.summarizeContext();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Obx(() {
      final rawModel = widget.controller.selectedModelId.value.trim();
      final model = _formatModelName(rawModel);
      final repo = widget.controller.currentRepositoryName.value.trim();
      final workspace = widget.controller.currentWorkspaceName.value.trim();
      final contextSize = widget.controller.currentContextSize.value;
      final cost = widget.controller.currentChatCostUsd.value;
      final focus = widget.controller.isFocusedMode.value;
      final reasoning = widget.controller.currentReasoningEffort.value.trim();
      final workspacePath = widget.controller.currentWorkspacePath.value.trim();
      final isSummarizing = widget.controller.isSummarizingContext.value;
      final contextProgress = _resolveContextProgress(contextSize, rawModel);
      final reasoningLabel = reasoning.isEmpty ? 'medium' : reasoning;
      final applyMode = widget.controller.editApprovalMode.value;

      return Padding(
        padding: const EdgeInsets.fromLTRB(10, 6, 10, 0),
        child: GlassPanel(
          radius: 16,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: _HeaderEdgeFade(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    physics: const BouncingScrollPhysics(),
                    child: Row(
                      children: [
                        const SizedBox(width: 14),
                        Container(
                          width: 7,
                          height: 7,
                          decoration: BoxDecoration(
                            color: Colors.greenAccent.withOpacity(0.9),
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Colors.greenAccent.withOpacity(0.5),
                                blurRadius: 4,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        _ContextProgressChip(
                          contextSize: contextSize,
                          progress: contextProgress,
                        ),
                        const SizedBox(width: 6),
                        _MiniChip(
                          icon: Icons.attach_money_rounded,
                          label: _formatUsd(cost),
                        ),
                        if (rawModel.isNotEmpty) ...[
                          const SizedBox(width: 6),
                          PopupMenuButton<String>(
                            tooltip: 'Modelo',
                            color: const Color(0xFF11151D),
                            onSelected: widget.controller.changeModel,
                            itemBuilder: (context) {
                              final models = widget.controller.availableModels;
                              if (models.isEmpty) {
                                return [
                                  PopupMenuItem(
                                    value: rawModel,
                                    child: Text(
                                      model,
                                      style: const TextStyle(color: Colors.white),
                                    ),
                                  ),
                                ];
                              }
                              return models.map((m) {
                                final id = (m['id'] as String?) ?? '';
                                final displayName = (m['displayName'] as String?) ?? id;
                                final providerName = (m['providerName'] as String?) ?? '';
                                final label = providerName.isNotEmpty ? '$providerName · $displayName' : displayName;
                                return PopupMenuItem<String>(
                                  value: id,
                                  child: Text(
                                    label,
                                    style: TextStyle(
                                      color: id == rawModel ? Colors.lightBlueAccent : Colors.white,
                                      fontWeight: id == rawModel ? FontWeight.bold : FontWeight.normal,
                                    ),
                                  ),
                                );
                              }).toList();
                            },
                            child: _MiniChip(
                              icon: Icons.auto_awesome_rounded,
                              label: model,
                            ),
                          ),
                        ],
                        if (repo.isNotEmpty) ...[
                          const SizedBox(width: 6),
                          _MiniChip(
                            icon: Icons.folder_open_rounded,
                            label: repo,
                          ),
                        ],
                        if (workspace.isNotEmpty && workspace != repo) ...[
                          const SizedBox(width: 6),
                          _MiniChip(
                            icon: Icons.computer_rounded,
                            label: workspace,
                          ),
                        ],
                        const SizedBox(width: 6),
                        _ControlChip(
                          icon: focus
                              ? Icons.center_focus_strong
                              : Icons.filter_center_focus,
                          label: 'focus',
                          active: focus,
                          activeColor: Colors.lightBlueAccent,
                          onTap: widget.controller.toggleFocusedMode,
                        ),
                        const SizedBox(width: 6),
                        PopupMenuButton<String>(
                          tooltip: 'Reasoning effort',
                          color: const Color(0xFF11151D),
                          onSelected: widget.controller.setReasoningEffort,
                          itemBuilder: (context) => const [
                            PopupMenuItem(
                              value: 'none',
                              child: Text('None', style: TextStyle(color: Colors.white)),
                            ),
                            PopupMenuItem(
                              value: 'low',
                              child: Text('Low', style: TextStyle(color: Colors.white)),
                            ),
                            PopupMenuItem(
                              value: 'medium',
                              child: Text('Medium', style: TextStyle(color: Colors.white)),
                            ),
                            PopupMenuItem(
                              value: 'high',
                              child: Text('High', style: TextStyle(color: Colors.white)),
                            ),
                            PopupMenuItem(
                              value: 'xhigh',
                              child: Text('XHigh', style: TextStyle(color: Colors.white)),
                            ),
                          ],
                          child: _ControlChip(
                            icon: Icons.psychology_alt_rounded,
                            label: reasoningLabel,
                            active: false,
                            onTap: null,
                          ),
                        ),
                        const SizedBox(width: 6),
                        _ControlChip(
                          icon: Icons.compress_rounded,
                          label: isSummarizing ? 'summarizing...' : 'summarize',
                          active: isSummarizing,
                          activeColor: Colors.deepPurpleAccent,
                          onTap: isSummarizing
                              ? null
                              : () => _confirmSummarizeContext(context),
                        ),
                        const SizedBox(width: 6),
                        PopupMenuButton<String>(
                          tooltip: 'Edit application mode',
                          color: const Color(0xFF11151D),
                          onSelected: widget.controller.setEditApprovalMode,
                          itemBuilder: (context) => const [
                            PopupMenuItem(
                              value: 'apply_everything',
                              child: Text('Apply Everything', style: TextStyle(color: Colors.white)),
                            ),
                            PopupMenuItem(
                              value: 'ask_before_apply',
                              child: Text('Ask Before Apply', style: TextStyle(color: Colors.white)),
                            ),
                          ],
                          child: _ControlChip(
                            icon: applyMode == 'ask_before_apply'
                                ? Icons.help_outline_rounded
                                : Icons.check_circle_outline_rounded,
                            label: applyMode == 'ask_before_apply' ? 'ask' : 'apply all',
                            active: applyMode == 'ask_before_apply',
                            activeColor: Colors.amberAccent,
                            onTap: null,
                          ),
                        ),
                        const SizedBox(width: 14),
                      ],
                    ),
                  ),
                ),
              ),
              if (workspacePath.isNotEmpty || widget.controller.agentStatus.value.isNotEmpty) ...[
                const SizedBox(height: 10),
                if (widget.controller.agentStatus.value.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8, left: 4),
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                            boxShadow: [
                              BoxShadow(
                                color: Colors.white.withOpacity(0.4),
                                blurRadius: 4,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            widget.controller.agentStatus.value,
                            style: TextStyle(
                              color: Colors.white.withOpacity(0.9),
                              fontSize: 12.5,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (workspacePath.isNotEmpty)
                  Row(
                    children: [
                      Icon(
                        Icons.folder_outlined,
                        size: 12,
                        color: Colors.white.withOpacity(0.35),
                      ),
                      const SizedBox(width: 5),
                      Expanded(
                        child: SelectableText(
                          workspacePath,
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.40),
                            fontSize: 10.5,
                            fontFamily: 'monospace',
                          ),
                        ),
                      ),
                    ],
                  ),
              ],
            ],
          ),
        ),
      );
    });
  }
}

class _MiniChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _MiniChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.06),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: Colors.white.withOpacity(0.08),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: Colors.white70),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: Colors.white.withOpacity(0.88),
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _ContextProgressChip extends StatelessWidget {
  final int contextSize;
  final double progress;

  const _ContextProgressChip({
    required this.contextSize,
    required this.progress,
  });

  String _formatPercent(double value) {
    final percent = (value * 100).clamp(0, 100);
    return '${percent.toStringAsFixed(percent >= 10 ? 0 : 1)}%';
  }

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: 'Contexto atual: $contextSize tokens • ${_formatPercent(progress)} do modelo',
      waitDuration: const Duration(milliseconds: 200),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.06),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: Colors.white.withOpacity(0.08)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  CircularProgressIndicator(
                    value: 1,
                    strokeWidth: 2,
                    valueColor: AlwaysStoppedAnimation<Color>(
                      Colors.white.withOpacity(0.12),
                    ),
                  ),
                  CircularProgressIndicator(
                    value: progress,
                    strokeWidth: 2,
                    strokeCap: StrokeCap.round,
                    valueColor: const AlwaysStoppedAnimation<Color>(
                      Colors.lightBlueAccent,
                    ),
                    backgroundColor: Colors.transparent,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            Text(
              _formatPercent(progress),
              style: TextStyle(
                color: Colors.white.withOpacity(0.88),
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeaderEdgeFade extends StatelessWidget {
  final Widget child;

  const _HeaderEdgeFade({required this.child});

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: ShaderMask(
        shaderCallback: (bounds) => const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [
            Colors.transparent,
            Colors.black,
            Colors.black,
            Colors.transparent,
          ],
          stops: [0, 0.06, 0.94, 1],
        ).createShader(bounds),
        blendMode: BlendMode.dstIn,
        child: child,
      ),
    );
  }
}

/// Interactive chip for the expanded controls panel
class _ControlChip extends StatelessWidget {
  final IconData? icon;
  final String label;
  final bool active;
  final Color? activeColor;
  final VoidCallback? onTap;

  const _ControlChip({
    this.icon,
    required this.label,
    required this.active,
    this.activeColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final accent = active ? (activeColor ?? Colors.blueAccent) : null;
    return InkWell(
      borderRadius: BorderRadius.circular(999),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: accent != null ? accent.withOpacity(0.14) : Colors.white.withOpacity(0.07),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: accent != null ? accent.withOpacity(0.38) : Colors.white.withOpacity(0.10),
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: 12, color: Colors.white.withOpacity(0.85)),
              const SizedBox(width: 5),
            ],
            Text(
              label,
              style: TextStyle(
                color: Colors.white.withOpacity(0.80),
                fontSize: 11,
                fontWeight: active ? FontWeight.w700 : FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Bar — extracted for clarity
// ─────────────────────────────────────────────────────────────────────────────

class _ChatInputBar extends StatelessWidget {
  final ChatController controller;
  final VoidCallback onSend;
  const _ChatInputBar({required this.controller, required this.onSend});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
      child: GlassPanel(
        radius: 18,
        padding: const EdgeInsets.fromLTRB(4, 6, 8, 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            // Image picker button
            IconButton(
              icon: Icon(Icons.image_outlined, color: Colors.white.withOpacity(0.55), size: 22),
              onPressed: () => controller.pickImages(),
              splashRadius: 20,
              tooltip: 'Attach image',
            ),
            // Text + image previews
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Image previews
                  Obx(() {
                    if (controller.selectedImages.isEmpty) return const SizedBox();
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: SizedBox(
                        height: 72,
                        child: ListView.builder(
                          scrollDirection: Axis.horizontal,
                          itemCount: controller.selectedImages.length,
                          itemBuilder: (context, index) {
                            return Stack(
                              children: [
                                Padding(
                                  padding: const EdgeInsets.only(right: 8, top: 4),
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(8),
                                    child: kIsWeb 
                                        ? Image.network(
                                            controller.selectedImages[index].path,
                                            height: 64, width: 64, fit: BoxFit.cover,
                                          )
                                        : Image.file(
                                            File(controller.selectedImages[index].path),
                                            height: 64, width: 64, fit: BoxFit.cover,
                                          ),
                                  ),
                                ),
                                Positioned(
                                  right: 2, top: 0,
                                  child: GestureDetector(
                                    onTap: () => controller.removeImage(index),
                                    child: Container(
                                      decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                                      child: const Icon(Icons.close, size: 14, color: Colors.white),
                                    ),
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
                    );
                  }),
                  // TextField
                  TextField(
                    controller: controller.textController,
                    onChanged: controller.onTextChanged,
                    maxLines: 5,
                    minLines: 1,
                    style: const TextStyle(color: Colors.white, fontSize: 14),
                    cursorColor: Colors.white,
                    decoration: InputDecoration(
                      hintText: 'Message...',
                      hintStyle: TextStyle(color: Colors.white.withOpacity(0.30), fontSize: 14),
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 8),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            // Upload / Send
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Obx(() {
                  if (controller.selectedImages.isNotEmpty) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: _SendButton(
                        icon: Icons.cloud_upload_outlined,
                        onTap: () => controller.saveAssets(),
                      ),
                    );
                  }
                  return const SizedBox();
                }),
                Obx(() => _SendButton(
                  icon: controller.isStreaming.value ? Icons.stop_rounded : Icons.arrow_upward_rounded,
                  onTap: () {
                    controller.onSendStopPressed();
                    onSend();
                  },
                  active: true,
                )),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  final bool active;
  const _SendButton({required this.icon, required this.onTap, this.active = false});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 36, height: 36,
        decoration: BoxDecoration(
          color: active ? Colors.white.withOpacity(0.14) : Colors.white.withOpacity(0.08),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withOpacity(0.12)),
        ),
        child: Icon(icon, color: Colors.white, size: 18),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Bubble
// ─────────────────────────────────────────────────────────────────────────────

class _MessageBubble extends StatelessWidget {
  final String role;
  final String content;
  final dynamic attachments;
  final List<ToolStatus> toolStatuses;
  final bool isStreaming;
  final MarkdownStyleSheet markdownStyle;

  const _MessageBubble({required this.role, required this.content, this.attachments, this.toolStatuses = const [], required this.isStreaming, required this.markdownStyle});

  @override
  Widget build(BuildContext context) {
    final isAssistant = role == 'assistant';
    final parts = _parseContentParts(content);

    return Align(
      alignment: isAssistant ? Alignment.centerLeft : Alignment.centerRight,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * (isAssistant ? 1.0 : 0.85),
        ),
        margin: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        padding: isAssistant 
            ? const EdgeInsets.symmetric(vertical: 24, horizontal: 8)
            : const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
        decoration: BoxDecoration(
          color: isAssistant 
              ? Colors.transparent 
              : Colors.white.withOpacity(0.08), // Um pouco mais visível para o usuário
          borderRadius: isAssistant ? BorderRadius.zero : const BorderRadius.only(
            topLeft: Radius.circular(16),
            topRight: Radius.circular(16),
            bottomLeft: Radius.circular(16),
            bottomRight: Radius.circular(4),
          ),
          border: isAssistant ? Border(
            bottom: BorderSide(
              color: Colors.white.withOpacity(0.06),
              width: 1,
            ),
          ) : Border.all(color: Colors.white.withOpacity(0.08)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: isAssistant ? CrossAxisAlignment.start : CrossAxisAlignment.end,
          children: [
          if (attachments != null && (attachments as List).isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12.0),
              child: Wrap(
                spacing: 8, runSpacing: 8, alignment: WrapAlignment.center,
                children: (attachments as List).map((att) {
                  if (att['type'] == 'image' && att['data'] != null) {
                    try {
                      final raw = att['data'] as String;
                      if (raw.isEmpty) return const SizedBox();
                      final base64Part = raw.contains('base64,') ? raw.split('base64,').last : raw;
                      final bytes = base64Decode(base64Part);
                      return GestureDetector(
                        onTap: () => showDialog(context: context, barrierColor: Colors.black87, builder: (_) => Dialog(backgroundColor: Colors.transparent, insetPadding: const EdgeInsets.all(12), child: ClipRRect(borderRadius: BorderRadius.circular(12), child: InteractiveViewer(minScale: 1, maxScale: 5, child: Image.memory(bytes, fit: BoxFit.contain))))),
                        child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.memory(bytes, height: 150, fit: BoxFit.cover)),
                      );
                    } catch (_) { return const SizedBox(); }
                  }
                  return const SizedBox();
                }).toList(),
              ),
            ),
          for (final part in parts) ...[
            if (part.isCommand) _handleCommandWithStatus(part.text)
            else if (part.isThought) ModelThinkingBox(text: part.text)
            else _MarkdownChunk(text: part.text, style: markdownStyle),
            const SizedBox(height: 8),
          ],
          if (toolStatuses.isNotEmpty) ...[
            _ToolCallsInlineList(statuses: toolStatuses),
            const SizedBox(height: 12),
          ],
          if (isStreaming)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2, valueColor: AlwaysStoppedAnimation<Color>(Colors.white.withOpacity(0.85)))),
                  const SizedBox(width: 8),
                  Text('streaming...', style: TextStyle(color: Colors.white.withOpacity(0.70), fontSize: 12, fontStyle: FontStyle.italic)),
                ],
              ),
            ),
        ],
      ),
    ),
  );
}

Widget _handleCommandWithStatus(String text) {
    final lines = text.trim().split('\n');
    if (lines.isEmpty) return const SizedBox();
    final rawFirstLine = lines[0];
    final typeParts = rawFirstLine.trim().split(' ');
    final cmdName = (typeParts.length > 1 && typeParts[0] == 'TOOL') ? typeParts[1] : typeParts[0];
    final status = toolStatuses.firstWhereOrNull((s) => s.toolName == cmdName);
    return CommandBox(text: text, status: status?.statusText, success: status?.success);
  }

  static List<_ContentPart> _parseContentParts(String rawInput) {
    if (rawInput.isEmpty) return const [];
    
    // Remove os blocos de raw json de eventos tool que vazam na string
    final RegExp ndjsonRegex = RegExp(r'^\{"type":"(?:TOOL_STARTED|TOOL_FINISHED|COMMAND_PREVIEW)".*$', multiLine: true, caseSensitive: false);
    final String input = rawInput.replaceAll(ndjsonRegex, '').trim();

    if (input.isEmpty) return const [];

    final parts = <_ContentPart>[];
    final normal = StringBuffer();
    final thought = StringBuffer();
    final command = StringBuffer();
    bool inThought = false;
    bool inCommand = false;

    void flush() {
      if (normal.isNotEmpty) { parts.add(_ContentPart.normal(normal.toString())); normal.clear(); }
      if (thought.isNotEmpty) { parts.add(_ContentPart.thought(thought.toString())); thought.clear(); }
      if (command.isNotEmpty) { parts.add(_ContentPart.command(command.toString())); command.clear(); }
    }

    int i = 0;
    while (i < input.length) {
      if (input.startsWith('<<<NHF:END:TOB>>>', i)) { flush(); inCommand = false; i += 17; continue; }
      if (input.startsWith('???', i)) { flush(); inCommand = !inCommand; i += 3; continue; }
      if (input.startsWith('<<<NHF:CMD:TOB>>>', i)) { flush(); inCommand = true; i += 17; continue; }
      if (input.startsWith('</thinking>', i)) { flush(); inThought = false; i += 11; continue; }
      if (input.startsWith('<thinking>', i)) { flush(); inThought = true; i += 10; continue; }
      if (input.startsWith('<<<NHF:END_RESPONSE:TOB>>>', i)) { i += 26; continue; }

      if (inThought) thought.write(input[i]);
      else if (inCommand) command.write(input[i]);
      else normal.write(input[i]);
      i++;
    }
    flush();
    return parts.where((p) => p.text.trim().isNotEmpty).toList();
  }
}

class _ContentPart {
  final bool isThought;
  final bool isCommand;
  final String text;
  const _ContentPart._(this.isThought, this.isCommand, this.text);
  factory _ContentPart.normal(String t) => _ContentPart._(false, false, t);
  factory _ContentPart.thought(String t) => _ContentPart._(true, false, t);
  factory _ContentPart.command(String t) => _ContentPart._(false, true, t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Calls List
// ─────────────────────────────────────────────────────────────────────────────

class _ToolCallsInlineList extends StatefulWidget {
  final List<ToolStatus> statuses;
  const _ToolCallsInlineList({required this.statuses});

  @override
  State<_ToolCallsInlineList> createState() => _ToolCallsInlineListState();
}

class _ToolCallsInlineListState extends State<_ToolCallsInlineList> {
  final Set<String> _expanded = {};

  String _formatRange(ToolStatus status) {
    final start = status.startLine;
    final end = status.endLine;
    if (start == null && end == null) return '';
    return 'lines ${start ?? ''}-${end ?? ''}';
  }

  @override
  Widget build(BuildContext context) {
    final items = [...widget.statuses]..sort((a, b) => b.timestamp.compareTo(a.timestamp));
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 0, vertical: 8),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 4),
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.22),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white.withOpacity(0.10)),
            ),
            child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ...items.map((s) {
                final isExpanded = _expanded.contains(s.id);
                final color = s.isFinal ? (s.success ? Colors.greenAccent : Colors.white.withOpacity(0.4)) : Colors.blueAccent;
                final title = (s.summary?.isNotEmpty == true ? s.summary! : s.toolName);
                final subtitle = s.summarySubtitle ?? _formatRange(s);
                final path = s.targetPath;
                final livePatch = s.isEditTool ? s.liveContentPreview : null;
                final command = s.commandText;
                final resultSummary = s.resultSummary;

                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: GestureDetector(
                    onTap: () => setState(() {
                      if (isExpanded) {
                        _expanded.remove(s.id);
                      } else {
                        _expanded.add(s.id);
                      }
                    }),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: isExpanded
                            ? Colors.white.withOpacity(0.07)
                            : Colors.white.withOpacity(0.04),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: isExpanded
                              ? color.withOpacity(0.22)
                              : Colors.white.withOpacity(0.06),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // ── Header row ──────────────────────────────────
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                width: 22, height: 22,
                                decoration: BoxDecoration(
                                  color: color.withOpacity(0.14),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(color: color.withOpacity(0.28)),
                                ),
                                child: Center(child: Text(s.icon, style: const TextStyle(fontSize: 12))),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(title, style: TextStyle(color: Colors.white.withOpacity(0.92), fontSize: 12, fontWeight: FontWeight.w700)),
                                    if (subtitle.isNotEmpty)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 2),
                                        child: Text(subtitle, style: TextStyle(color: Colors.white.withOpacity(0.58), fontSize: 10, fontWeight: FontWeight.w500)),
                                      ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: color.withOpacity(0.14),
                                  borderRadius: BorderRadius.circular(4),
                                  border: Border.all(color: color.withOpacity(0.28)),
                                ),
                                child: Text(s.statusText, style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w800)),
                              ),
                              const SizedBox(width: 6),
                              Icon(
                                isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                                size: 16,
                                color: Colors.white.withOpacity(0.40),
                              ),
                            ],
                          ),

                          // ── Collapsed summary (height-limited with fade) ──
                          if (!isExpanded)
                            _CollapsedToolBody(
                              path: path,
                              command: command,
                              livePatch: livePatch,
                              patchLabel: s.isFinal ? 'patch' : 'patch streaming',
                              resultSummary: resultSummary,
                              success: s.success,
                            ),

                          // ── Expanded detail view ─────────────────────────
                          if (isExpanded)
                            _ToolDetailExpanded(status: s),
                        ],
                      ),
                    ),
                  ),
                );
              }),
              if (items.length > 6)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text('+ ${items.length - 6} more', style: TextStyle(color: Colors.white.withOpacity(0.55), fontSize: 10, fontStyle: FontStyle.italic)),
                ),
            ],
          ),
        ),
      ),
      ),
    );
  }
}

// ── Collapsed tool body (height-capped with gradient fade) ─────────────────

class _CollapsedToolBody extends StatelessWidget {
  final String? path;
  final String? command;
  final String? livePatch;
  final String patchLabel;
  final String? resultSummary;
  final bool success;

  const _CollapsedToolBody({
    required this.path,
    required this.command,
    required this.livePatch,
    required this.patchLabel,
    required this.resultSummary,
    required this.success,
  });

  bool get _hasContent =>
      (path?.isNotEmpty == true) ||
      (command?.isNotEmpty == true) ||
      (livePatch?.isNotEmpty == true) ||
      (resultSummary?.isNotEmpty == true);

  @override
  Widget build(BuildContext context) {
    if (!_hasContent) return const SizedBox.shrink();

    final body = Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (path?.isNotEmpty == true)
            _ToolMetaLine(icon: Icons.insert_drive_file_outlined, text: path!),
          if (command?.isNotEmpty == true)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _ToolCodePreview(label: 'command', content: command!),
            ),
          if (livePatch?.isNotEmpty == true && !success)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _ToolCodePreview(label: patchLabel, content: livePatch!),
            ),
          if (livePatch?.isNotEmpty == true && success)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: _ToolCodePreview(label: 'diff aplicado', content: livePatch!),
            ),

          if (resultSummary?.isNotEmpty == true)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                resultSummary!,
                style: TextStyle(
                  color: success
                      ? Colors.white.withValues(alpha: 0.58)
                      : Colors.orangeAccent.withValues(alpha: 0.85),
                  fontSize: 10,
                  fontFamily: 'monospace',
                ),
              ),
            ),
        ],
      ),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        return body;
      },
    );
  }
}

// ── Expanded detail panel ───────────────────────────────────────────────────

class _ToolDetailExpanded extends StatelessWidget {
  final ToolStatus status;
  const _ToolDetailExpanded({required this.status});

  @override
  Widget build(BuildContext context) {
    final s = status;
    final color = s.isFinal ? (s.success ? Colors.greenAccent : Colors.white.withOpacity(0.4)) : Colors.blueAccent;
    final args = s.argsData;
    final result = s.resultData;

    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _divider(),

          // Path
          if (s.targetPath?.isNotEmpty == true) ...[
            _sectionLabel('FILE'),
            const SizedBox(height: 4),
            _ToolMetaLine(icon: Icons.insert_drive_file_outlined, text: s.targetPath!),
            const SizedBox(height: 10),
          ],

          // Command
          if (s.commandText?.isNotEmpty == true) ...[
            _ToolCodePreview(label: 'command', content: s.commandText!),
            const SizedBox(height: 10),
          ],

          // Args (excluding fields already shown)
          if (args != null && args.isNotEmpty) ...[
            _sectionLabel('ARGS'),
            const SizedBox(height: 4),
            _KeyValueBlock(map: _filterMap(args, {'cmd', 'path', 'file_path', 'content', 'replacement', 'patch', 'operations'})),
            const SizedBox(height: 10),
          ],

          // Patch / content (full, no truncation)
          if (s.liveContentPreview?.isNotEmpty == true) ...[
            _ToolCodePreview(label: s.isFinal ? 'patch' : 'patch streaming', content: s.liveContentPreview!),
            const SizedBox(height: 10),
          ],

          // Result data
          if (result != null && result.isNotEmpty) ...[
            _sectionLabel('RESULT'),
            const SizedBox(height: 4),
            _ExpandableResultBlock(result: result, color: color),
            const SizedBox(height: 10),
          ],

          // Error
          if (s.errorMessage?.isNotEmpty == true) ...[
            _sectionLabel('ERROR', color: Colors.redAccent),
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: Colors.red.withOpacity(0.08),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.red.withOpacity(0.22)),
              ),
              child: SelectableText(
                s.errorMessage!,
                style: const TextStyle(color: Colors.redAccent, fontSize: 10.5, fontFamily: 'monospace', height: 1.4),
              ),
            ),
            const SizedBox(height: 10),
          ],

          _divider(),

          // Metadata footer
          Row(
            children: [
              _MetaChip(label: 'tool', value: s.toolName),
              const Spacer(),
              Text(
                _formatTime(s.timestamp),
                style: TextStyle(color: Colors.white.withOpacity(0.35), fontSize: 9),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Map<String, dynamic> _filterMap(Map<String, dynamic> map, Set<String> exclude) {
    return {for (final e in map.entries) if (!exclude.contains(e.key)) e.key: e.value};
  }

  Widget _divider() => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Divider(color: Colors.white.withOpacity(0.08), height: 1),
  );

  Widget _sectionLabel(String label, {Color? color}) => Text(
    label,
    style: TextStyle(
      color: color ?? Colors.white.withOpacity(0.38),
      fontSize: 9,
      fontWeight: FontWeight.w800,
      letterSpacing: 0.6,
    ),
  );

  String _formatTime(DateTime dt) {
    final h = dt.hour.toString().padLeft(2, '0');
    final m = dt.minute.toString().padLeft(2, '0');
    final s = dt.second.toString().padLeft(2, '0');
    return '$h:$m:$s';
  }
}

class _KeyValueBlock extends StatelessWidget {
  final Map<String, dynamic> map;
  const _KeyValueBlock({required this.map});

  @override
  Widget build(BuildContext context) {
    final entries = map.entries.toList();
    if (entries.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.18),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withOpacity(0.07)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: entries.map((e) {
          final valStr = e.value is String
              ? e.value as String
              : const JsonEncoder.withIndent('  ').convert(e.value);
          final isLong = valStr.contains('\n') || valStr.length > 80;
          return Padding(
            padding: const EdgeInsets.only(bottom: 5),
            child: isLong
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${e.key}:', style: TextStyle(color: Colors.white.withOpacity(0.45), fontSize: 9.5, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 3),
                      SelectableText(valStr, style: TextStyle(color: Colors.white.withOpacity(0.80), fontSize: 10, fontFamily: 'monospace', height: 1.35)),
                    ],
                  )
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${e.key}: ', style: TextStyle(color: Colors.white.withOpacity(0.45), fontSize: 9.5, fontWeight: FontWeight.w700)),
                      Expanded(child: SelectableText(valStr, style: TextStyle(color: Colors.white.withOpacity(0.80), fontSize: 10, fontFamily: 'monospace'))),
                    ],
                  ),
          );
        }).toList(),
      ),
    );
  }
}

class _ExpandableResultBlock extends StatelessWidget {
  final Map<String, dynamic> result;
  final Color color;
  const _ExpandableResultBlock({required this.result, required this.color});

  @override
  Widget build(BuildContext context) {
    // Special rendering for stdout/stderr
    final stdout = result['stdout']?.toString() ?? result['output']?.toString();
    final stderr = result['stderr']?.toString();
    final exitCode = result['exitCode'] ?? result['exit_code'];
    final others = {
      for (final e in result.entries)
        if (!{'stdout', 'stderr', 'output', 'exitCode', 'exit_code'}.contains(e.key))
          e.key: e.value
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (exitCode != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Text('exit code: ', style: TextStyle(color: Colors.white.withOpacity(0.45), fontSize: 9.5, fontWeight: FontWeight.w700)),
                Text('$exitCode', style: TextStyle(color: color, fontSize: 9.5, fontWeight: FontWeight.w800, fontFamily: 'monospace')),
              ],
            ),
          ),
        if (stdout != null && stdout.trim().isNotEmpty)
          _labeledBlock('stdout', stdout.trim(), Colors.white.withOpacity(0.80)),
        if (stderr != null && stderr.trim().isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: _labeledBlock('stderr', stderr.trim(), Colors.orangeAccent.withOpacity(0.85)),
          ),
        if (others.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: _KeyValueBlock(map: others),
          ),
      ],
    );
  }

  Widget _labeledBlock(String label, String content, Color textColor) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.22),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withOpacity(0.07)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label.toUpperCase(), style: TextStyle(color: Colors.white.withOpacity(0.38), fontSize: 9, fontWeight: FontWeight.w800, letterSpacing: 0.4)),
          const SizedBox(height: 5),
          SelectableText(content, style: TextStyle(color: textColor, fontSize: 10.5, fontFamily: 'monospace', height: 1.35)),
        ],
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  final String label;
  final String value;
  const _MetaChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.05),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$label: ', style: TextStyle(color: Colors.white.withOpacity(0.35), fontSize: 9)),
          Text(value, style: TextStyle(color: Colors.white.withOpacity(0.60), fontSize: 9, fontFamily: 'monospace')),
        ],
      ),
    );
  }
}

class _ToolMetaLine extends StatelessWidget {
  final IconData icon;
  final String text;
  const _ToolMetaLine({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 13, color: Colors.white54),
        const SizedBox(width: 6),
        Expanded(
          child: SelectableText(
            text,
            style: TextStyle(
              color: Colors.white.withOpacity(0.68),
              fontSize: 10.5,
              fontFamily: 'monospace',
            ),
          ),
        ),
      ],
    );
  }
}

class _ToolCodePreview extends StatelessWidget {
  final String label;
  final String content;
  const _ToolCodePreview({required this.label, required this.content});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFF0D0F14), // Dark background para constraste
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.03),
              border: Border(
                bottom: BorderSide(color: Colors.white.withValues(alpha: 0.05)),
              ),
            ),
            child: Text(
              label.toUpperCase(),
              style: TextStyle(
                color: Colors.white.withValues(alpha: 0.46),
                fontSize: 9,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.4,
              ),
            ),
          ),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 250),
            child: Scrollbar(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(8),
                child: SelectableText(
                  content,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.85),
                    fontSize: 10.5,
                    height: 1.35,
                    fontFamily: 'monospace',
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MarkdownChunk extends StatelessWidget {
  final String text;
  final MarkdownStyleSheet style;
  const _MarkdownChunk({required this.text, required this.style});
  @override
  Widget build(BuildContext context) { return MarkdownBody(data: text, selectable: true, styleSheet: style); }
}