export interface PaginationInput {
  readonly page: number;
  readonly pageSize: number;
}

export interface PaginationMeta extends PaginationInput {
  readonly total: number;
  readonly totalPages: number;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly pagination: PaginationMeta;
}

export function paginationOffset(input: PaginationInput): number {
  return (input.page - 1) * input.pageSize;
}

export function paginationMeta(input: PaginationInput, total: number): PaginationMeta {
  return {
    ...input,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / input.pageSize),
  };
}
