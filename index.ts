import 'react-native-gesture-handler';
import './global.css';
import { registerRootComponent } from 'expo';
import App from './App';
import { startDiagnostics } from './src/services/diagnostics-runtime';
startDiagnostics();
registerRootComponent(App);
