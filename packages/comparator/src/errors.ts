export type ComparatorErrorCode =
  | 'BAD_TABLE'
  | 'INVALID_SEED'
  | 'INVALID_WEIGHTS'
  | 'INCOMPATIBLE_MAPPING_VERSION'
  | 'INCOMPATIBLE_EXTRACTOR_VERSION';

export class ComparatorError extends Error {
  override readonly name = 'ComparatorError';
  readonly code: ComparatorErrorCode;

  constructor(code: ComparatorErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
