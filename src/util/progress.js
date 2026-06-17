'use strict';

const PROGRESS_PREFIX = '__CHOOPS_PROGRESS__';

function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
}

function createProgressReporter(options = {}) {
    const enabled = options === true || options.progress === true || options.progress === 'true';
    const prefix = options.prefix || PROGRESS_PREFIX;
    const output = typeof options.output === 'function' ? options.output : console.log;
    let lastPercent = null;

    function emit(event = {}) {
        if (!enabled) return;

        const total = Number(event.total || 0);
        const current = Number(event.current || 0);
        const computedPercent = total > 0 ? (current / total) * 100 : event.percent;
        const percent = event.indeterminate ? null : clamp(computedPercent, 0, 100);

        // Avoid flooding the native UI with identical percentage-only updates.
        if (percent !== null) {
            const rounded = Math.round(percent * 10) / 10;
            if (lastPercent !== null && rounded === lastPercent && !event.force) {
                return;
            }
            lastPercent = rounded;
        }

        const payload = {
            phase: event.phase || 'Working',
            message: event.message || event.phase || 'Working',
            current: Number.isFinite(current) ? current : 0,
            total: Number.isFinite(total) ? total : 0,
            percent,
            indeterminate: !!event.indeterminate
        };

        output(prefix + JSON.stringify(payload));
    }

    function phase(phaseName, current, total, message, extra = {}) {
        emit({ ...extra, phase: phaseName, current, total, message });
    }

    function percent(phaseName, percentValue, message, extra = {}) {
        emit({ ...extra, phase: phaseName, percent: percentValue, message });
    }

    return { enabled, emit, phase, percent };
}

function mapProgress(current, total, basePercent = 0, spanPercent = 100) {
    const count = Number(total || 0);
    if (count <= 0) return clamp(basePercent, 0, 100);
    return clamp(basePercent + ((Number(current || 0) / count) * spanPercent), 0, 100);
}

module.exports = {
    PROGRESS_PREFIX,
    createProgressReporter,
    mapProgress
};
