// Test-only mirror of the enforced JSON Schema subset that
// @deepseek-ai/dsh-tools applies to tool parameters and canonical outputs
// (documented in its src/json-schema.ts). It exists because the bundle cannot
// import a Harness package at test time; the rules implemented here are the
// subset's rules, not a general JSON Schema implementation.

const CONSTRAINT_KEYWORDS = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
]);
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);
const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const ONE_OF_SIBLINGS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const'];
const ALLOWED_FOR = {
  properties: ['object'],
  required: ['object'],
  additionalProperties: ['object'],
  items: ['array'],
  enum: ['string', 'number', 'integer', 'boolean', 'null'],
  const: ['string', 'number', 'integer', 'boolean', 'null'],
};

function isPlainRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function scalarMatches(type, value) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return false;
}

export function schemaViolations(schema, { objectRoot = false } = {}) {
  const violations = [];
  const walk = (node, path) => {
    if (!isPlainRecord(node)) {
      violations.push(`${path} must be a schema object`);
      return;
    }
    for (const key of Object.keys(node)) {
      if (!CONSTRAINT_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) {
        violations.push(`${path}.${key} is not a supported keyword`);
      }
    }
    for (const key of ['description', 'title']) {
      if (key in node && typeof node[key] !== 'string') violations.push(`${path}.${key} must be a string`);
    }
    const hasType = Object.hasOwn(node, 'type');
    const hasOneOf = Object.hasOwn(node, 'oneOf');
    if (hasType && hasOneOf) violations.push(`${path} cannot declare both type and oneOf`);
    if (!hasType && !hasOneOf) {
      for (const key of ONE_OF_SIBLINGS) {
        if (Object.hasOwn(node, key)) violations.push(`${path}.${key} requires type or oneOf`);
      }
      return;
    }
    if (hasOneOf) {
      if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
        violations.push(`${path}.oneOf must have at least two schemas`);
      } else {
        for (let index = 0; index < node.oneOf.length; index++) walk(node.oneOf[index], `${path}.oneOf[${index}]`);
      }
      for (const key of ONE_OF_SIBLINGS) {
        if (Object.hasOwn(node, key)) violations.push(`${path}.${key} is not supported beside oneOf`);
      }
      return;
    }
    const type = node.type;
    if (!TYPES.includes(type)) {
      violations.push(`${path}.type must be one of ${TYPES.join('/')}`);
      return;
    }
    for (const [key, types] of Object.entries(ALLOWED_FOR)) {
      if (Object.hasOwn(node, key) && !types.includes(type)) {
        violations.push(`${path}.${key} is not supported on type "${type}"`);
      }
    }
    if (type === 'object') {
      if (Object.hasOwn(node, 'properties')) {
        if (!isPlainRecord(node.properties)) {
          violations.push(`${path}.properties must be an object of schemas`);
        } else {
          for (const [key, child] of Object.entries(node.properties)) {
            walk(child, `${path}.properties.${key}`);
          }
        }
      }
      if (Object.hasOwn(node, 'required')) {
        if (!Array.isArray(node.required) || node.required.some((entry) => typeof entry !== 'string')) {
          violations.push(`${path}.required must be an array of strings`);
        } else {
          const declared = isPlainRecord(node.properties) ? node.properties : {};
          for (const key of node.required) {
            if (!Object.hasOwn(declared, key)) violations.push(`${path}.required names "${key}" which is not in properties`);
          }
        }
      }
      if (Object.hasOwn(node, 'additionalProperties') && typeof node.additionalProperties !== 'boolean') {
        violations.push(`${path}.additionalProperties must be a boolean`);
      }
    }
    if (type === 'array' && Object.hasOwn(node, 'items')) walk(node.items, `${path}.items`);
    if (['string', 'number', 'integer', 'boolean', 'null'].includes(type)) {
      if (Object.hasOwn(node, 'enum')) {
        if (!Array.isArray(node.enum) || node.enum.length === 0 || !node.enum.every((entry) => scalarMatches(type, entry))) {
          violations.push(`${path}.enum must be a non-empty array of ${type} values`);
        }
      }
      if (Object.hasOwn(node, 'const') && !scalarMatches(type, node.const)) {
        violations.push(`${path}.const must be a ${type} value`);
      }
    }
  };
  walk(schema, 'schema');
  if (objectRoot && (!isPlainRecord(schema) || schema.type !== 'object')) {
    violations.push('schema.type must be "object"');
  }
  return violations;
}

export function valueViolations(schema, value, path = 'value') {
  if (!isPlainRecord(schema)) return [`${path}: schema is not an object`];
  if (Object.hasOwn(schema, 'oneOf')) {
    const matched = schema.oneOf.filter((branch) => valueViolations(branch, value, path).length === 0).length;
    return matched === 1 ? [] : [`${path} must match exactly one oneOf branch (matched ${matched})`];
  }
  const type = schema.type;
  if (type === undefined) return [];
  if (type === 'object') {
    if (!isPlainRecord(value)) return [`${path} must be an object`];
    const violations = [];
    for (const key of schema.required || []) {
      if (value[key] === undefined) violations.push(`missing required property "${path}.${key}"`);
    }
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(properties)) {
      if (value[key] === undefined) continue;
      violations.push(...valueViolations(child, value[key], `${path}.${key}`));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) violations.push(`"${path}.${key}" is not a declared property`);
      }
    }
    return violations;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    if (!schema.items) return [];
    return value.flatMap((entry, index) => valueViolations(schema.items, entry, `${path}[${index}]`));
  }
  if (!scalarMatches(type, value)) return [`${path} must be a ${type}`];
  const violations = [];
  if (schema.enum && !schema.enum.includes(value)) violations.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
  if (Object.hasOwn(schema, 'const') && value !== schema.const) violations.push(`${path} must be ${JSON.stringify(schema.const)}`);
  return violations;
}
