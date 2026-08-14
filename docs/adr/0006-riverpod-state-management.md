# ADR 0006: Choice of Riverpod with Code Generation for Flutter State Management

## Context
The mobile app requires state management for offline message synchronization, real-time socket connections, WebRTC peer connection states, key bundles, contact listing, and audio voice note playback.

## Decision
We choose **Riverpod** with `riverpod_generator` (`@riverpod`) code generation.

## Consequences
- **Compile-Time Safety:** Eliminates `ProviderNotFoundException` by catching dependency errors at compile time.
- **Granular Rebuilds:** `ref.watch(provider.select(...))` ensures UI widgets rebuild only when target sub-fields change, preserving 60 FPS performance.
- **Testability & Overrides:** Facilitates isolation testing by allowing mock overrides for hardware, database, or socket providers during widget tests.

## Alternatives Considered
- **BLoC (Business Logic Component):** Excellent separation, but introduces heavy boilerplate for simple reactive state flows compared to modern Riverpod generator syntax.
- **Provider (legacy):** Lacks compile-time safety and relies on BuildContext lookup, making out-of-tree async background callbacks fragile.
