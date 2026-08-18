export const OBJECTIONABLE_CONTENT_MESSAGE: string;
export class ObjectionableContentError extends Error {}
export function containsClearlyObjectionableContent(value: unknown): boolean;
export function assertAllowedUserGeneratedText(value: unknown): void;
