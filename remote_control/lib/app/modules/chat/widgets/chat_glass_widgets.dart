import 'dart:ui';
import 'package:flutter/material.dart';

class GlassBackground extends StatelessWidget {
  const GlassBackground({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.black,
      ),
    );
  }
}

class BlurBlob extends StatelessWidget {
  final double size;
  final double opacity;

  const BlurBlob({super.key, required this.size, required this.opacity});

  @override
  Widget build(BuildContext context) {
    return ClipOval(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 30, sigmaY: 30),
        child: Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: Colors.lightBlueAccent.withOpacity(opacity),
          ),
        ),
      ),
    );
  }
}

class GlassBar extends StatelessWidget {
  final Widget child;

  const GlassBar({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.black.withOpacity(0.18),
            border: Border(
              bottom: BorderSide(color: Colors.white.withOpacity(0.10)),
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}

class GlassPanel extends StatelessWidget {
  final Widget child;
  final double radius;
  final EdgeInsets padding;

  const GlassPanel({
    super.key,
    required this.child,
    this.radius = 16,
    this.padding = const EdgeInsets.all(12),
  });

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.06),
            borderRadius: BorderRadius.circular(radius),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white.withOpacity(0.10),
                Colors.white.withOpacity(0.04),
              ],
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}

class GlassButton extends StatelessWidget {
  final VoidCallback onTap;
  final Widget child;

  const GlassButton({super.key, required this.onTap, required this.child});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
            child: Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.10),
                border: Border.all(color: Colors.white.withOpacity(0.16)),
                shape: BoxShape.circle,
              ),
              child: Center(child: child),
            ),
          ),
        ),
      ),
    );
  }
}

class GlassBubble extends StatelessWidget {
  final bool isAssistant;
  final Widget child;

  const GlassBubble({super.key, required this.isAssistant, required this.child});

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.only(
      topLeft: const Radius.circular(18),
      topRight: const Radius.circular(18),
      bottomLeft: Radius.circular(isAssistant ? 4 : 18),
      bottomRight: Radius.circular(isAssistant ? 18 : 4),
    );

    final baseColor = isAssistant
        ? Colors.white.withOpacity(0.08)
        : Colors.lightBlueAccent.withOpacity(0.14);

    return ClipRRect(
      borderRadius: radius,
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 14, sigmaY: 14),
        child: Container(
          padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
          decoration: BoxDecoration(
            color: baseColor,
            borderRadius: radius,
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: isAssistant
                  ? [
                      Colors.white.withOpacity(0.10),
                      Colors.white.withOpacity(0.05),
                    ]
                  : [
                      Colors.lightBlueAccent.withOpacity(0.16),
                      Colors.white.withOpacity(0.04),
                    ],
            ),
          ),
          child: child,
        ),
      ),
    );

  }
}
