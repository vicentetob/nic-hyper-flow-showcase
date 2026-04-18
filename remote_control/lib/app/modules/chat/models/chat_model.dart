class Chat {
  final String id;
  final String title;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool isActive;
  final double apiCostUsd;
  final int contextSize;

  Chat({
    required this.id,
    required this.title,
    required this.createdAt,
    required this.updatedAt,
    this.isActive = false,
    this.apiCostUsd = 0,
    this.contextSize = 0,
  });

  factory Chat.fromFirestore(Map<String, dynamic> data) {
    return Chat(
      id: data['id'] as String,
      title: data['title'] as String? ?? 'New Chat',
      createdAt: DateTime.parse(data['createdAt'] as String? ?? DateTime.now().toIso8601String()),
      updatedAt: DateTime.parse(data['updatedAt'] as String? ?? DateTime.now().toIso8601String()),
      isActive: data['isActive'] as bool? ?? false,
      apiCostUsd: (data['apiCostUsd'] as num?)?.toDouble() ?? 0,
      contextSize: (data['contextSize'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'id': id,
      'title': title,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
      'isActive': isActive,
      'apiCostUsd': apiCostUsd,
      'contextSize': contextSize,
    };
  }

  Chat copyWith({
    String? id,
    String? title,
    DateTime? createdAt,
    DateTime? updatedAt,
    bool? isActive,
    double? apiCostUsd,
    int? contextSize,
  }) {
    return Chat(
      id: id ?? this.id,
      title: title ?? this.title,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isActive: isActive ?? this.isActive,
      apiCostUsd: apiCostUsd ?? this.apiCostUsd,
      contextSize: contextSize ?? this.contextSize,
    );
  }
}