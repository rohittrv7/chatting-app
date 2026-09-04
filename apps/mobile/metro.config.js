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

// 1. Watch all files within the monorepo while preserving default watchFolders
config.watchFolders = [...(config.watchFolders || []), monorepoRoot];

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

const defaultResolveRequest = config.resolver?.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === './apps/mobile/index' ||
    moduleName === 'apps/mobile/index' ||
    moduleName === './apps/mobile/index.js' ||
    moduleName === 'apps/mobile/index.js'
  ) {
    return {
      filePath: path.resolve(projectRoot, 'index.js'),
      type: 'sourceFile',
    };
  }
  if (
    platform === 'web' &&
    (moduleName === 'react-native-webrtc' || moduleName.startsWith('react-native-webrtc/'))
  ) {
    return {
      filePath: path.resolve(projectRoot, 'src/shims/webrtcWebShim.js'),
      type: 'sourceFile',
    };
  }
  if (typeof defaultResolveRequest === 'function') {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
