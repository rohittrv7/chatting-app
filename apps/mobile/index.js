// Polyfills MUST be the very first import to intercept TextDecoder before any native/Emscripten modules load
import './src/polyfills';

import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';
import { enableScreens } from 'react-native-screens';

// Ensure native fragment screens are safely initialized for Android
try {
  enableScreens(true);
} catch (_) {}

import App from './App';

// Prevent unhandled JavaScript exceptions from hard-killing the Android Activity
if (typeof global !== 'undefined' && global.ErrorUtils) {
  const defaultHandler = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.warn('⚠️ [Global Catch] Intercepted runtime error, preventing hard crash:', error);
    if (defaultHandler) {
      defaultHandler(error, false);
    }
  });
}

// Suppress benign Expo Go & third-party deprecation notices
LogBox.ignoreLogs([
  '[expo-av]: Expo AV has been deprecated',
  'Expo AV has been deprecated and will be removed in SDK 54',
  'Due to changes in Androids permission requirements',
  'Expo Go can no longer provide full access to the media library',
]);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
