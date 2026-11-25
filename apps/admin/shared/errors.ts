export const errors=(error:unknown)=>error instanceof Error?error.message:'处理失败，请重试';
