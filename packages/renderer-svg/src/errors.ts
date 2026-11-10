export type PlateErrorCode = 'INVALID_VIEW' | 'NO_PRIMARY' | 'INVALID_GEOMETRY' | 'OPEN_MESH';

/** Typed error of the plate renderer. */
export class PlateViewError extends Error {
  readonly code: PlateErrorCode;
  constructor(code: PlateErrorCode, message: string) {
    super(message);
    this.name = 'PlateViewError';
    this.code = code;
  }
}
