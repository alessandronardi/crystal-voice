export type DspInputErrorCode = 'NON_FINITE_INPUT' | 'BAD_SAMPLE_RATE' | 'BAD_PROBABILITY';

export class DspInputError extends Error {
  override readonly name = 'DspInputError';
  readonly code: DspInputErrorCode;
  constructor(code: DspInputErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
