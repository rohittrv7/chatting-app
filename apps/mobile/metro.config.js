const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and workspace directories
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Ensure server root is the app project root so entry-file resolves directly
config.server = {
  ...config.server,
  unstable_serverRoot: projectRoot,
};

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Fallback alias mapping for react-native-webrtc to precompiled entry
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native-webrtc': path.resolve(
    projectRoot,
    'node_modules/react-native-webrtc/lib/commonjs/index.js',
  ),
};

config.resolver.disableHierarchicalLookup = false;

module.exports = config;
