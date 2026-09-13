declare module "lzma-native" {
  export interface LzmaOptions {
    preset?: number;
    check?: number;
    filters?: ReadonlyArray<{ id: number; options?: Record<string, unknown> }>;
  }

  export function compress(
    data: Buffer | Uint8Array,
    options?: LzmaOptions
  ): Buffer;

  export function decompress(
    data: Buffer | Uint8Array,
    options?: { memlimit?: number; flags?: number }
  ): Buffer;

  export function createDecompressor(
    options?: { memlimit?: number; flags?: number }
  ): (data: Buffer | Uint8Array) => Buffer;

  export function createCompressor(): (data: Buffer) => Buffer;

  export const preset: {
    readonly DEFAULT: number;
    readonly LEVEL_MASK: number;
    readonly EXTREME: number;
  };

  export const check: {
    readonly NONE: number;
    readonly CRC32: number;
    readonly CRC64: number;
    readonly SHA256: number;
  };

  export const filters: {
    readonly LZMA1: number;
    readonly LZMA2: number;
    readonly DELTA: number;
    readonly X86: number;
    readonly POWERPC: number;
    readonly IA64: number;
    readonly ARM: number;
    readonly ARMTHUMB: number;
    readonly SPARC: number;
  };
}