'use strict';

const COMMON_2K8_NAMED_BANKS = [
    'frontend',
    'frontend_sync',
    'global',
    'gamedata',
    'gamedataextra',
    'loading',
    'legalpage',
    'loc',
    'fonts',
    'online',
    'playercreate',
    'playeditor',
    'teamselectlogo',
    'arenapics',
    'overlaycache',
    'jukebox',
    'roster_english',
    'streetdata',
    'studio',
    'studio_preview',
    'studio_pontiac',
    'dornas',
    'crowd',
    'sfx_inside',
    'facegen',
    'shoe_101_06',
    'shoe_102_04',
    'shoe_500_00'
];

const CHOOPS_NAMED_BANKS = [
    ...COMMON_2K8_NAMED_BANKS,
    'ababall',
    'basket',
    'chantcreate',
    'chantcreate_drums',
    'chantcreate_sounds',
    'gameintro',
    'gameintro_cameras',
    'gameintro_drums',
    'gameintro_playerspeech',
    'halftimeadjustments',
    'legacy',
    'powerbar',
    'reelmanual',
    'weeklyshow',
    'tutorial',
    'drilldata',
    'drillschallenge',
    'drillschallenge_attackbasket',
    'drillschallenge_denyposition',
    'drillschallenge_dribblecourse',
    'drillschallenge_linecourse',
    'drillschallenge_shooting',
    'loading_drillschallenge',
    'shrine',
    'shrine_trophies',
    'statefarm',
    'kellogg',
    'gumbel',
    'Director'
];

const COMMON_NUMBERED_FAMILIES = [
    { prefix: 'ua', digits: 3, max: 999 },
    { prefix: 'uh', digits: 3, max: 999 },
    { prefix: 'ux', digits: 3, max: 999 },
    { prefix: 'selua', digits: 3, max: 999 },
    { prefix: 'seluh', digits: 3, max: 999 },
    { prefix: 'selux', digits: 3, max: 999 },
    { prefix: 's', digits: 3, max: 999 },
    { prefix: 'm', digits: 3, max: 999 },
    { prefix: 'p', digits: 3, max: 999 },
    { prefix: 'h', digits: 4, max: 9999 },
    { prefix: 'coach', digits: 3, max: 999 }
];

const COMMON_EXTENSIONS = ['.iff', '.cdf', '.bin'];

const TOC_LAYOUTS = {
    standard2k8WithZero: {
        nameHash: { offset: 0, size: 4 },
        rawOffset: { offset: 4, size: 4 },
        zero: { offset: 8, size: 4 },
        size: { offset: 12, size: 4 }
    },
    standard2k8NoZeroSize12: {
        nameHash: { offset: 0, size: 4 },
        rawOffset: { offset: 4, size: 4 },
        size: { offset: 12, size: 4 }
    },
    standard2k8NoZeroSize8: {
        nameHash: { offset: 0, size: 4 },
        rawOffset: { offset: 4, size: 4 },
        size: { offset: 8, size: 4 }
    },
    nba2k9: {
        zero: { offset: 0, size: 4 },
        size: { offset: 4, size: 4 },
        nameHash: { offset: 8, size: 4 },
        rawOffset: { offset: 12, size: 4 }
    }
};

const PROFILE_DEFINITIONS = {
    default: {
        id: 'default',
        displayName: 'Default 2K archive profile',
        cacheName: 'default.cache',
        archiveTocLayout: 'standard2k8WithZero',
        generatedNameFamilies: COMMON_NUMBERED_FAMILIES,
        generatedNamedBanks: COMMON_2K8_NAMED_BANKS,
        generatedExtensions: COMMON_EXTENSIONS,
        aliases: []
    },
    choops2k8: {
        id: 'choops2k8',
        displayName: 'College Hoops 2K8 PS3',
        cacheName: 'choops2k8.cache',
        archiveTocLayout: 'standard2k8WithZero',
        generatedNameFamilies: COMMON_NUMBERED_FAMILIES,
        generatedNamedBanks: CHOOPS_NAMED_BANKS,
        generatedExtensions: COMMON_EXTENSIONS,
        aliases: ['collegehoops2k8', 'ch2k8', 'choops']
    },
    nba2k8: {
        id: 'nba2k8',
        displayName: 'NBA 2K8 PS3',
        cacheName: 'nba2k8.cache',
        archiveTocLayout: 'standard2k8NoZeroSize12',
        generatedNameFamilies: COMMON_NUMBERED_FAMILIES,
        generatedNamedBanks: COMMON_2K8_NAMED_BANKS,
        generatedExtensions: COMMON_EXTENSIONS,
        aliases: ['nba08', 'nba-2k8']
    },
    apf2k8: {
        id: 'apf2k8',
        displayName: 'All-Pro Football 2K8 PS3',
        cacheName: 'apf2k8.cache',
        archiveTocLayout: 'standard2k8NoZeroSize8',
        generatedNameFamilies: COMMON_NUMBERED_FAMILIES,
        generatedNamedBanks: COMMON_2K8_NAMED_BANKS,
        generatedExtensions: COMMON_EXTENSIONS,
        aliases: ['allprofootball2k8', 'apf08']
    },
    nhl2k8: {
        id: 'nhl2k8',
        displayName: 'NHL 2K8 PS3',
        cacheName: 'nhl2k8.cache',
        archiveTocLayout: 'standard2k8NoZeroSize12',
        generatedNameFamilies: COMMON_NUMBERED_FAMILIES,
        generatedNamedBanks: COMMON_2K8_NAMED_BANKS,
        generatedExtensions: COMMON_EXTENSIONS,
        aliases: ['nhl08', 'nhl-2k8']
    },
    mlb2k8: {
        id: 'mlb2k8',
        displayName: 'MLB 2K8 PS3',
        cacheName: 'mlb2k8.cache',
        archiveTocLayout: 'standard2k8NoZeroSize12',
        generatedNameFamilies: COMMON_NUMBERED_FAMILIES,
        generatedNamedBanks: COMMON_2K8_NAMED_BANKS,
        generatedExtensions: COMMON_EXTENSIONS,
        aliases: ['mlb08', 'mlb-2k8']
    },
    nba2k9: {
        id: 'nba2k9',
        displayName: 'NBA 2K9 PS3',
        cacheName: 'nba2k9.cache',
        archiveTocLayout: 'nba2k9',
        generatedNameFamilies: COMMON_NUMBERED_FAMILIES,
        generatedNamedBanks: COMMON_2K8_NAMED_BANKS,
        generatedExtensions: COMMON_EXTENSIONS,
        aliases: ['nba09', 'nba-2k9']
    }
};

function normalizeGameName(gameName) {
    return String(gameName || 'default').replace(/[\s_-]+/g, '').toLowerCase();
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getProfile(gameName) {
    const normalized = normalizeGameName(gameName);

    for (const profile of Object.values(PROFILE_DEFINITIONS)) {
        const ids = [profile.id, ...(profile.aliases || [])].map(normalizeGameName);
        if (ids.includes(normalized)) {
            return {
                ...clone(profile),
                toc: clone(TOC_LAYOUTS[profile.archiveTocLayout] || TOC_LAYOUTS.standard2k8WithZero)
            };
        }
    }

    return {
        ...clone(PROFILE_DEFINITIONS.default),
        id: normalized || 'default',
        cacheName: `${normalized || 'default'}.cache`,
        toc: clone(TOC_LAYOUTS.standard2k8WithZero)
    };
}

function getSupportedGameNames() {
    return Object.keys(PROFILE_DEFINITIONS).filter((key) => key !== 'default');
}

function addNameVariants(candidates, baseName, extensions) {
    candidates.add(baseName);

    for (const extension of extensions || COMMON_EXTENSIONS) {
        candidates.add(`${baseName}${extension}`);
    }
}

function generateCandidateNames(gameName) {
    const profile = getProfile(gameName);
    const candidates = new Set();
    const extensions = profile.generatedExtensions || COMMON_EXTENSIONS;

    for (const family of profile.generatedNameFamilies || []) {
        const min = Number.isInteger(family.min) ? family.min : 0;
        const max = Number.isInteger(family.max) ? family.max : 999;
        const digits = Number.isInteger(family.digits) ? family.digits : 3;

        for (let i = min; i <= max; i++) {
            addNameVariants(candidates, `${family.prefix}${i.toString().padStart(digits, '0')}`, extensions);
        }
    }

    for (const bankName of profile.generatedNamedBanks || []) {
        addNameVariants(candidates, bankName, extensions);
    }

    return [...candidates];
}

module.exports = {
    TOC_LAYOUTS,
    PROFILE_DEFINITIONS,
    getProfile,
    getSupportedGameNames,
    generateCandidateNames,
    normalizeGameName
};