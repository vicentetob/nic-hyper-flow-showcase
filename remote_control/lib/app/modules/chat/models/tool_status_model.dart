import 'dart:convert';

class ToolStatus {
  final String id;
  final String toolName;
  final bool success;
  final String details;
  // Short human-friendly label (e.g. "read_file main.dart")
  final String? summary;
  final String chatId;
  final String toolCallId;
  // Optional: associate tool status with a specific assistant message.
  // This is important for tool-calling mode where tool usage isn't embedded in the text.
  final String? messageId;
  final DateTime timestamp;
  final String source;
  final bool isFinal;

  ToolStatus({
    required this.id,
    required this.toolName,
    required this.success,
    required this.details,
    this.summary,
    required this.chatId,
    required this.toolCallId,
    this.messageId,
    required this.timestamp,
    required this.source,
    this.isFinal = true,
  });

  factory ToolStatus.fromFirestore(Map<String, dynamic> data) {
    return ToolStatus(
      id: data['id'] as String,
      toolName: data['toolName'] as String? ?? data['name'] as String? ?? '',
      success: data['success'] as bool? ?? ((data['isFinal'] as bool? ?? false) ? true : false),
      details: data['details'] as String? ?? data['args'] as String? ?? '',
      summary: data['summary'] as String? ?? _extractSummary(data['details']),
      chatId: data['chatId'] as String? ?? '',
      toolCallId: data['toolCallId'] as String? ?? '',
      messageId: data['messageId'] as String?,
      timestamp: DateTime.parse((data['timestamp'] ?? data['updatedAt'] ?? DateTime.now().toIso8601String()).toString()),
      source: data['source'] as String? ?? 'vscode_extension',
      isFinal: data['isFinal'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'id': id,
      'toolName': toolName,
      'success': success,
      'details': details,
      if (summary != null) 'summary': summary,
      'chatId': chatId,
      'toolCallId': toolCallId,
      if (messageId != null) 'messageId': messageId,
      'timestamp': timestamp.toIso8601String(),
      'source': source,
      'isFinal': isFinal,
    };
  }

  ToolStatus copyWith({
    String? id,
    String? toolName,
    bool? success,
    String? details,
    String? summary,
    String? chatId,
    String? toolCallId,
    String? messageId,
    DateTime? timestamp,
    String? source,
    bool? isFinal,
  }) {
    return ToolStatus(
      id: id ?? this.id,
      toolName: toolName ?? this.toolName,
      success: success ?? this.success,
      details: details ?? this.details,
      summary: summary ?? this.summary,
      chatId: chatId ?? this.chatId,
      toolCallId: toolCallId ?? this.toolCallId,
      messageId: messageId ?? this.messageId,
      timestamp: timestamp ?? this.timestamp,
      source: source ?? this.source,
      isFinal: isFinal ?? this.isFinal,
    );
  }

  // Helper method to get icon based on tool name
  String get icon {
    switch (toolName) {
      case 'read_file':
        return '📖';
      case 'patch_file':
      case 'patch':
      case 'replace':
      case 'create':
      case 'delete':
        return '🔧';
      case 'run_command':
        return '💻';
      case 'search':
        return '🔍';
      case 'web_search':
        return '🌐';
      case 'list_dir_recursive':
        return '📂';
      case 'parse_lint_errors':
        return '✅';
      case 'http_request':
        return '🌐';
      default:
        return '⚙️';
    }
  }

  // Helper method to get status color
  String get statusColor {
    if (!isFinal) return '#64B5F6';
    return success ? '#4CAF50' : '#F44336'; // Green for success, Red for failure
  }

  Map<String, dynamic>? get parsedDetails => _decodeMap(details);

  Map<String, dynamic>? get summaryData {
    final summary = parsedDetails?['summary'];
    if (summary is Map<String, dynamic>) return summary;
    return null;
  }

  String? get summarySubtitle {
    final subtitle = summaryData?['subtitle'];
    if (subtitle is String && subtitle.trim().isNotEmpty) return subtitle.trim();
    return null;
  }

  Map<String, dynamic>? get argsData {
    final args = parsedDetails?['args'];
    if (args is Map<String, dynamic>) return args;
    return parsedDetails;
  }

  Map<String, dynamic>? get resultData {
    final result = parsedDetails?['result'];
    if (result is Map<String, dynamic>) return result;
    return null;
  }

  String? get errorMessage {
    final error = parsedDetails?['error'];
    if (error is String && error.trim().isNotEmpty) return error.trim();
    return null;
  }

  String? get targetPath {
    final args = argsData;
    final result = resultData;
    final direct = args?['path'] ?? args?['file_path'] ?? result?['path'];
    if (direct is String && direct.trim().isNotEmpty) return direct.trim();

    final operations = args?['operations'];
    if (operations is List && operations.isNotEmpty) {
      final first = operations.first;
      if (first is Map<String, dynamic>) {
        final p = first['path'];
        if (p is String && p.trim().isNotEmpty) return p.trim();
      }
    }
    return null;
  }

  int? get startLine {
    final result = resultData;
    final args = argsData;
    final value = result?['startLine'] ?? args?['startLine'];
    if (value is num) return value.toInt();
    return int.tryParse('$value');
  }

  int? get endLine {
    final result = resultData;
    final args = argsData;
    final value = result?['endLine'] ?? args?['endLine'];
    if (value is num) return value.toInt();
    return int.tryParse('$value');
  }

  String? get commandText {
    final cmd = argsData?['cmd'];
    if (cmd is String && cmd.trim().isNotEmpty) return cmd.trim();
    return null;
  }

  bool get isEditTool {
    switch (toolName) {
      case 'patch_file':
      case 'patch':
      case 'replace':
      case 'create':
      case 'delete':
      case 'apply_patch_batch':
        return true;
      default:
        return false;
    }
  }

  String? get liveContentPreview {
    final args = argsData;
    if (args == null) return null;

    if (args['content'] is String && (args['content'] as String).trim().isNotEmpty) {
      return (args['content'] as String).trimRight();
    }
    if (args['replacement'] is String && (args['replacement'] as String).trim().isNotEmpty) {
      return (args['replacement'] as String).trimRight();
    }
    if (args['patch'] is String && (args['patch'] as String).trim().isNotEmpty) {
      return (args['patch'] as String).trimRight();
    }

    final operations = args['operations'];
    if (operations is List && operations.isNotEmpty) {
      final buffer = StringBuffer();
      for (final op in operations) {
        if (op is! Map<String, dynamic>) continue;
        final opPath = op['path']?.toString() ?? 'file';
        final content = op['content']?.toString() ?? op['replacement']?.toString() ?? '';
        if (content.trim().isEmpty) continue;
        if (buffer.isNotEmpty) buffer.writeln('\n');
        buffer.writeln('// $opPath');
        buffer.write(content.trimRight());
      }
      final combined = buffer.toString().trimRight();
      if (combined.isNotEmpty) return combined;
    }

    return null;
  }

  static Map<String, dynamic>? _decodeMap(dynamic raw) {
    if (raw is Map<String, dynamic>) return raw;
    if (raw == null) return null;
    final text = raw.toString().trim();
    if (text.isEmpty) return null;
    try {
      final decoded = jsonDecode(text);
      if (decoded is Map<String, dynamic>) return decoded;
    } catch (_) {
      // details may already be plain text
    }
    return null;
  }

  static String? _extractSummary(dynamic rawDetails) {
    final decoded = _decodeMap(rawDetails);
    final summary = decoded?['summary'];
    if (summary is String && summary.trim().isNotEmpty) {
      return summary.trim();
    }
    if (summary is Map<String, dynamic>) {
      final title = summary['title'];
      if (title is String && title.trim().isNotEmpty) {
        return title.trim();
      }
    }
    return null;
  }

  // Helper method to get status text
  String get statusText {
    if (!isFinal) return 'RUNNING';
    return success ? 'SUCCESS' : 'FAIL';
  }

  /// Human-readable summary of the result (never raw JSON).
  /// Returns null when there's nothing meaningful to show beyond the title/command.
  String? get resultSummary {
    // Error takes priority
    if (errorMessage != null) return errorMessage;

    final result = resultData;

    // run_command → show exit code + stdout preview
    if (toolName == 'run_command') {
      final parts = <String>[];
      final exitCode = result?['exitCode'] ?? result?['exit_code'];
      if (exitCode != null) parts.add('exit $exitCode');
      final stdout = (result?['stdout'] ?? result?['output'])?.toString().trim();
      if (stdout != null && stdout.isNotEmpty) {
        final preview = stdout.length > 200 ? '${stdout.substring(0, 200)}…' : stdout;
        parts.add(preview);
      }
      final stderr = result?['stderr']?.toString().trim();
      if (stderr != null && stderr.isNotEmpty && !success) {
        final preview = stderr.length > 200 ? '${stderr.substring(0, 200)}…' : stderr;
        parts.add('stderr: $preview');
      }
      return parts.isEmpty ? null : parts.join('\n');
    }

    // read_file → show lines read
    if (toolName == 'read_file') {
      final start = startLine;
      final end = endLine;
      if (start != null && end != null) return 'lines $start–$end';
      final linesRead = result?['linesRead'] ?? result?['lines'];
      if (linesRead != null) return '$linesRead lines read';
      return null;
    }

    // web_search / search → show number of results
    if (toolName == 'web_search' || toolName == 'search') {
      final count = result?['count'] ?? result?['total'];
      if (count != null) return '$count results';
      return null;
    }

    // http_request → show status code
    if (toolName == 'http_request') {
      final status = result?['status'] ?? result?['statusCode'];
      if (status != null) return 'HTTP $status';
      return null;
    }

    // Generic: if result has a plain message/text field, show it
    final msg = result?['message'] ?? result?['text'] ?? result?['output'];
    if (msg is String && msg.trim().isNotEmpty) {
      final t = msg.trim();
      return t.length > 200 ? '${t.substring(0, 200)}…' : t;
    }

    // For edit tools with no error, no extra summary needed (path is already shown)
    return null;
  }
}