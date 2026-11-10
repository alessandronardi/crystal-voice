// Typed input errors of the showcase renderer (AGENTS.md §9: no free strings).

export type RenderInputErrorCode =
  | 'MALFORMED_BODY'
  | 'FACE_INDEX_OUT_OF_RANGE'
  | 'VERTEX_INDEX_OUT_OF_RANGE'
  | 'ZERO_FACE_NORMAL'
  | 'NON_FINITE'
  | 'MALFORMED_TRANSFORM'
  | 'BUDGET_EXCEEDED';

export class RenderInputError extends Error {
  readonly code: RenderInputErrorCode;

  constructor(code: RenderInputErrorCode, message: string) {
    super(message);
    this.name = 'RenderInputError';
    this.code = code;
  }
}
