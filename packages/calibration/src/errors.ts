export type CalibrationErrorCode = 'NON_FINITE' | 'POINT_OUT_OF_RANGE' | 'BAD_TABLE' | 'MISSING_MEASURE';

export class CalibrationError extends Error {
  override readonly name = 'CalibrationError';
  readonly code: CalibrationErrorCode;
  constructor(code: CalibrationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
