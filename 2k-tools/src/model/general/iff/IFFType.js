module.exports.TYPES = {
    UNKNOWN: 0,
    TXTR: 1,
    SCNE: 2,
    AUDO: 3,
    LAYT: 4,
    MRKS: 5,
    PRIV: 6,
    TXT: 7,
    DRCT: 8,
    CLTH: 9,
    AMBO: 10,
    HILT: 11,
    NAME: 12,
    CDAN: 13,
    FGCT: 14,
    FXTWE: 15,
    FRFG: 16,
    SPCI: 17,
    SHAP: 18,
    STRG: 19,
    SKEL: 20,
    ROST: 21,
    HTAJ: 22,
    BLRB: 23,
    UNLK: 24,
    SINGL: 25,
    AUSB: 26,
    AOSS: 27,
    AMCR: 28,
    SCOS: 29,
    UNAD: 30
};

const TYPE_STRING_MAP = {
    TXTR: module.exports.TYPES.TXTR,
    SCNE: module.exports.TYPES.SCNE,
    AUDO: module.exports.TYPES.AUDO,
    LAYT: module.exports.TYPES.LAYT,
    MRKS: module.exports.TYPES.MRKS,
    PRIV: module.exports.TYPES.PRIV,
    TXT: module.exports.TYPES.TXT,
    DRCT: module.exports.TYPES.DRCT,
    CLTH: module.exports.TYPES.CLTH,
    Clth: module.exports.TYPES.CLTH,
    AMBO: module.exports.TYPES.AMBO,
    HILT: module.exports.TYPES.HILT,
    NAME: module.exports.TYPES.NAME,
    CDAN: module.exports.TYPES.CDAN,
    FGCT: module.exports.TYPES.FGCT,
    FxTwe: module.exports.TYPES.FXTWE,
    FRFG: module.exports.TYPES.FRFG,
    SPCI: module.exports.TYPES.SPCI,
    SHAP: module.exports.TYPES.SHAP,
    STRG: module.exports.TYPES.STRG,
    SKEL: module.exports.TYPES.SKEL,
    ROST: module.exports.TYPES.ROST,
    HTAJ: module.exports.TYPES.HTAJ,
    BLRB: module.exports.TYPES.BLRB,
    UNLK: module.exports.TYPES.UNLK,
    Singl: module.exports.TYPES.SINGL,
    AUSB: module.exports.TYPES.AUSB,
    AOSS: module.exports.TYPES.AOSS,
    AMCR: module.exports.TYPES.AMCR,
    SCOS: module.exports.TYPES.SCOS,
    UnAD: module.exports.TYPES.UNAD
};

const TYPE_VALUE_MAP = Object.entries(TYPE_STRING_MAP).reduce((map, [key, value]) => {
    if (!map[value]) map[value] = key;
    return map;
}, {});

module.exports.stringToType = (str) => {
    if (!str) return module.exports.TYPES.UNKNOWN;
    if (str.slice(-1) === '\0') str = str.slice(0, str.length - 1);
    return TYPE_STRING_MAP[str] || TYPE_STRING_MAP[str.toUpperCase()] || module.exports.TYPES.UNKNOWN;
};

module.exports.typeToString = (type) => {
    return TYPE_VALUE_MAP[type] || 'UNKNOWN';
};