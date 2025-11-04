const envPaths = require('env-paths');
const mkdir = require('make-dir');

module.exports.getEnvPath = async () => {
    const paths = envPaths('2k-tools');
    await Promise.all([
        mkdir(paths.config),
        mkdir(paths.data),
        mkdir(paths.temp)
    ]);
    return paths;
};

// module.exports = { getEnvPath }; // Not sure this is necessary, but I'll keep it here anyway just in case
