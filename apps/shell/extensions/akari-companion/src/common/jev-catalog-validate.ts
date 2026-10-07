export type JevValueSchema = {
    type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array' | ('number' | 'string' | 'boolean')[];
    enum?: (string | number | boolean)[];
    items?: JevValueSchema;
    maxItems?: number;
    maxLength?: number;
    minimum?: number;
    exclusiveMinimum?: number;
    required?: string[];
    properties?: Record<string, JevValueSchema>;
    additionalProperties?: false;
};

export function validateValue(schema: JevValueSchema, value: unknown): boolean {
    if (!schema || typeof schema !== 'object') return false;
    if (schema.enum && !schema.enum.includes(value as never)) return false;
    if (Array.isArray(schema.type)) return schema.type.some(type => validateValue({ ...schema, type }, value));
    switch (schema.type) {
        case 'string': return typeof value === 'string' && (schema.maxLength === undefined || value.length <= schema.maxLength);
        case 'number':
        case 'integer': return typeof value === 'number' && Number.isFinite(value)
            && (schema.type !== 'integer' || Number.isInteger(value))
            && (schema.minimum === undefined || value >= schema.minimum)
            && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum);
        case 'boolean': return typeof value === 'boolean';
        case 'array': return Array.isArray(value) && (schema.maxItems === undefined || value.length <= schema.maxItems)
            && (!schema.items || value.every(item => validateValue(schema.items as JevValueSchema, item)));
        case 'object': {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            const props = schema.properties ?? {};
            if ((schema.required ?? []).some(key => !Object.prototype.hasOwnProperty.call(value, key))) return false;
            return Object.entries(value).every(([key, item]) =>
                Object.prototype.hasOwnProperty.call(props, key) ? validateValue(props[key], item) : schema.additionalProperties !== false);
        }
        default: return false;
    }
}
