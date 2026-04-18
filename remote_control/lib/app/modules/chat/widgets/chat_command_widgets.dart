import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

class ModelThinkingBox extends StatelessWidget {
  final String text;

  const ModelThinkingBox({super.key, required this.text});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final base = MarkdownStyleSheet.fromTheme(theme);

    final thoughtStyle = base.copyWith(
      p: base.p?.copyWith(
        color: Colors.white.withOpacity(0.85),
        fontSize: 13,
        height: 1.35,
        fontStyle: FontStyle.italic,
      ),
      strong: base.strong?.copyWith(color: Colors.white.withOpacity(0.90)),
      em: base.em?.copyWith(
        color: Colors.white.withOpacity(0.90),
        fontStyle: FontStyle.italic,
      ),
      code: base.code?.copyWith(
        color: Colors.white.withOpacity(0.92),
        fontFamily: 'monospace',
        fontSize: 12.5,
      ),
      codeblockDecoration: BoxDecoration(
        color: Colors.black.withOpacity(0.18),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.10)),
      ),
    );

    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.08),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white.withOpacity(0.14)),
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Colors.white.withOpacity(0.10),
                  Colors.white.withOpacity(0.05),
                ],
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.psychology_outlined,
                      size: 14,
                      color: Colors.white.withOpacity(0.7),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'MODEL THINKING',
                      style: TextStyle(
                        color: Colors.white.withOpacity(0.70),
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                MarkdownBody(
                  data: text,
                  selectable: true,
                  styleSheet: thoughtStyle,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class CommandBox extends StatelessWidget {
  final String text;
  final String? status;
  final bool? success;

  const CommandBox({super.key, required this.text, this.status, this.success});

  @override
  Widget build(BuildContext context) {
    final lines = text.trim().split('\n');
    if (lines.isEmpty) return const SizedBox();

    final rawFirstLine = lines[0];
    final typeParts = rawFirstLine.trim().split(' ');
    final type = typeParts.isNotEmpty ? typeParts[0] : 'UNKNOWN';
    final isTool = type == 'TOOL' && typeParts.length > 1;
    final cmdName = isTool ? typeParts[1] : type;

    final isPatch = ['PATCH_FILE', 'CREATE', 'REPLACE', 'DELETE'].contains(type);
    
    // O conteúdo é tudo DEPOIS da primeira linha (que contém o comando)
    final commandBody = lines.length > 1 ? lines.skip(1).join('\n').trim() : '';

    if (isPatch) {
      return PatchBox(
        type: type,
        content: commandBody,
        path: typeParts.length > 1 ? typeParts[1] : '',
        status: status,
        success: success,
      );
    }

    final info = _getCommandInfo(type, cmdName);

    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: Container(
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.black.withOpacity(0.35),
              border: Border(
                top: BorderSide(color: Colors.white.withOpacity(0.1)),
                right: BorderSide(color: Colors.white.withOpacity(0.1)),
                bottom: BorderSide(color: Colors.white.withOpacity(0.1)),
                left: BorderSide(color: info.color, width: 3.5),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  decoration: BoxDecoration(
                    color: info.color.withOpacity(0.08),
                    border: Border(
                      bottom: BorderSide(color: Colors.white.withOpacity(0.05)),
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(info.icon, size: 16, color: info.color),
                      const SizedBox(width: 10),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            info.friendlyName,
                            style: TextStyle(
                              color: info.color,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.5,
                            ),
                          ),
                          if (isTool)
                            Text(
                              'INTERNAL TOOL: $cmdName',
                              style: TextStyle(
                                color: info.color.withOpacity(0.6),
                                fontSize: 8,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 0.3,
                              ),
                            ),
                        ],
                      ),
                      const Spacer(),
                      if (status == null)
                        PulseStatus(color: info.color)
                      else
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: (success == true ? Colors.green : Colors.white.withOpacity(0.4)).withOpacity(0.2),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(
                              color: (success == true ? Colors.green : Colors.white.withOpacity(0.4)).withOpacity(0.4),
                            ),
                          ),
                          child: Text(
                            status!,
                            style: TextStyle(
                              color: success == true ? Colors.greenAccent : Colors.white.withOpacity(0.4),
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                if (commandBody.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(8),
                        border:
                            Border.all(color: Colors.white.withOpacity(0.05)),
                      ),
                      child: Text(
                        commandBody,
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.85),
                          fontSize: 12,
                          height: 1.4,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  _CmdUiInfo _getCommandInfo(String type, String cmdName) {
    if (type == 'TOOL') {
      switch (cmdName) {
        case 'read_file':
          return _CmdUiInfo('READ FILE', Icons.menu_book, const Color(0xFF4FC1FF));
        case 'list_dir_recursive':
          return _CmdUiInfo('LIST DIRECTORY', Icons.folder_copy, const Color(0xFF4FC1FF));
        case 'search':
          return _CmdUiInfo('SEARCH WORKSPACE', Icons.search, const Color(0xFF4FC1FF));
        case 'run_command':
          return _CmdUiInfo('TERMINAL EXEC', Icons.terminal, const Color(0xFFF44336));
        case 'web_search':
          return _CmdUiInfo('WEB SEARCH', Icons.public, const Color(0xFF4CAF50));
        case 'current_plan':
          return _CmdUiInfo('PLAN UPDATE', Icons.assignment, const Color(0xFFFFC107));
        case 'commit_knowledge':
          return _CmdUiInfo('KNOWLEDGE SAVE', Icons.auto_awesome, const Color(0xFF9C27B0));
        case 'name_chat':
          return _CmdUiInfo('NAME CHAT', Icons.label_important, const Color(0xFF4FC1FF));
        default:
          return _CmdUiInfo('TOOL CALL', Icons.build, const Color(0xFF4FC1FF));
      }
    }

    return _CmdUiInfo(type, Icons.code, const Color(0xFF4FC1FF));
  }
}

class _CmdUiInfo {
  final String friendlyName;
  final IconData icon;
  final Color color;
  _CmdUiInfo(this.friendlyName, this.icon, this.color);
}

class PulseStatus extends StatefulWidget {
  final Color color;
  const PulseStatus({super.key, required this.color});

  @override
  State<PulseStatus> createState() => _PulseStatusState();
}

class _PulseStatusState extends State<PulseStatus>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);
    _animation = Tween<double>(begin: 0.4, end: 1.0).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _animation,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: widget.color,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: widget.color.withOpacity(0.5),
                  blurRadius: 4,
                  spreadRadius: 1,
                ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          Text(
            'EXECUTING',
            style: TextStyle(
              color: widget.color,
              fontSize: 9,
              fontWeight: FontWeight.w900,
              letterSpacing: 0.5,
            ),
          ),
        ],
      ),
    );
  }
}

class PatchBox extends StatefulWidget {
  final String type;
  final String path;
  final String content;
  final String? status;
  final bool? success;

  const PatchBox({
    super.key,
    required this.type,
    required this.path,
    required this.content,
    this.status,
    this.success,
  });

  @override
  State<PatchBox> createState() => _PatchBoxState();
}

class _PatchBoxState extends State<PatchBox> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    // Scroll automático quando o widget é inicializado
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      }
    });
  }

  @override
  void didUpdateWidget(PatchBox oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Quando o conteúdo é atualizado (durante streaming), rola para o final
    if (widget.content != oldWidget.content) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      });
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
          child: Container(
            width: double.infinity,
            decoration: BoxDecoration(
              color: const Color(0xFF1E1E1E).withOpacity(0.35),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.transparent),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.4),
                  blurRadius: 40,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Container(
              decoration: const BoxDecoration(
                border: Border(
                  left: BorderSide(color: Color(0xFF4FC1FF), width: 3),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.04),
                      border: Border(
                        bottom: BorderSide(color: Colors.white.withOpacity(0.06)),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.edit_note, size: 16, color: Color(0xFF4FC1FF)),
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFF4FC1FF).withOpacity(0.15),
                            borderRadius: BorderRadius.circular(4),
                            border: Border.all(
                              color: const Color(0xFF4FC1FF).withOpacity(0.2),
                            ),
                          ),
                          child: Text(
                            widget.type,
                            style: const TextStyle(
                              color: Color(0xFF4FC1FF),
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.8,
                            ),
                          ),
                        ),
                        if (widget.path.isNotEmpty) ...[
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              widget.path,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFFB5CEA8),
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                fontFamily: 'monospace',
                              ),
                            ),
                          ),
                        ],
                        const SizedBox(width: 8),
                        if (widget.status == null)
                          Text(
                            'writing...',
                            style: TextStyle(
                              color: Colors.yellow.withOpacity(0.8),
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          )
                        else
                          Text(
                            widget.status!,
                            style: TextStyle(
                              color: widget.success == true ? Colors.greenAccent : Colors.white.withOpacity(0.4),
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                      ],
                    ),
                  ),

                  // Body com scroll automático
                  Container(
                    constraints: const BoxConstraints(maxHeight: 250),
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    child: SingleChildScrollView(
                      controller: _scrollController,
                      child: Text(
                        widget.content.trim(),
                        style: const TextStyle(
                          color: Color(0xFFE0E0E0),
                          fontSize: 12,
                          height: 1.5,
                          fontFamily: 'monospace',
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
