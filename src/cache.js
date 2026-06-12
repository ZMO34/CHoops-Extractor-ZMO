const ChoopsController = require('../2k-tools/src/controller/ChoopsController');

module.exports = async (pathToGameFiles, options = {}) => {
    const controller = new ChoopsController(pathToGameFiles, options.gameName);
    await controller.read({
        buildCache: true
    });
};
