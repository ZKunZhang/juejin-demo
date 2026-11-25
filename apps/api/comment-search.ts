export const commentSearchSchema = { type: 'string', maxLength: 100 };

export function commentSearch(value: string | undefined) {
  const word = value?.trim();
  if (!word) return undefined;
  const id = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(word) ? word : undefined;
  const text = { contains: word.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } as const;
  return { text, id };
}
