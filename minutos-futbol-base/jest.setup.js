/**
 * Mocks de las librerías nativas de gestos y animación para Jest. Sin esto,
 * `GestureDetector` y `Animated.View` intentan hablar con módulos nativos que
 * no existen en Node. `setupFiles` se concatena con los del preset jest-expo.
 */
require('react-native-gesture-handler/jestSetup');

// Reanimated 4 arranca react-native-worklets, que en Jest intenta cargar su
// módulo nativo: se mockea primero y Reanimated encima.
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const mock = require('react-native-reanimated/mock');
  // El mock crea un shared value NUEVO en cada render; el real es estable por
  // instancia. Sin esto, todo lo memoizado sobre un shared value (p. ej. el
  // controlador del arrastre) cambia de identidad en cada render solo en Jest.
  const useSharedValue = (init) => {
    const ref = React.useRef(null);
    if (ref.current === null) ref.current = mock.useSharedValue(init);
    return ref.current;
  };
  return { ...mock, useSharedValue, default: { ...mock.default, useSharedValue } };
});

// Sin el mock, SafeAreaProvider no pinta a sus hijos hasta que la vista nativa
// informa de los márgenes, cosa que en Jest nunca ocurre.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
