const path = require('node:path');
const { tests } = require('@iobroker/testing');

// Validate io-package.json and package.json against what the ioBroker repository requires
tests.packageFiles(path.join(__dirname, '..'));
