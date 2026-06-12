const gameProfiles = require('./gameProfiles');

const archiveConfig = {};

for (const gameName of ['default', ...gameProfiles.getSupportedGameNames()]) {
    archiveConfig[gameName] = {
        toc: gameProfiles.getProfile(gameName).toc
    };
}

module.exports = archiveConfig;
