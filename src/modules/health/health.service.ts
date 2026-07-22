export type ReadinessCheck = () => Promise<void>;

export interface ReadinessCheckResult {
  readonly name: string;
  readonly status: "up" | "down";
}

export interface ReadinessResult {
  readonly ready: boolean;
  readonly checks: readonly ReadinessCheckResult[];
}

export class HealthService {
  readonly #checks = new Map<string, ReadinessCheck>();

  registerReadinessCheck(name: string, check: ReadinessCheck): void {
    if (this.#checks.has(name)) {
      throw new Error(`Readiness check already registered: ${name}`);
    }
    this.#checks.set(name, check);
  }

  async readiness(): Promise<ReadinessResult> {
    const checks = await Promise.all(
      [...this.#checks.entries()].map(async ([name, check]): Promise<ReadinessCheckResult> => {
        try {
          await check();
          return { name, status: "up" };
        } catch {
          return { name, status: "down" };
        }
      }),
    );

    return {
      ready: checks.every((check) => check.status === "up"),
      checks,
    };
  }
}
