// Built-in CH2K8 roster/schema findings for Roster Studio.
// Offsets are raw ROST payload offsets unless marked team-relative.

const TEAM_TABLE = {
  rawStart: 0x001D85E0,
  userdataStart: 0x001D85E4,
  rowSize: 0x2C0,
  count: 443
};

const PLAYER_TABLE = {
  rawStart: 0x000271AC,
  rowSize: 308,
  count: 5685
};

const COACH_TABLE = {
  rawStart: 0x0023F78C,
  rowSize: 44,
  count: 1373
};

const CONFERENCE_TABLE = {
  rawStart: 0x00345978,
  userdataStart: 0x0034597C,
  rowSize: 0xB94,
  count: 39,
  fields: {
    name: { offset: 0x00, type: 'relativeUtf16LeString' },
    abbreviation: { offset: 0x04, type: 'relativeUtf16LeString' },
    type: { offset: 0x0A, type: 'u16be' },
    sortOrder: { offset: 0x0C, type: 'u16be' },
    founded: { offset: 0x0E, type: 'u16be' },
    champsOrder: { offset: 0x10, type: 'u16be' },
    finalFours: { offset: 0x12, type: 'u16be' },
    previousYearBids: { offset: 0x14, type: 'u16be' },
    rank: { offset: 0x16, type: 'u16be' },
    lastChampOrder: { offset: 0x18, type: 'u16be' },
    presentationId: { offset: 0x1A, type: 'u16be' },
    tournamentSlots: { offset: 0x1C, type: 'u16be' },
    tournamentDay: { offset: 0x1E, type: 'u16be' },
    colorR: { offset: 0x20, type: 'u8' },
    colorG: { offset: 0x21, type: 'u8' },
    colorB: { offset: 0x22, type: 'u8' }
  }
};

const TEAM_FIELDS = {
  school: {
    schoolNameShort: { offset: 0x30, type: 'relativeUtf16LeString', label: 'School Name / short display', maxChars: 16, confidence: 'confirmed' },
    abbreviation: { offset: 0x34, type: 'relativeUtf16LeString', label: 'Abbreviation', confidence: 'confirmed' },
    schoolNameFull: { offset: 0x38, type: 'relativeUtf16LeString', label: 'School Name / full duplicate', maxChars: 16, confidence: 'confirmed' },
    nickname: { offset: 0x3C, type: 'relativeUtf16LeString', label: 'Nickname / mascot plural', maxChars: 16, confidence: 'confirmed' },
    mascotNameText: { offset: 0x40, type: 'relativeUtf16LeString', label: 'Mascot display text', confidence: 'confirmed' },
    city: { offset: null, type: 'unknown', label: 'City', confidence: 'visible UI field; storage not confirmed' },
    state: { offset: null, type: 'unknown', label: 'State', confidence: 'visible UI field; storage not confirmed' },
    logoDesign: { offset: null, type: 'lockedForRealTeams', label: 'Logo Design', confidence: 'N/A locked for default real teams' }
  },
  spirit: {
    mascotText: { offset: 0x40, type: 'relativeUtf16LeString', label: 'Mascot display text', confidence: 'confirmed' },
    mascotModelCandidate: { offset: 0x190, type: 'u32be', label: 'Mascot model / asset candidate', confidence: 'strong candidate' },
    fightSong: { offset: null, type: 'unknown', label: 'Fight Song', confidence: 'visible UI field; storage not confirmed' },
    rival1: { offset: 0x4C, type: 'relativeTeamPointer', label: 'Rival #1', confidence: 'confirmed' },
    rival2: { offset: 0x50, type: 'relativeTeamPointer', label: 'Rival #2', confidence: 'confirmed' },
    rival3: { offset: 0x54, type: 'relativeTeamPointer', label: 'Rival #3', confidence: 'confirmed' },
    rival4: { offset: 0x58, type: 'relativeTeamPointerOrZero', label: 'Rival #4', confidence: 'strong by UI/order' },
    rival5: { offset: 0x5C, type: 'relativeTeamPointerOrZero', label: 'Rival #5', confidence: 'strong by UI/order' },
    headCoach: { offset: 0x60, type: 'relativeCoachPointer', label: 'Head Coach', confidence: 'confirmed' },
    assistantCoach1: { offset: 0x64, type: 'relativeCoachPointer', label: 'Assistant Coach 1', confidence: 'confirmed' },
    assistantCoach2: { offset: 0x68, type: 'relativeCoachPointer', label: 'Assistant Coach 2', confidence: 'confirmed' },
    studentSection: { offset: 0x198, type: 'relativeUtf16LeString', label: 'Student Section', confidence: 'confirmed' },
    midnightMadness: { offset: 0x19C, type: 'relativeUtf16LeString', label: 'Mid. Madness / preseason event', confidence: 'confirmed' }
  },
  roster: {
    rosterSlots: { offsetStart: 0x6C, count: 16, stride: 4, type: 'relativePlayerPointerPlus0x11', label: 'Roster slot', confidence: 'confirmed' },
    rotationSlots: { offsetStart: 0xB4, count: 9, stride: 4, type: 'relativePlayerPointerPlus0x11', label: 'Depth chart / rotation slot', confidence: 'confirmed' }
  },
  assets: {
    assetWordA: { offset: 0x18C, type: 'u16 assetId + u16 teamIndexCheck', confidence: 'confirmed' },
    mascotOrAssetWord: { offset: 0x190, type: 'u16 assetId repeat + u16 mascotIdCandidate', confidence: 'strong' },
    assetWordB: { offset: 0x194, type: 'u16 assetId repeat + u16 zero', confidence: 'confirmed' }
  },
  colorsAndMaterials: {
    start: 0x1A0,
    end: 0x218,
    count: 31,
    stride: 4,
    type: 'rgb32',
    storage: 'RRGGBBFF',
    confidence: 'confirmed color/material block; exact floor/basket/cheer labels still research',
    tabsUsingThisBlock: ['School Primary/Secondary', 'Floor colors', 'Basket colors', 'Cheerleader colors']
  },
  unknownPreserve: {
    editedTeamFlagCandidate: { offset: 0x188, type: 'u32be', label: 'Unknown edited-team flag/check', confidence: 'preserve' }
  }
};

const EDIT_SCHOOL_TABS = {
  school: ['School Name', 'Nickname', 'Abbreviation', 'City', 'State', 'Primary', 'Secondary', 'Logo Design'],
  spirit: ['Mascot', 'Fight Song', 'Rival #1', 'Rival #2', 'Rival #3', 'Rival #4', 'Rival #5', 'Mid. Madness', 'Student Section'],
  floor: ['Basketball Logo', 'Volleyball Lines', 'Key Circle Outer', '3Pt Line', 'Key', 'Key Line', 'Center Line', 'Outer Line', 'Skirt Inner', 'Skirt Outer', 'Lane Right', 'Lane Left', 'Key Hash', 'Center Circle', 'Top Key Right', 'Top Key Left'],
  basket: ['Basket', 'Basket Front', 'Basket Rear', 'Basket Metal'],
  coach: ['First Name', 'Last Name', 'Height', 'Skin Color', 'Suits', 'Head'],
  cheerleader: ['Display Model', 'Primary', 'Secondary', 'Tertiary']
};

function teamRowOffset(teamIndex) {
  return TEAM_TABLE.rawStart + (Number(teamIndex) * TEAM_TABLE.rowSize);
}

function teamFieldOffset(teamIndex, fieldOffset) {
  return teamRowOffset(teamIndex) + Number(fieldOffset);
}

function hex(value, width = 8) {
  return '0x' + Number(value).toString(16).toUpperCase().padStart(width, '0');
}

module.exports = {
  TEAM_TABLE,
  PLAYER_TABLE,
  COACH_TABLE,
  CONFERENCE_TABLE,
  TEAM_FIELDS,
  EDIT_SCHOOL_TABS,
  teamRowOffset,
  teamFieldOffset,
  hex
};
