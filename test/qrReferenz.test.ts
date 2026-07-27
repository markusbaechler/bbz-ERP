import { describe, it, expect } from 'vitest';
import { qrReferenzRoh, qrReferenzFormatiert } from '../src/domain/qrReferenz';

describe('QRR-Referenz (Golden gegen echten Beleg 33214)', () => {
  it('reproduziert die echte Referenz', () => {
    expect(qrReferenzRoh(33214)).toBe('761040000000000000000332141');
    expect(qrReferenzFormatiert(33214)).toBe('76 10400 00000 00000 00003 32141');
  });
  it('ist 27-stellig', () => {
    expect(qrReferenzRoh(1)).toHaveLength(27);
  });
});
