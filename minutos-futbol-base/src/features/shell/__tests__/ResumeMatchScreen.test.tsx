import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { ResumeMatchScreen } from '../ResumeMatchScreen';

const flat = (style: unknown) => StyleSheet.flatten(style as StyleProp<ViewStyle>);

describe('ResumeMatchScreen (P0)', () => {
  it('muestra rival, parte, reloj y estado, y CONTINUAR mide al menos 56 dp', async () => {
    const onContinue = jest.fn();
    const screen = await render(<ResumeMatchScreen rival="CD Rival" currentPeriod={2} status="PAUSED" clockMs={31 * 60_000 + 12_000} onContinue={onContinue} />);
    expect(screen.getByTestId('resume-match-line')).toHaveTextContent('vs CD Rival · 2ª parte');
    expect(screen.getByTestId('resume-clock-line')).toHaveTextContent('Reloj: 31:12 (en pausa)');
    expect(flat(screen.getByTestId('resume-continue').props.style).minHeight).toBeGreaterThanOrEqual(56);
    await fireEvent.press(screen.getByTestId('resume-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('sin rival dice "Partido" y en el descanso lo indica', async () => {
    const screen = await render(<ResumeMatchScreen rival="" currentPeriod={1} status="HALFTIME" clockMs={25 * 60_000} onContinue={jest.fn()} />);
    expect(screen.getByTestId('resume-match-line')).toHaveTextContent('Partido · 1ª parte');
    expect(screen.getByTestId('resume-clock-line')).toHaveTextContent('Reloj: 25:00 (descanso)');
  });
});
