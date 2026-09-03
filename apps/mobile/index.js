import './src/services/safeSecureStore';
import { registerRootComponent } from 'expo';
import { LogBox } from 'react-native';
import App from './App';

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
