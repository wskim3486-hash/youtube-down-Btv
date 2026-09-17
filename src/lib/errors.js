export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST', details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function publicError(error) {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: error.code, message: error.message, details: error.details } };
  }
  console.error(error);
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: '처리 중 오류가 발생했습니다.' } };
}
