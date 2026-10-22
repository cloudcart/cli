import { Command, Flags } from '@oclif/core';
import { writeFile } from 'node:fs/promises';
import { buildClientSchema, printSchema, type IntrospectionQuery } from 'graphql';
import {
  getSession,
  createGraphQLClient,
  logger,
  colors,
  toStructuredError,
} from '@cloudcart/cli-kit';
import { readAdminSchema } from '../../lib/admin-schema.js';

interface TypeRef {
  kind: string;
  name: string | null;
  ofType?: TypeRef | null;
}

interface ArgInfo {
  name: string;
  description?: string;
  defaultValue?: string | null;
  type: TypeRef;
}

interface FieldInfo {
  name: string;
  description?: string;
  isDeprecated?: boolean;
  deprecationReason?: string;
  type: TypeRef;
  args?: ArgInfo[];
}

interface EnumValue {
  name: string;
  description?: string;
  isDeprecated?: boolean;
  deprecationReason?: string;
}

interface FullType {
  kind: string;
  name: string;
  description?: string;
  fields?: FieldInfo[] | null;
  inputFields?: ArgInfo[] | null;
  enumValues?: EnumValue[] | null;
  interfaces?: TypeRef[] | null;
  possibleTypes?: TypeRef[] | null;
}

interface SchemaData {
  queryType: { name: string } | null;
  mutationType: { name: string } | null;
  subscriptionType: { name: string } | null;
  types: FullType[];
}

export default class AppSchema extends Command {
  static override description = 'Fetch the Admin API GraphQL schema (introspection)';

  static override examples = [
    '<%= config.bin %> app schema --compact',
    '<%= config.bin %> app schema --search product --compact',
    '<%= config.bin %> app schema --search "createProduct" --compact',
    '<%= config.bin %> app schema --output schema.graphql --compact',
    '<%= config.bin %> app schema --mutations-only --compact',
    '<%= config.bin %> app schema --queries-only --compact',
    '<%= config.bin %> app schema --types-only',
  ];

  static override flags = {
    store: Flags.string({
      char: 's',
      description: 'Store URL to fetch schema from',
    }),
    output: Flags.string({
      char: 'o',
      description: 'Write schema to a file instead of stdout: a .graphql or .gql file gets the SDL, any other the JSON, unless --compact or --json says',
    }),
    compact: Flags.boolean({
      char: 'c',
      description: 'Output compact SDL format (optimized for LLMs)',
      default: false,
    }),
    search: Flags.string({
      description: 'Filter types/fields matching a search term (case-insensitive)',
    }),
    'mutations-only': Flags.boolean({
      description: 'Show only the Mutation type and its input types',
      default: false,
    }),
    'queries-only': Flags.boolean({
      description: 'Show only the Query type and its return types',
      default: false,
    }),
    'types-only': Flags.boolean({
      description: 'Only show type names grouped by kind (compact overview)',
      default: false,
    }),
    json: Flags.boolean({
      description: 'Output raw JSON introspection (the default, except for a .graphql or .gql file)',
      default: false,
    }),
    refresh: Flags.boolean({
      description: 'Read the schema from the store again instead of the copy kept for an hour',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppSchema);
    const jsonMode = flags.json;
    const quiet = jsonMode || flags.compact;

    try {
      const session = await getSession({ storeUrl: flags.store, autoPrompt: !quiet });
      const { introspection, fromCache, fetchedAt } = await readAdminSchema(
        session.storeUrl,
        createGraphQLClient(session),
        { refresh: flags.refresh },
      );

      if (!quiet) {
        const minutes = Math.floor((Date.now() - fetchedAt.getTime()) / 60_000);
        logger.info(colors.dim(fromCache
          ? `The schema of ${session.storeUrl} kept ${minutes} min ago (--refresh reads it again)`
          : `Read the schema from ${session.storeUrl}`));
      }

      const schema = introspection.__schema as unknown as SchemaData;

      // Apply filters
      let filteredSchema = schema;

      if (flags.search) {
        filteredSchema = this.filterBySearch(schema, flags.search);
      } else if (flags['mutations-only']) {
        filteredSchema = this.filterMutations(schema);
      } else if (flags['queries-only']) {
        filteredSchema = this.filterQueries(schema);
      }

      if (flags['types-only']) {
        this.printTypeSummary(filteredSchema);
        return;
      }

      const output = {
        compact: () => this.toCompactSDL(filteredSchema),
        sdl: () => printSchema(buildClientSchema({ __schema: filteredSchema } as unknown as IntrospectionQuery)),
        json: () => JSON.stringify({ __schema: filteredSchema }, null, 2),
      }[this.format(flags)]();

      if (flags.output) {
        await writeFile(flags.output, output, 'utf-8');
        const userTypes = filteredSchema.types.filter(t => !t.name.startsWith('__'));
        logger.success(`Schema written to ${flags.output} (${(output.length / 1024).toFixed(0)} KB, ${userTypes.length} types)`);
      } else {
        console.log(output);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('EEXIT')) throw error;
      if (jsonMode) {
        console.log(JSON.stringify({ data: null, errors: [toStructuredError(error)] }));
      } else if (error instanceof Error) {
        logger.error(error.message);
      }
      // The error's class names the exit code: 4 a refused token, 6 rate limited, 7 the network (B-487).
      this.exit(toStructuredError(error).exitCode);
    }
  }

  /** Filter schema to types whose name matches the search term, plus their direct dependencies */
  private filterBySearch(schema: SchemaData, search: string): SchemaData {
    const term = search.toLowerCase();
    const matchedTypeNames = new Set<string>();
    const userTypes = schema.types.filter(t => !t.name.startsWith('__'));

    // Pass 1: find types whose NAME matches the search term
    for (const type of userTypes) {
      if (type.name.toLowerCase().includes(term)) {
        matchedTypeNames.add(type.name);
      }
    }

    // Also include Query/Mutation fields that match the search term
    for (const rootName of [schema.queryType?.name, schema.mutationType?.name]) {
      if (!rootName) continue;
      const rootType = userTypes.find(t => t.name === rootName);
      if (!rootType?.fields) continue;
      for (const field of rootType.fields) {
        if (field.name.toLowerCase().includes(term)) {
          // Add a synthetic marker so we include this root type
          matchedTypeNames.add(rootName);
          // Add the return type and arg types of matching root fields
          const retType = this.extractTypeName(field.type);
          if (retType) matchedTypeNames.add(retType);
          for (const arg of field.args ?? []) {
            const argType = this.extractTypeName(arg.type);
            if (argType) matchedTypeNames.add(argType);
          }
        }
      }
    }

    // Pass 2: for matched INPUT types only, pull in their field types
    // (so the AI knows what fields an input expects)
    for (const typeName of [...matchedTypeNames]) {
      const type = userTypes.find(t => t.name === typeName);
      if (!type || type.kind !== 'INPUT_OBJECT') continue;
      for (const field of type.inputFields ?? []) {
        const refName = this.extractTypeName(field.type);
        if (refName) matchedTypeNames.add(refName);
      }
    }

    const builtinScalars = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
    const filteredTypes = schema.types.filter(t =>
      matchedTypeNames.has(t.name) && !builtinScalars.has(t.name),
    );

    // If root types were included, only keep matching fields
    const result = filteredTypes.map(t => {
      if (t.name === schema.queryType?.name || t.name === schema.mutationType?.name) {
        return {
          ...t,
          fields: t.fields?.filter(f => f.name.toLowerCase().includes(term)) ?? null,
        };
      }
      return t;
    });

    return { ...schema, types: result };
  }

  /** Filter to only Mutation type + its input types */
  private filterMutations(schema: SchemaData): SchemaData {
    const mutationType = schema.types.find(t => t.name === schema.mutationType?.name);
    if (!mutationType) return { ...schema, types: [] };

    const needed = new Set<string>([mutationType.name]);
    for (const field of mutationType.fields ?? []) {
      const retType = this.extractTypeName(field.type);
      if (retType) needed.add(retType);
      for (const arg of field.args ?? []) {
        const argType = this.extractTypeName(arg.type);
        if (argType) needed.add(argType);
      }
    }

    // Recursively collect input types 1 more level
    for (const typeName of [...needed]) {
      const type = schema.types.find(t => t.name === typeName);
      if (!type) continue;
      for (const field of type.inputFields ?? []) {
        const refName = this.extractTypeName(field.type);
        if (refName) needed.add(refName);
      }
    }

    const builtinScalars = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
    return {
      ...schema,
      types: schema.types.filter(t => needed.has(t.name) && !builtinScalars.has(t.name)),
    };
  }

  /** Filter to only Query type + its return types */
  private filterQueries(schema: SchemaData): SchemaData {
    const queryType = schema.types.find(t => t.name === schema.queryType?.name);
    if (!queryType) return { ...schema, types: [] };

    const needed = new Set<string>([queryType.name]);
    for (const field of queryType.fields ?? []) {
      const retType = this.extractTypeName(field.type);
      if (retType) needed.add(retType);
      for (const arg of field.args ?? []) {
        const argType = this.extractTypeName(arg.type);
        if (argType) needed.add(argType);
      }
    }

    const builtinScalars = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
    return {
      ...schema,
      types: schema.types.filter(t => needed.has(t.name) && !builtinScalars.has(t.name)),
    };
  }

  private extractTypeName(ref: TypeRef | null | undefined): string | null {
    if (!ref) return null;
    if (ref.name) return ref.name;
    return this.extractTypeName(ref.ofType);
  }

  /**
   * JSON unless a flag says otherwise; a .graphql or .gql file gets the SDL, which is what such a file holds
   * (B-506). A filtered schema lacks the types its fields point to, so it is SDL-like only: the compact form.
   */
  format(flags: { json: boolean; compact: boolean; output?: string; search?: string; 'mutations-only': boolean; 'queries-only': boolean }): 'json' | 'compact' | 'sdl' {
    if (flags.json) return 'json';
    if (flags.compact) return 'compact';
    if (!flags.output || !/\.(graphql|gql)$/i.test(flags.output)) return 'json';
    return flags.search || flags['mutations-only'] || flags['queries-only'] ? 'compact' : 'sdl';
  }

  /** Convert introspection JSON to compact SDL-like format optimized for LLM consumption */
  private toCompactSDL(schema: SchemaData): string {
    const lines: string[] = [];
    const types = schema.types.filter(t => !t.name.startsWith('__'));

    // Header
    if (schema.queryType) lines.push(`# Query root: ${schema.queryType.name}`);
    if (schema.mutationType) lines.push(`# Mutation root: ${schema.mutationType.name}`);
    lines.push('');

    // Sort: scalars first, then enums, then interfaces, then objects, then inputs
    const kindOrder: Record<string, number> = {
      SCALAR: 0, ENUM: 1, INTERFACE: 2, UNION: 3, OBJECT: 4, INPUT_OBJECT: 5,
    };
    const sorted = [...types].sort((a, b) =>
      (kindOrder[a.kind] ?? 99) - (kindOrder[b.kind] ?? 99) || a.name.localeCompare(b.name),
    );

    for (const type of sorted) {
      if (type.kind === 'SCALAR') {
        lines.push(`scalar ${type.name}`);
        continue;
      }

      if (type.kind === 'ENUM') {
        const values = (type.enumValues ?? []).map(v => v.name).join(' | ');
        lines.push(`enum ${type.name} { ${values} }`);
        continue;
      }

      if (type.kind === 'UNION') {
        const members = (type.possibleTypes ?? []).map(t => t.name).join(' | ');
        lines.push(`union ${type.name} = ${members}`);
        continue;
      }

      if (type.kind === 'OBJECT' || type.kind === 'INPUT_OBJECT' || type.kind === 'INTERFACE') {
        const keyword = type.kind === 'INPUT_OBJECT' ? 'input' : type.kind === 'INTERFACE' ? 'interface' : 'type';
        const ifaces = type.interfaces?.length
          ? ' implements ' + type.interfaces.map(i => i.name).join(' & ')
          : '';

        const fields = type.fields ?? type.inputFields ?? [];
        if (fields.length === 0) {
          lines.push(`${keyword} ${type.name}${ifaces} {}`);
          continue;
        }

        lines.push(`${keyword} ${type.name}${ifaces} {`);
        for (const field of fields) {
          const args = (field as FieldInfo).args?.length
            ? '(' + (field as FieldInfo).args!.map(a => `${a.name}: ${this.typeRefToString(a.type)}`).join(', ') + ')'
            : '';
          lines.push(`  ${field.name}${args}: ${this.typeRefToString(field.type)}`);
        }
        lines.push('}');
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  private typeRefToString(ref: TypeRef | null | undefined): string {
    if (!ref) return 'Unknown';
    if (ref.kind === 'NON_NULL') return this.typeRefToString(ref.ofType) + '!';
    if (ref.kind === 'LIST') return '[' + this.typeRefToString(ref.ofType) + ']';
    return ref.name ?? 'Unknown';
  }

  private printTypeSummary(schema: SchemaData): void {
    const userTypes = schema.types.filter(t => !t.name.startsWith('__'));

    const grouped: Record<string, string[]> = {};
    for (const type of userTypes) {
      if (!grouped[type.kind]) grouped[type.kind] = [];
      grouped[type.kind].push(type.name);
    }

    const kindOrder = ['OBJECT', 'INPUT_OBJECT', 'ENUM', 'INTERFACE', 'UNION', 'SCALAR'];
    for (const kind of kindOrder) {
      const types = grouped[kind];
      if (!types) continue;
      types.sort();
      console.log(colors.bold(`\n${kind} (${types.length}):`));
      for (const name of types) {
        console.log(`  ${name}`);
      }
    }

    console.log();
    logger.info(`${userTypes.length} types total`);
    if (schema.queryType) logger.info(`Query root: ${schema.queryType.name}`);
    if (schema.mutationType) logger.info(`Mutation root: ${schema.mutationType.name}`);
  }
}
