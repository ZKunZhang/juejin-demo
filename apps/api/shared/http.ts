import { ApiError } from './security';

export const uuid = { type: 'string', format: 'uuid' };
export const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
export const versionSchema = { type: 'integer', minimum: 1 };
export const conflict = () => new ApiError(409,'STATE_CONFLICT','状态已变化，请刷新后重试');
export const missing = () => new ApiError(404,'NOT_FOUND','内容不存在');
