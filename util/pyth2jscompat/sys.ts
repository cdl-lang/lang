/* Imitates Python's sys module, including os.path */

export function exit(n: number): never {
    return process.exit(n);
}

export const argv: string[] = process.argv.slice(1);
