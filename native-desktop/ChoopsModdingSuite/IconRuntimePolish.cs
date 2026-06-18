using System;
using System.Runtime.CompilerServices;

namespace ChoopsModdingSuite;

/// <summary>
/// Legacy runtime icon mutation hook.
///
/// This used to walk the WinForms tree after layout and inject icons into existing
/// labels/buttons. That made the UI unstable: headers and tabs could be clipped,
/// labels could grow after layout, and the dashboard could collapse into narrow
/// columns. The current native UI owns its iconography directly in Program.cs, so
/// this initializer intentionally does nothing.
/// </summary>
internal static class IconRuntimePolish
{
    [ModuleInitializer]
    internal static void Initialize()
    {
        // No-op by design. Do not mutate live WinForms controls after layout.
    }
}
