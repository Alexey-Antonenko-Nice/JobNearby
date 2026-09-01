import Database from "better-sqlite3";

export interface CaptureDiagnosticQuery {
  readonly limit: number;
  readonly latest: boolean;
  readonly provider?: string;
  readonly externalVacancyId?: string;
}

export interface CaptureDiagnosticSqlFilter {
  readonly whereClause: string;
  readonly parameters: readonly string[];
}

const defaultLimit = 50;

export function parseCaptureDiagnosticArgs(
  args: readonly string[],
): CaptureDiagnosticQuery {
  let positionalLimit: number | undefined;
  let explicitLimit: number | undefined;
  let latest = false;
  let provider: string | undefined;
  let externalVacancyId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--latest" || argument === "latest") {
      if (latest) throw new Error('Option "--latest" may only be specified once.');
      latest = true;
      continue;
    }
    if (argument === "--limit" || argument === "limit") {
      if (explicitLimit !== undefined) {
        throw new Error('Option "--limit" may only be specified once.');
      }
      explicitLimit = parseLimit(optionValue(args, index, "--limit"), "--limit");
      index += 1;
      continue;
    }
    if (argument === "--provider" || argument === "provider") {
      if (provider !== undefined) {
        throw new Error('Option "--provider" may only be specified once.');
      }
      provider = nonEmptyOptionValue(args, index, "--provider");
      index += 1;
      continue;
    }
    if (argument === "--external-id" || argument === "external-id") {
      if (externalVacancyId !== undefined) {
        throw new Error('Option "--external-id" may only be specified once.');
      }
      externalVacancyId = nonEmptyOptionValue(args, index, "--external-id");
      index += 1;
      continue;
    }
    if (!/^\d+$/u.test(argument)) throw new Error(`Unknown option or keyword "${argument}".`);
    if (positionalLimit !== undefined) {
      throw new Error(`Unexpected positional argument "${argument}".`);
    }
    positionalLimit = parseLimit(argument, "positional limit");
  }

  if (positionalLimit !== undefined && explicitLimit !== undefined) {
    throw new Error('Specify either the positional limit or "--limit", not both.');
  }
  if (latest && (positionalLimit !== undefined || explicitLimit !== undefined)) {
    throw new Error('Option "--latest" may not be combined with an explicit limit.');
  }

  return {
    limit: latest ? 1 : explicitLimit ?? positionalLimit ?? defaultLimit,
    latest,
    ...(provider === undefined ? {} : { provider }),
    ...(externalVacancyId === undefined ? {} : { externalVacancyId }),
  };
}

export function buildCaptureDiagnosticSqlFilter(
  query: CaptureDiagnosticQuery,
): CaptureDiagnosticSqlFilter {
  const predicates: string[] = [];
  const parameters: string[] = [];
  if (query.provider !== undefined) {
    predicates.push("observation.source_name = ?");
    parameters.push(query.provider);
  }
  if (query.externalVacancyId !== undefined) {
    predicates.push("observation.external_id = ?");
    parameters.push(query.externalVacancyId);
  }
  return {
    whereClause: predicates.length === 0 ? "" : `WHERE ${predicates.join(" AND ")}`,
    parameters,
  };
}

export function openCaptureDiagnosticDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  return db;
}

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || isOptionToken(value)) {
    throw new Error(`Option "${option}" requires a value.`);
  }
  return value;
}

function isOptionToken(value: string): boolean {
  return [
    "latest", "limit", "provider", "external-id",
    "--latest", "--limit", "--provider", "--external-id",
  ].includes(value);
}

function nonEmptyOptionValue(args: readonly string[], index: number, option: string): string {
  const value = optionValue(args, index, option).trim();
  if (value.length === 0) throw new Error(`Option "${option}" requires a non-empty value.`);
  return value;
}

function parseLimit(value: string, option: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${option} must be an integer between 1 and 500.`);
  }
  const limit = Number(value);
  if (limit < 1 || limit > 500) {
    throw new Error(`${option} must be an integer between 1 and 500.`);
  }
  return limit;
}
