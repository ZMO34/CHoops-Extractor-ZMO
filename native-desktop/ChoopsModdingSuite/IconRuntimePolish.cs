namespace ChoopsModdingSuite;

/// <summary>
/// Obsolete placeholder kept only so older project references do not break.
///
/// The previous implementation used a module initializer and Application.Idle to mutate
/// already-laid-out controls. That caused tab flashing, clipped labels, shrunken buttons,
/// and unpredictable redraw loops. The production UI now owns its layout and icon directly
/// inside Program.cs, so this class intentionally has no startup hook and no side effects.
/// </summary>
internal static class IconRuntimePolish
{
}
