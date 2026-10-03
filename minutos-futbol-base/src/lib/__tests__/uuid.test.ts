import { _resetUuidv7StateForTests, isUuid, uuidv7, uuidv7Timestamp } from '../uuid';

describe('uuidv7', () => {
  beforeEach(() => _resetUuidv7StateForTests());

  it('genera UUID válidos de versión 7', () => {
    const id = uuidv7(1_700_000_000_000);
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('codifica el timestamp', () => {
    expect(uuidv7Timestamp(uuidv7(1_700_000_000_123))).toBe(1_700_000_000_123);
  });

  it('es monótono dentro del mismo milisegundo y con el reloj hacia atrás', () => {
    const ids = [uuidv7(1000), uuidv7(1000), uuidv7(999), uuidv7(1000), uuidv7(1001)];
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no repite ids en una ráfaga', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => uuidv7(42)));
    expect(ids.size).toBe(5000);
  });

  it('isUuid rechaza cadenas inválidas', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(uuidv7Timestamp('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});
